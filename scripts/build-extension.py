from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
output = root / "dist"
output.mkdir(exist_ok=True)
archive = output / "repofeed-chromium.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for name in ("manifest.json", "background.js", "content.js", "overlay.css"):
        package.write(root / "extension" / name, name)
    for name in ("index.html", "app.js", "config.js"):
        package.write(root / name, name)
print(archive)
