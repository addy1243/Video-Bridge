export function videoUrl(value) {
  if (typeof value !== "string" || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value)) throw new Error("Use a valid HTTP or HTTPS video/page link.");
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.port === "0") {
    throw new Error("Use an HTTP or HTTPS video/page link without embedded passwords.");
  }
  const host = url.hostname.toLowerCase();
  let id;
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    id = url.pathname === "/watch" ? url.searchParams.get("v") :
      url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
  } else if (host === "youtu.be") {
    id = url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1];
  } else if (["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(host)) {
    const post = url.pathname.match(/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d+)(?:\/video\/\d+)?\/?$/)?.[1];
    if (post) return `https://x.com/i/web/status/${post}`;
  }
  if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  return url.href;
}
