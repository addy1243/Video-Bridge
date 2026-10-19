"""One framed request per process; progress is sent over a native messaging port."""
import contextlib
import http.cookiejar
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            raise ValueError("Incomplete native message.")
        data.extend(chunk)
    return bytes(data)


def read_message(stream):
    size = struct.unpack("<I", read_exact(stream, 4))[0]
    if not 0 < size <= 65536:
        raise ValueError("Invalid native message size.")
    message = json.loads(read_exact(stream, size))
    if not isinstance(message, dict):
        raise ValueError("Expected a request object.")
    return message


def send_message(stream, message):
    data = json.dumps(message, ensure_ascii=True).encode("utf-8")
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


def video_url(value):
    if not isinstance(value, str) or len(value) > 8192 or re.search(r"[\x00-\x20\x7f\\]", value):
        raise ValueError("Invalid video link.")
    url = urlparse(value)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.port == 0:
        raise ValueError("Use an HTTP or HTTPS video/page link without embedded passwords.")
    host = url.hostname
    video_id = None
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if url.path == "/watch":
            video_id = parse_qs(url.query).get("v", [""])[0]
        else:
            match = re.fullmatch(r"/(?:shorts|embed|live)/([\w-]{11})/?", url.path, re.ASCII)
            video_id = match[1] if match else None
    elif host == "youtu.be":
        match = re.fullmatch(r"/([\w-]{11})/?", url.path, re.ASCII)
        video_id = match[1] if match else None
    elif host in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}:
        match = re.fullmatch(r"/(?:[A-Za-z0-9_]+|i/web)/status/(\d+)(?:/video/\d+)?/?", url.path, re.ASCII)
        if match:
            return f"https://x.com/i/web/status/{match[1]}"
    if video_id and re.fullmatch(r"[\w-]{11}", video_id, re.ASCII):
        return f"https://www.youtube.com/watch?v={video_id}"
    return url.geturl()


