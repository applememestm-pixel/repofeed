import argparse
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Build and verify a locally signed Repo Feed APK.")
parser.add_argument("--platform", type=Path, required=True, help="Path to Android Platform 35 android.jar")
parser.add_argument("--tools", type=Path, required=True, help="Directory containing Android Build Tools 35")
args = parser.parse_args()

def binary(name):
    java_home = os.environ.get("JAVA_HOME")
    path = (Path(java_home) / "bin" / (name + (".exe" if os.name == "nt" else ""))) if java_home else None
    return str(path) if path and path.is_file() else name

def android_tool(name):
    suffix = (".bat" if name in {"d8", "apksigner"} else ".exe") if os.name == "nt" else ""
    return str(args.tools.resolve() / (name + suffix))

def run(*command):
    subprocess.run([str(arg) for arg in command], check=True)

dist = root / "dist"
dist.mkdir(exist_ok=True)
output = dist / "repofeed-android.apk"
keystore = root / ".build" / "repofeed-local.jks"
keystore.parent.mkdir(exist_ok=True)
if not keystore.exists():
    run(binary("keytool"), "-genkeypair", "-keystore", keystore, "-storepass", "android",
        "-keypass", "android", "-alias", "repofeed", "-dname", "CN=Repo Feed Development",
        "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000")
with TemporaryDirectory(prefix="repofeed-apk-", dir=keystore.parent) as temporary:
    work = Path(temporary)
    assets = work / "assets"
    classes = work / "classes"
    dex = work / "dex"
    for directory in (assets, classes, dex):
        directory.mkdir()
    for name in ("index.html", "app.js", "config.js"):
        shutil.copyfile(root / name, assets / name)
    platform = args.platform.resolve()
    unsigned, aligned = work / "unsigned.apk", work / "aligned.apk"
    java_files = list((root / "android" / "src").rglob("*.java"))
    run(binary("javac"), "--release", "8", "-encoding", "UTF-8", "-classpath", platform, "-d", classes, *java_files)
    run(android_tool("d8"), "--min-api", "26", "--lib", platform, "--output", dex, *classes.rglob("*.class"))
    run(android_tool("aapt2"), "link", "-I", platform, "--manifest", root / "android" / "AndroidManifest.xml",
        "-A", assets, "-o", unsigned)
    with ZipFile(unsigned, "a") as apk:
        apk.write(dex / "classes.dex", "classes.dex")
    run(android_tool("zipalign"), "-f", "4", unsigned, aligned)
    run(android_tool("apksigner"), "sign", "--ks", keystore, "--ks-key-alias", "repofeed",
        "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", output, aligned)
    run(android_tool("apksigner"), "verify", "--verbose", output)
print(output)
