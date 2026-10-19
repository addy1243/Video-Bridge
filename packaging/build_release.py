"""Build a Windows x64 installer with an isolated, relocatable runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PYTHON_VERSION = "3.13.13"
NODE_VERSION = "22.23.0"
PYTHON_SHA256 = "8766a8775746235e23cf5aee5027ab1060bb981d93110577adcf3508aa0cbd55"
NODE_SHA256 = "425a5bd68cc95e8eb16bcccd0a75081b48983fc6a26f67126bd4d6c7198231e8"


def download(url, name, checksum):
    target = ROOT / ".tmp/release-downloads" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with urllib.request.urlopen(url, timeout=120) as response:
            target.write_bytes(response.read())
    if hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
        raise ValueError(f"Checksum mismatch: {name}. Cached file left in place for inspection.")
    return target


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iscc", required=True, help="Path to the Inno Setup 6 compiler")
    args = parser.parse_args()
    if os.name != "nt" or sys.version_info[:2] != (3, 13):
        raise SystemExit("Build on Windows x64 using Python 3.13.")
    version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
    stage = ROOT / ".tmp" / f"release-{uuid.uuid4().hex}" / "VideoBridge"
    python_home = stage / "runtime/python"
    node_home = stage / "runtime/node"
    python_home.mkdir(parents=True)
    node_home.mkdir(parents=True)

    python_zip = download(
        f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip",
        f"python-{PYTHON_VERSION}-embed-amd64.zip", PYTHON_SHA256,
    )
    with zipfile.ZipFile(python_zip) as archive:
        archive.extractall(python_home)
    # Only this application's libraries are available; system Python is never used.
    (python_home / "python313._pth").write_text("python313.zip\n.\nLib/site-packages\nimport site\n")
    packages = python_home / "Lib/site-packages"
    run(sys.executable, "-m", "pip", "install", "--only-binary=:all:", "--target", packages,
        "pip", "yt-dlp[default,curl-cffi]", "imageio-ffmpeg")
    node_name = f"node-v{NODE_VERSION}-win-x64.zip"
    node_zip = download(f"https://nodejs.org/dist/v{NODE_VERSION}/{node_name}", node_name, NODE_SHA256)
    with zipfile.ZipFile(node_zip) as archive:
        for name in ("node.exe", "LICENSE"):
            (node_home / name).write_bytes(archive.read(f"node-v{NODE_VERSION}-win-x64/{name}"))
    shutil.copytree(ROOT / "extension", stage / "extension")
    (stage / "native").mkdir()
    shutil.copy2(ROOT / "native/host.py", stage / "native/host.py")
    for name in ("install.ps1", "Setup.cmd", "README.md"):
        shutil.copy2(ROOT / name, stage / name)
    shutil.copy2(ROOT / "packaging/Connect-browser.cmd", stage / "Connect-browser.cmd")

    # Test the shipped runtime after relocation, with no system Python/Node on PATH.
    embedded = python_home / "python.exe"
    env = {**os.environ, "PATH": str(node_home) + os.pathsep + os.environ.get("SystemRoot", r"C:\Windows") + r"\System32"}
    run(embedded, "-c", "import yt_dlp, curl_cffi, pip, ssl, imageio_ffmpeg; print('Bundled imports OK')", env=env)
    run(embedded, "-m", "pip", "--version", env=env)
    run(node_home / "node.exe", "--version", env=env)
    # Use a separate test project so generated media/configuration never ship.
    smoke = stage.parent / "smoke"
    shutil.copytree(ROOT / "tests", smoke / "tests", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(stage / "native", smoke / "native")
    run(embedded, smoke / "tests/smoke_pipeline.py", env=env, cwd=smoke)
    forbidden = {"config.json", "host.cmd", "com.videobridge.downloader.json", ".operation.lock"}
    assert not any((stage / "native" / name).exists() for name in forbidden)

    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    installer = output / f"VideoBridge-{version}-Setup-x64.exe"
    if installer.exists():
        raise SystemExit(f"Preserving existing installer: {installer}")
    run(args.iscc, f"/DAppVersion={version}", f"/DSourceRoot={stage}", f"/DOutputRoot={output}", ROOT / "packaging/VideoBridge.iss")
    assert installer.is_file()
    checksum = hashlib.sha256(installer.read_bytes()).hexdigest()
    (output / "SHA256SUMS.txt").write_text(f"{checksum}  {installer.name}\n")
    print(f"Built and tested: {installer}")


if __name__ == "__main__":
    main()
