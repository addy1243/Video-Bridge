import importlib.util
import io
import http.cookiejar
import json
from pathlib import Path
import struct
import subprocess
import sys
import unittest
import urllib.request
from unittest.mock import patch, MagicMock
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("host", Path(__file__).resolve().parents[1] / "native/host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class ShortReads(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 2))


class HostTests(unittest.TestCase):
    def test_native_process_uses_only_framed_stdout(self):
        request = io.BytesIO()
        host.send_message(request, {"action": "download", "url": "file:///secret", "quality": "best"})
        result = subprocess.run([sys.executable, host.__file__], input=request.getvalue(), capture_output=True, check=True, timeout=10)
        stream = io.BytesIO(result.stdout)
        reply = host.read_message(stream)
        self.assertEqual(reply["status"], "error")
        self.assertIn("HTTP", reply["message"])
        self.assertEqual(stream.read(), b"")

    def test_protocol_round_trip_and_partial_reads(self):
        message = {"action": "download", "url": "https://youtu.be/BaW_jenozKc", "title": "नमस्ते"}
        output = io.BytesIO()
        host.send_message(output, message)
        self.assertEqual(host.read_message(ShortReads(output.getvalue())), message)

    def test_bad_protocol(self):
        for data in [b"", b"\x01", struct.pack("<I", 70000), struct.pack("<I", 8) + b"{}", struct.pack("<I", 2) + b"[]"]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                host.read_message(io.BytesIO(data))

    def test_url_canonicalization(self):
        for url in ["https://youtu.be/BaW_jenozKc", "https://youtube.com/shorts/BaW_jenozKc?list=123", "https://www.youtube.com/watch?v=BaW_jenozKc&list=123"]:
            self.assertEqual(host.video_url(url), "https://www.youtube.com/watch?v=BaW_jenozKc")
        self.assertEqual(host.video_url("https://x.com/name/status/123/video/1"), "https://x.com/i/web/status/123")

    def test_native_boundary_rejects_untrusted_input(self):
        for url in [None, {}, "file:///tmp/a", "javascript:alert(1)", "blob:https://example.com/123", "https://user:pass@youtu.be/BaW_jenozKc", "https://example.com:0/video", "https://example.com/path\nheader", "https://example.com\\path"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                host.video_url(url)

    def test_general_media_urls_and_signed_parameters_are_preserved(self):
        for url in ["https://animenana.com/view/77475126401", "https://cdn.example.com/master.m3u8?token=abc%2Fdef&expires=123", "http://127.0.0.1:8080/video.mp4", "https://youtube.com.evil.test/watch?v=BaW_jenozKc"]:
            self.assertEqual(host.video_url(url), url)

    def test_direct_video_with_unknown_codec_is_listed(self):
        info = {"title": "Direct file", "formats": [{"format_id": "http", "ext": "mp4", "url": "https://cdn.example.com/video.mp4"}]}
        self.assertEqual(host.available_choices(info)[0]["formats"][0]["id"], "http")

    def test_options_and_live_filter(self):
        config = {"output": "C:/Downloads", "ffmpeg": "C:/ffmpeg.exe", "node": "C:/node.exe"}
        opts = host.build_options("720", config, lambda _: None, lambda _: None)
        self.assertEqual(opts["format_sort"], ["res:720"])
        self.assertFalse(opts["overwrites"])
        self.assertTrue(opts["noplaylist"])
        self.assertIn("node", opts["js_runtimes"])
        self.assertIsNone(host.reject_live({"live_status": "was_live"}))
        self.assertIsNotNone(host.reject_live({"live_status": "is_live"}))
        self.assertIsNotNone(host.reject_live({"live_status": "is_upcoming"}))
        with self.assertRaises(ValueError):
            host.build_options("invalid", config, None, None)

    def test_explicit_format_does_not_fall_back_to_another_resolution(self):
        config = {"output": "C:/Downloads", "ffmpeg": "C:/ffmpeg.exe", "node": "C:/node.exe"}
        opts = host.build_options("best", config, None, None, {"formatId": "137", "entry": 2})
        self.assertEqual(opts["format"], "137[acodec!=none]/137+ba/137")
        self.assertEqual(opts["playlist_items"], "2")
        for selection in [{"formatId": "137/best", "entry": 1}, {"formatId": "best", "entry": 0}, {"formatId": "x", "entry": True}]:
            with self.assertRaises(ValueError):
                host.build_options("best", config, None, None, selection)
        opts = host.build_options("best", config, None, None, {"formatId": None, "entry": 2})
        self.assertEqual(opts["format"], "bv*+ba/b")
        self.assertTrue(opts["continuedl"])

    def test_choices_exclude_audio_only_drm_and_storyboards(self):
        formats = [
            {"format_id": "137", "vcodec": "h264", "acodec": "none", "url": "https://cdn.test/video", "width": 1920, "height": 1080},
            {"format_id": "a", "vcodec": "none", "acodec": "aac", "url": "https://cdn.test/audio"},
            {"format_id": "drm", "vcodec": "h264", "has_drm": True, "url": "https://cdn.test/protected"},
            {"format_id": "story", "vcodec": "none", "url": "https://cdn.test/story"},
        ]
        videos = host.available_choices({"_type": "playlist", "entries": [{"title": "First", "formats": formats}, {"title": "Second", "formats": formats}]})
        self.assertEqual([v["entry"] for v in videos], [1, 2])
        self.assertEqual([f["id"] for f in videos[0]["formats"]], ["137"])
        self.assertNotIn("url", videos[0]["formats"][0])

    def test_updater_targets_only_project_environment(self):
        with patch.object(host.sys, "prefix", str(host.ROOT.parent / "not-the-project-environment")):
            with self.assertRaises(ValueError):
                host.update_downloader(lambda _: None)
        messages = []
        with patch.object(host.sys, "prefix", str(host.ROOT.parent / ".venv")), \
                patch.object(host.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run, \
                patch("importlib.metadata.version", return_value="test-version"):
            host.update_downloader(messages.append)
        self.assertEqual(messages[-1]["status"], "updated")
        self.assertEqual(run.call_args.args[0][-1], "yt-dlp[default,curl-cffi]")
        self.assertEqual(run.call_args.kwargs["timeout"], 180)
        with patch.object(host.sys, "prefix", str(host.ROOT.parent / "runtime/python")), \
                patch.object(host.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run, \
                patch("importlib.metadata.version", return_value="bundled-version"):
            host.update_downloader(messages.append)
        self.assertEqual(messages[-1]["status"], "updated")
        self.assertEqual(run.call_args.args[0][0], host.sys.executable)

    def test_error_messages_strip_terminal_codes_and_explain_403(self):
        self.assertEqual(host.clean_message("\x1b[0;31mERROR:\x1b[0m failed"), "ERROR: failed")
        self.assertIn("Detect streaming video", host.error_message("HTTP Error 403"))
        self.assertIn("Update downloader now", host.error_message("Impersonate target chrome is not available"))

    def test_login_and_drm_errors_are_distinguished(self):
        message = host.error_message("ERROR: [hotstar] This video is only available for registered users. Use --cookies-from-browser")
        self.assertIn("enable Use this site's signed-in session", message)
        self.assertNotIn("--cookies-from-browser", message)
        self.assertIn("cannot export", host.error_message("This video is DRM protected"))

    def test_cookie_scope_secure_flag_and_host_only_behavior(self):
        raw = {"name": "session", "value": "fake-test-token", "domain": "example.com", "path": "/", "hostOnly": True, "secure": True}
        cookies = host.session_cookies([raw], "https://example.com/watch")
        jar = http.cookiejar.CookieJar(policy=http.cookiejar.DefaultCookiePolicy(strict_ns_domain=http.cookiejar.DefaultCookiePolicy.DomainStrictNonDomain))
        jar.set_cookie(cookies[0])
        for url, expected in [("https://example.com/video", True), ("https://sub.example.com/video", False), ("https://unrelated.example/video", False), ("http://example.com/video", False)]:
            request = urllib.request.Request(url)
            jar.add_cookie_header(request)
            self.assertEqual(request.has_header("Cookie"), expected)
        for bad in [{**raw, "domain": "unrelated.example"}, {**raw, "value": "a\r\nInjected: x"}, {**raw, "expirationDate": float("nan")}]:
            with self.assertRaises(ValueError):
                host.session_cookies([bad], "https://example.com/watch")
        self.assertEqual(host.redact("failed fake-test-token", ["fake-test-token"]), "failed [redacted]")
        domain_cookie = host.session_cookies([{**raw, "domain": ".example.com", "hostOnly": False}], "https://www.example.com/watch")[0]
        domain_jar = http.cookiejar.CookieJar()
        domain_jar.set_cookie(domain_cookie)
        request = urllib.request.Request("https://api.example.com/video")
        domain_jar.add_cookie_header(request)
        self.assertTrue(request.has_header("Cookie"))

    def test_only_cloudflare_failure_gets_one_browser_compatible_retry(self):
        class DownloadError(Exception):
            pass

        downloader = MagicMock()
        library = SimpleNamespace(YoutubeDL=downloader)
        errors = SimpleNamespace(DownloadError=DownloadError)
        operation = MagicMock(side_effect=[DownloadError("Cloudflare anti-bot challenge"), "success"])
        messages = []
        with patch.dict(sys.modules, {"yt_dlp": library, "yt_dlp.utils": errors}):
            self.assertEqual(host.run_extraction({}, operation, messages.append), "success")
            self.assertEqual(downloader.call_args.args[0]["extractor_args"]["generic"]["impersonate"], ["chrome"])
            self.assertEqual(operation.call_count, 2)
            operation.reset_mock(side_effect=True)
            operation.side_effect = DownloadError("HTTP Error 404")
            with self.assertRaises(DownloadError):
                host.run_extraction({}, operation, messages.append)
            self.assertEqual(operation.call_count, 1)


if __name__ == "__main__":
    unittest.main()
