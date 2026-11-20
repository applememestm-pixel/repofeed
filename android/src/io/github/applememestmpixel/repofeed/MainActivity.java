package io.github.applememestmpixel.repofeed;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private WebView web;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(13, 17, 23));
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!ASSET_HOST.equals(uri.getHost())) return null;
                String name = uri.getLastPathSegment();
                if (!"https".equals(uri.getScheme()) || name == null || !uri.getPath().equals("/" + name)) {
                    return blockedResponse();
                }
                try {
                    switch (name) {
                        case "index.html":
                            return new WebResourceResponse("text/html", "UTF-8", getAssets().open(name));
                        case "config.js":
                        case "app.js":
                            return new WebResourceResponse("application/javascript", "UTF-8", getAssets().open(name));
                        default:
                            return blockedResponse();
                    }
                } catch (IOException exception) {
                    return blockedResponse();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!request.isForMainFrame() || ASSET_HOST.equals(url.getHost())) return false;
                launchGitHub(url);
                return true;
            }
        });
        web.addJavascriptInterface(new GitHubBridge(), "RepoFeedAndroid");
        setContentView(web);
        web.loadUrl("https://" + ASSET_HOST + "/index.html");
    }

    private WebResourceResponse blockedResponse() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                java.util.Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    private void launchGitHub(Uri url) {
        if (!"https".equals(url.getScheme()) || !"github.com".equals(url.getHost())
                || url.getUserInfo() != null || url.getPort() != -1) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, "Нет браузера для открытия GitHub", Toast.LENGTH_SHORT).show();
        }
    }

    private final class GitHubBridge {
        @JavascriptInterface
        public void openGitHub(String target) {
            runOnUiThread(() -> launchGitHub(Uri.parse(target)));
        }

        @JavascriptInterface
        public String oauth(String path, String data) {
            if (!"device/code".equals(path) && !"oauth/access_token".equals(path)) {
                return "{\"transportError\":true}";
            }
            if (data == null || data.length() > 4096) return "{\"transportError\":true}";
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL("https://github.com/login/" + path).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                connection.setDoOutput(true);
                try (java.io.OutputStream output = connection.getOutputStream()) {
                    output.write(data.getBytes(StandardCharsets.UTF_8));
                }
                try (java.io.InputStream input = connection.getInputStream();
                     java.io.ByteArrayOutputStream result = new java.io.ByteArrayOutputStream()) {
                    byte[] buffer = new byte[1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (result.size() + count > 32768) return "{\"transportError\":true}";
                        result.write(buffer, 0, count);
                    }
                    return new String(result.toByteArray(), StandardCharsets.UTF_8);
                }
            } catch (IOException exception) {
                return "{\"transportError\":true}";
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
    }
}
