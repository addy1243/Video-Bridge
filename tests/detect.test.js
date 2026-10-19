import test from "node:test";
import assert from "node:assert/strict";
import { scanPage, networkMedia } from "../extension/detect.js";

test("network detection accepts manifests and video MIME types but excludes fragments and failed requests", () => {
  const response = (url, type, statusCode = 200) => ({ url, statusCode, responseHeaders: [{ name: "Content-Type", value: type }] });
  assert.equal(networkMedia(response("https://cdn.example.com/token", "video/mp4")), true);
  assert.equal(networkMedia(response("https://cdn.example.com/master", "application/dash+xml")), true);
  assert.equal(networkMedia(response("https://cdn.example.com/stream.m3u8?token=a", "application/octet-stream")), true);
  assert.equal(networkMedia(response("https://cdn.example.com/segment.ts", "video/mp2t")), false);
  assert.equal(networkMedia(response("https://cdn.example.com/init.m4s", "video/mp4")), false);
  assert.equal(networkMedia(response("https://cdn.example.com/video.mp4", "text/html", 403)), false);
});

test("page scanning collects sources, embeds, loaded manifests, and handles blob players without fetching", () => {
  const root = { querySelectorAll: (selector) => ({
    video: [{ currentSrc: "blob:https://example.com/123", querySelectorAll: () => [{ src: "https://cdn.example.com/video.mp4?token=abc" }] }],
    "iframe[src], embed[src], object[data]": [{ src: "https://player.example.com/embed/123" }],
    "a[href]": [{ href: "https://cdn.example.com/file.webm" }],
    "*": [],
  })[selector] || [] };
  globalThis.document = { ...root, baseURI: "https://example.com/watch" };
  globalThis.location = { href: "https://example.com/watch" };
  const originalPerformance = globalThis.performance;
  globalThis.performance = { getEntriesByType: () => [{ name: "https://cdn.example.com/master.m3u8" }] };
  try {
    const result = scanPage();
    assert.equal(result.blobs, 1);
    assert.equal(result.sources.length, 4);
    assert.equal(result.sources[0].url, "https://cdn.example.com/video.mp4?token=abc");
    assert.equal(result.sources[1].kind, "Embedded player");
    assert.equal(result.sources[0].referer, location.href);
  } finally {
    delete globalThis.document;
    delete globalThis.location;
    globalThis.performance = originalPerformance;
  }
});
