const appUrl = chrome.runtime.getURL("index.html");
let overlay;
let launcher;

function closeFeed() {
  if (overlay?.open) overlay.close();
}

function toggleFeed() {
  if (overlay?.open) { closeFeed(); return; }
  if (!overlay?.isConnected) {
    overlay = document.createElement("dialog");
    overlay.className = "repofeed-overlay";
    overlay.setAttribute("aria-label", "Repo Feed");
    const bar = document.createElement("div");
    bar.className = "repofeed-toolbar";
    const title = document.createElement("strong");
    title.textContent = "Repo Feed";
    const external = document.createElement("a");
    external.textContent = "Открыть отдельно";
    external.href = appUrl;
    external.target = "_blank";
    external.rel = "noopener noreferrer";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Закрыть";
    close.onclick = closeFeed;
    bar.append(title, external, close);
    const frame = document.createElement("iframe");
    frame.title = "Repo Feed";
    frame.src = appUrl;
    overlay.append(bar, frame);
    document.body.append(overlay);
    overlay.addEventListener("click", event => { if (event.target === overlay) closeFeed(); });
  }
  overlay.showModal();
}

function installLauncher() {
  if (launcher?.isConnected) return;
  const host = document.querySelector(".AppHeader-actions, .AppHeader-globalBar-end");
  launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = host ? "repofeed-launch" : "repofeed-launch repofeed-fallback";
  launcher.textContent = "Repo Feed";
  launcher.onclick = toggleFeed;
  (host || document.body).prepend(launcher);
}

installLauncher();
let pending = false;
new MutationObserver(() => {
  if (launcher?.isConnected || pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; installLauncher(); });
}).observe(document.documentElement, {subtree: true, childList: true});
document.addEventListener("turbo:load", installLauncher);
chrome.runtime.onMessage.addListener((message, _, reply) => {
  if (message?.type === "repofeed:toggle") { toggleFeed(); reply({ok: true}); }
});
window.addEventListener("message", event => {
  const frame = overlay?.querySelector("iframe");
  if (event.source === frame?.contentWindow && event.origin === new URL(appUrl).origin &&
      event.data === "repofeed:close") closeFeed();
});