def build_options(quality, config, progress, postprocess, selection=None):
    if quality not in {"best", "1080", "720"}:
        raise ValueError("Invalid quality.")
    options = {
        "paths": {"home": config["output"]},
        "outtmpl": "%(title).120B [%(id)s].%(ext)s",
        "format": "bv*+ba/b",
        # res is the shorter dimension, so vertical Shorts get the same quality cap.
        "format_sort": [] if quality == "best" else [f"res:{quality}"],
        "noplaylist": True,
        "playlist_items": "1:50",
        "windowsfilenames": True,
        "overwrites": False,
        "continuedl": True,
        "quiet": True,
        "noprogress": True,
        "color": {"stdout": "never", "stderr": "never"},
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "ffmpeg_location": config["ffmpeg"],
        "js_runtimes": {"node": {"path": config["node"]}},
        "progress_hooks": [progress],
        "postprocessor_hooks": [postprocess],
        "match_filter": reject_live,
    }
    if selection:
        format_id = selection.get("formatId")
        entry = selection.get("entry")
        if format_id is not None and (not isinstance(format_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", format_id)):
            raise ValueError("Invalid format selection.")
        if type(entry) is not int or not 1 <= entry <= 1000:
            raise ValueError("Invalid video selection.")
        if format_id is not None:
            options["format"] = f"{format_id}[acodec!=none]/{format_id}+ba/{format_id}"
        options["playlist_items"] = str(entry)
    return options


def available_choices(info):
    if not info or reject_live(info):
        raise ValueError("No downloadable finished video found.")
    entries = info.get("entries") if info.get("_type") in {"playlist", "multi_video"} else [info]
    videos = []
    remaining = 800
    for index, entry in enumerate(entries or [], 1):
        if index > 50:
            break
        if not entry or reject_live(entry):
            continue
        formats = []
        for fmt in reversed(entry.get("formats") or [entry]):
            fid = fmt.get("format_id", "")
            if (not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", str(fid)) or
                    fmt.get("vcodec") == "none" or fmt.get("has_drm") or
                    not fmt.get("url")):
                continue
            if fmt.get("vcodec") is None and fmt.get("ext") not in {"mp4", "webm", "mkv", "mov", "flv", "avi", "m3u8", "mpd", "m4v", "ogv", "ts"}:
                continue
            if not remaining:
                break
            remaining -= 1
            formats.append({
                "id": fid, "width": fmt.get("width"), "height": fmt.get("height"),
                "fps": fmt.get("fps"), "ext": str(fmt.get("ext") or "")[:20],
                "codec": str(fmt.get("vcodec", ""))[:40],
                "size": fmt.get("filesize") or fmt.get("filesize_approx"),
                "approximate": not bool(fmt.get("filesize")),
                "audio": fmt.get("acodec") not in {None, "none"},
            })
            if len(formats) >= 200:
                break
        if formats:
            videos.append({"entry": index, "title": str(entry.get("title") or "Video")[:250], "formats": formats})
    if not videos:
        raise ValueError("No downloadable video formats found.")
    return videos


def update_downloader(emit):
    if Path(sys.prefix).resolve() not in {(ROOT.parent / ".venv").resolve(), (ROOT.parent / "runtime/python").resolve()}:
        raise ValueError("Updates require VideoBridge's isolated Python environment. Run Setup.cmd.")
    emit({"status": "updating", "message": "Checking for downloader updates…"})
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--upgrade", "--no-input", "--disable-pip-version-check", "yt-dlp[default,curl-cffi]"],
        capture_output=True, text=True, timeout=180,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if result.returncode:
        raise RuntimeError("Downloader update failed: " + result.stderr[-2000:])
    from importlib.metadata import version
    emit({"status": "updated", "message": f"Downloader up to date · yt-dlp {version('yt-dlp')}"})


def reject_live(info, *, incomplete=False):
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        return "Live and upcoming broadcasts are not supported. Open a finished video."


class Logger:
    def __init__(self, secrets=()):
        self.last_warning = ""
        self.secrets = secrets

    def debug(self, message):
        pass

    def warning(self, message):
        self.last_warning = redact(message, self.secrets)

    def error(self, message):
        print(redact(message, self.secrets), file=sys.stderr)


def clean_message(value):
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", str(value))


def redact(value, secrets):
    text = clean_message(value)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[redacted]")
    return text


def session_cookies(raw_cookies, cookie_url):
    if not isinstance(raw_cookies, list) or len(raw_cookies) > 100:
        raise ValueError("Invalid session cookies.")
    if not raw_cookies:
        return []
    if len(json.dumps(raw_cookies).encode("utf-8")) > 32768:
        raise ValueError("Session cookies exceed the transfer limit.")
    scope = urlparse(video_url(cookie_url)).hostname.lower()
    result = []
    for raw in raw_cookies:
        if not isinstance(raw, dict):
            raise ValueError("Invalid session cookie.")
        name, value, domain, path = (raw.get(key) for key in ("name", "value", "domain", "path"))
        if not all(isinstance(part, str) for part in (name, value, domain, path)):
            raise ValueError("Invalid session cookie fields.")
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name) or re.search(r"[\x00-\x1f\x7f;]", value):
            raise ValueError("Invalid session cookie characters.")
        domain = domain.lstrip(".").lower()
        host_only = raw.get("hostOnly", True)
        if type(host_only) is not bool or not domain or (domain != scope and (host_only or not scope.endswith("." + domain) or "." not in domain)):
            raise ValueError("Session cookie does not belong to the approved site.")
        if not path.startswith("/") or re.search(r"[\x00-\x1f\x7f]", path):
            raise ValueError("Invalid session cookie path.")
        expiry = raw.get("expirationDate")
        if expiry is not None and (type(expiry) not in (int, float) or not math.isfinite(expiry)):
            raise ValueError("Invalid session cookie expiry.")
        result.append(http.cookiejar.Cookie(
            version=0, name=name, value=value, port=None, port_specified=False,
            domain=domain if host_only else "." + domain, domain_specified=not host_only, domain_initial_dot=not host_only,
            path=path, path_specified=True, secure=bool(raw.get("secure")),
            expires=int(expiry) if expiry is not None else None, discard=expiry is None,
            comment=None, comment_url=None, rest={"HttpOnly": None} if raw.get("httpOnly") else {}, rfc2109=False,
        ))
    return result


def error_message(error, secrets=()):
    message = clean_message(error)
    if "only available for registered users" in message or "login required" in message.lower():
        return "This site requires a signed-in session. Open the video in the browser where it plays, enable Use this site's signed-in session, and retry. If sharing is already enabled, the session may be expired or unsupported by this site's extractor. Login access does not remove DRM protection."
    if "drm" in message.lower() and ("protected" in message.lower() or "protection" in message.lower()):
        return "This video uses DRM protection. VideoBridge cannot export it as an ordinary playable file, even with a signed-in session."
    if "impersonat" in message.lower() and ("not available" in message.lower() or "not installed" in message.lower()):
        return "Browser-compatible networking is missing. Open Setup & updates > Update downloader now, then retry."
    if "403" in message:
        return "The website refused the downloader (HTTP 403). Start the video in your browser, enable Detect streaming video, then select a detected media link. The site may still require browser-only verification or login."
    if "unsupported url" in message.lower():
        return "The downloader could not extract video from this page or embedded player. Start playback in the browser, click Find videos on this page, or enable Detect streaming video and select a detected stream. Some players remain unsupported."
    return redact(message, secrets)[:6000]


def run_extraction(options, operation, emit, cookies=()):
    import yt_dlp
    from yt_dlp.utils import DownloadError
    if cookies:
        options = {**options, "cookiefile": None, "cachedir": False}
    def add_session(downloader):
        if cookies:
            downloader.cookiejar.set_policy(http.cookiejar.DefaultCookiePolicy(strict_ns_domain=http.cookiejar.DefaultCookiePolicy.DomainStrictNonDomain))
            for cookie in cookies:
                downloader.cookiejar.set_cookie(cookie)
    try:
        with contextlib.redirect_stdout(sys.stderr), yt_dlp.YoutubeDL(options) as downloader:
            add_session(downloader)
            return operation(downloader)
    except DownloadError as error:
        if "Cloudflare anti-bot challenge" not in clean_message(error):
            raise
    # Retry only the specific failure for which yt-dlp recommends this option.
    arguments = options.get("extractor_args", {})
    retry = {**options, "extractor_args": {**arguments, "generic": {**arguments.get("generic", {}), "impersonate": ["chrome"]}}}
    emit({"status": "downloading", "message": "Trying a browser-compatible connection…", "percent": None})
    with contextlib.redirect_stdout(sys.stderr), yt_dlp.YoutubeDL(retry) as downloader:
        add_session(downloader)
        return operation(downloader)


def handle(request, emit):
    action = request.get("action")
    if action not in {"check", "download", "inspect", "update"}:
        raise ValueError("Unknown action.")
    if action == "update":
        update_downloader(emit)
        return
    if action in {"download", "inspect"}:
        url = video_url(request.get("url"))
        referer = video_url(request["referer"]) if request.get("referer") else None
        quality = request.get("quality", "best")
        if quality not in {"best", "1080", "720"}:
            raise ValueError("Invalid quality.")
        cookies = session_cookies(request.get("cookies", []), request.get("cookieUrl"))
        secrets = [cookie.value for cookie in cookies]
    config = json.loads((ROOT / "config.json").read_text(encoding="utf-8-sig"))
    for name in ("node", "ffmpeg"):
        if not Path(config[name]).is_file():
            raise ValueError(f"Missing {name}. Run install.ps1 again.")
    import yt_dlp
    from yt_dlp.version import __version__

    if action == "check":
        emit({"status": "ready", "message": f"Helper ready · yt-dlp {__version__}", "path": config["output"]})
        return
    if action == "inspect":
        options = build_options("best", config, lambda _: None, lambda _: None)
        if referer:
            options["http_headers"] = {"Referer": referer}
        options["logger"] = Logger(secrets)
        info = run_extraction(options, lambda downloader: downloader.extract_info(url, download=False), emit, cookies)
        emit({"status": "inspected", "url": url, "videos": available_choices(info)})
        return
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    last_progress = 0.0

    def progress(data):
        nonlocal last_progress
        now = time.monotonic()
        if data["status"] == "finished":
            emit({"status": "processing", "message": "Stream received. Preparing the final file…", "percent": None,
                  "downloaded": data.get("downloaded_bytes"), "total": data.get("total_bytes"), "speed": None, "eta": None})
            return
        if now - last_progress < 0.5:
            return
        last_progress = now
        total = data.get("total_bytes") or data.get("total_bytes_estimate")
        percent = min(100, round(data.get("downloaded_bytes", 0) / total * 100, 1)) if total else None
        info = data.get("info_dict", {})
        emit({"status": "downloading", "message": str(info.get("title") or "Downloading media…"), "percent": percent,
              "downloaded": data.get("downloaded_bytes"), "total": total,
              "estimated": not bool(data.get("total_bytes")), "speed": data.get("speed"), "eta": data.get("eta")})

    def postprocess(data):
        emit({"status": "processing", "message": "Preparing audio and video…", "percent": None})

    logger = Logger(secrets)
    options = build_options(quality, config, progress, postprocess, request.get("selection"))
    if referer:
        options["http_headers"] = {"Referer": referer}
    options["logger"] = logger
    files = []

    def saved(path):
        if str(path) not in files:
            files.append(str(path))

    emit({"status": "downloading", "message": "Finding available video streams…", "percent": None})
    def download(downloader):
        from yt_dlp.postprocessor.common import PostProcessor

        class CaptureFile(PostProcessor):
            def run(self, info):
                saved(info["filepath"])
                return [], info

        downloader.add_post_processor(CaptureFile(), when="after_move")
        return downloader.download([url])

    code = run_extraction(options, download, emit, cookies)
    if code or not files or not all(Path(path).is_file() for path in files):
        raise RuntimeError(logger.last_warning or "No video was saved. The post may have no video, or access may be restricted.")
    saved_bytes = sum(Path(path).stat().st_size for path in files)
    emit({"status": "complete", "message": f"Saved {len(files)} video file(s).", "path": "\n".join(files), "percent": 100,
          "downloaded": saved_bytes, "total": saved_bytes, "estimated": False, "speed": None, "eta": None})


def main():
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    source, target = sys.stdin.buffer, sys.stdout.buffer
    emit = lambda message: send_message(target, message)
    secrets = []
    try:
        request = read_message(source)
        raw_cookies = request.get("cookies", [])
        if isinstance(raw_cookies, list):
            secrets = [entry["value"] for entry in raw_cookies if isinstance(entry, dict) and isinstance(entry.get("value"), str)]
        # Serialize helpers from different browser profiles as well as this popup.
        with (ROOT / ".operation.lock").open("a+b") as lock:
            if os.name == "nt":
                if lock.tell() == 0:
                    lock.write(b"\0")
                    lock.flush()
                lock.seek(0)
                try:
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                except OSError:
                    raise RuntimeError("The helper is busy in another browser. Retry when it finishes.") from None
            handle(request, emit)
    except (BrokenPipeError, EOFError):
        return
    except Exception as error:
        emit({"status": "error", "message": error_message(error, secrets), "percent": None})


if __name__ == "__main__":
    main()
