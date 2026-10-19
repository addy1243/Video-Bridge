"""Offline integration: generate two streams, download via yt-dlp, merge, verify."""
import functools
import http.server
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import threading
import uuid
from unittest.mock import patch

import imageio_ffmpeg
import yt_dlp
from yt_dlp.extractor.common import InfoExtractor

project = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("host", project / "native/host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
scratch = project / ".tmp" / f"smoke-{uuid.uuid4().hex}"
scratch.mkdir(parents=True)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0


def run(*args):
    return subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", *args], check=True,
                          capture_output=True, creationflags=flags)


run("-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10", "-t", "1", "-c:v", "libx264", str(scratch / "video.mp4"))
run("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-c:a", "aac", str(scratch / "audio.m4a"))
run("-i", str(scratch / "video.mp4"), "-i", str(scratch / "audio.m4a"), "-c", "copy", str(scratch / "sample.mp4"))
run("-i", str(scratch / "sample.mp4"), "-c", "copy", "-hls_time", "0.5", "-hls_playlist_type", "vod", "-hls_segment_filename", str(scratch / "segment-%02d.ts"), str(scratch / "stream.m3u8"))
run("-i", str(scratch / "sample.mp4"), "-c", "copy", "-f", "dash", str(scratch / "stream.mpd"))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        name = self.path.split("?", 1)[0]
        if name in {"/signed.html", "/signed.mp4"}:
            if "test_session=local-test-only" not in (self.headers.get("Cookie") or ""):
                self.send_error(401)
                return
            authenticated_requests.append(name)
        if name in {"/page.html", "/signed.html"}:
            payload = b'<html><head><title>Signed fixture</title></head><body><video controls src="/signed.mp4"></video></body></html>' if name == "/signed.html" else b'<html><head><title>Generic fixture</title></head><body><video controls src="/sample.mp4"></video></body></html>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if name not in {"/video.mp4", "/audio.m4a", "/sample.mp4", "/signed.mp4", "/stream.m3u8", "/stream.mpd"} and not (
                "/" not in name[1:] and ((name.startswith("/segment-") and name.endswith(".ts")) or
                (name.startswith(("/init-stream", "/chunk-stream")) and name.endswith(".m4s")))):
            self.send_error(404)
            return
        payload = (scratch / ("sample.mp4" if name == "/signed.mp4" else name.lstrip("/"))).read_bytes()
        range_header = self.headers.get("Range")
        start = int(range_header.split("=", 1)[1].split("-", 1)[0]) if range_header else 0
        if range_header:
            ranges.append((name, start))
        self.send_response(206 if range_header else 200)
        content_type = "application/dash+xml" if name.endswith(".mpd") else "application/vnd.apple.mpegurl" if name.endswith(".m3u8") else "video/mp2t" if name.endswith(".ts") else "video/mp4"
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload) - start))
        self.send_header("Accept-Ranges", "bytes")
        if range_header:
            self.send_header("Content-Range", f"bytes {start}-{len(payload) - 1}/{len(payload)}")
        self.end_headers()
        self.wfile.write(payload[start:])


ranges = []
authenticated_requests = []
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(scratch)))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
origin = f"http://127.0.0.1:{server.server_port}"


class FixtureIE(InfoExtractor):
    _VALID_URL = r"https://www\.youtube\.com/watch\?v=(?P<id>BaW_jenozKc)$"

    def _real_extract(self, url):
        return {
            "id": "BaW_jenozKc", "title": "Local integration fixture", "duration": 1,
            "formats": [
                {"format_id": "v", "url": origin + "/video.mp4", "ext": "mp4", "vcodec": "h264", "acodec": "none", "height": 90, "width": 160},
                {"format_id": "a", "url": origin + "/audio.m4a", "ext": "m4a", "vcodec": "none", "acodec": "aac"},
            ],
        }


class FixtureDownloader(yt_dlp.YoutubeDL):
    def __init__(self, options):
        super().__init__(options, auto_init=False)
        self.add_info_extractor(FixtureIE())


config = {"output": str(scratch / "downloads"), "node": shutil.which("node"), "ffmpeg": ffmpeg}
(scratch / "config.json").write_text(json.dumps(config), encoding="utf-8")
messages = []
try:
    with patch.object(host, "ROOT", scratch), patch.object(yt_dlp, "YoutubeDL", FixtureDownloader):
        inspected = []
        host.handle({"action": "inspect", "url": "https://youtu.be/BaW_jenozKc"}, inspected.append)
        assert inspected[-1]["videos"][0]["formats"][0]["id"] == "v", inspected
        # Seed the partial file left by a stopped process, then require a Range resume.
        partial = scratch / "downloads" / "Local integration fixture [BaW_jenozKc].fv.mp4.part"
        partial.parent.mkdir(parents=True)
        source = (scratch / "video.mp4").read_bytes()
        offset = len(source) // 2
        partial.write_bytes(source[:offset])
        host.handle({"action": "download", "url": "https://youtu.be/BaW_jenozKc", "quality": "best",
                     "selection": {"formatId": "v", "entry": 1}}, messages.append)
    assert messages[-1]["status"] == "complete", messages
    output = Path(messages[-1]["path"])
    assert output.is_file()
    assert messages[-1]["downloaded"] == output.stat().st_size
    assert ("/video.mp4", offset) in ranges, f"Expected a resumed range at {offset}, got {ranges}"
    assert any(m.get("downloaded", 0) and m.get("downloaded", 0) >= offset for m in messages)
    # Both mappings must exist and decode; an audio-only or silent video fails here.
    run("-i", str(output), "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-")
    print(f"PASS: format discovery, exact selection, Range resume from byte {offset}, audio/video merge and decode: {output}")
    for source in ["/page.html", "/sample.mp4", "/stream.m3u8", "/stream.mpd"]:
        inspected, downloaded = [], []
        with patch.object(host, "ROOT", scratch):
            host.handle({"action": "inspect", "url": origin + source}, inspected.append)
            assert inspected[-1]["status"] == "inspected", inspected
            fmt = inspected[-1]["videos"][0]["formats"][0]["id"]
            host.handle({"action": "download", "url": origin + source, "quality": "best", "referer": origin + "/page.html",
                         "selection": {"formatId": fmt, "entry": 1}}, downloaded.append)
        assert downloaded[-1]["status"] == "complete", downloaded
        run("-i", downloaded[-1]["path"], "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-")
        print(f"PASS: real generic extractor inspection and selected-format download for {source}")
    # Synthetic credentials only; no browser account or real cookie store is accessed.
    auth = {"cookies": [{"name": "test_session", "value": "local-test-only", "domain": "127.0.0.1", "path": "/", "hostOnly": True, "secure": False}], "cookieUrl": origin + "/signed.html"}
    inspected, downloaded = [], []
    with patch.object(host, "ROOT", scratch):
        host.handle({"action": "inspect", "url": origin + "/signed.html", **auth}, inspected.append)
        host.handle({"action": "download", "url": origin + "/signed.html", "quality": "best", **auth}, downloaded.append)
    assert inspected[-1]["status"] == "inspected"
    assert downloaded[-1]["status"] == "complete"
    assert "/signed.html" in authenticated_requests and "/signed.mp4" in authenticated_requests
    run("-i", downloaded[-1]["path"], "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-")
    print("PASS: in-memory test session authenticated page extraction and media download without a cookie file")
finally:
    server.shutdown()
    server.server_close()
