// This function is serialized into the active page; keep it self-contained.
export function scanPage() {
  const sources = new Map();
  let blobs = 0;
  const mediaPath = /\.(?:mp4|webm|mkv|mov|m4v|ogv|m3u8|mpd)(?:$|[?#])/i;
  function add(value, kind, base = document.baseURI) {
    if (!value || sources.size >= 100) return;
    if (value.startsWith("blob:")) { blobs += 1; return; }
    try {
      const url = new URL(value, base);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 8192) return;
      if (!sources.has(url.href)) sources.set(url.href, { url: url.href, kind, referer: location.href });
    } catch { /* Ignore non-URL player attributes. */ }
  }
  function scan(root) {
    for (const video of root.querySelectorAll("video")) {
      add(video.currentSrc || video.src, "Video");
      for (const source of video.querySelectorAll("source")) add(source.src, "Video");
    }
    for (const node of root.querySelectorAll("iframe[src], embed[src], object[data]")) add(node.src || node.data, "Embedded player");
    for (const link of root.querySelectorAll("a[href]")) if (mediaPath.test(link.href)) add(link.href, "Media link");
    for (const node of root.querySelectorAll("*")) if (node.shadowRoot) scan(node.shadowRoot);
  }
  scan(document);
  for (const entry of performance.getEntriesByType("resource")) if (mediaPath.test(entry.name)) add(entry.name, "Loaded media");
  return { sources: [...sources.values()], blobs };
}

export function networkMedia(details) {
  if (details.statusCode < 200 || details.statusCode >= 400) return false;
  const url = details.url;
  if (/\.(?:ts|m4s|aac|key)(?:$|[?#])/i.test(url)) return false;
  const type = details.responseHeaders?.find((header) => header.name.toLowerCase() === "content-type")?.value?.split(";")[0].trim().toLowerCase() || "";
  return (type.startsWith("video/") && type !== "video/mp2t") ||
    ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl", "application/dash+xml"].includes(type) ||
    /\.(?:mp4|webm|mkv|mov|m4v|ogv|m3u8|mpd)(?:$|[?#])/i.test(url);
}
