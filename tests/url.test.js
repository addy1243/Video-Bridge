import test from "node:test";
import assert from "node:assert/strict";
import { videoUrl } from "../extension/url.js";

test("video links are canonicalized without playlist or tracking parameters", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=BaW_jenozKc&list=abc",
    "https://youtube.com/shorts/BaW_jenozKc?feature=share",
    "https://youtu.be/BaW_jenozKc?t=5",
    "https://m.youtube.com/watch?v=BaW_jenozKc",
  ]) assert.equal(videoUrl(url), "https://www.youtube.com/watch?v=BaW_jenozKc");
  for (const url of ["https://x.com/person/status/1234/video/1?s=20", "https://twitter.com/person/status/1234", "https://x.com/i/web/status/1234"])
    assert.equal(videoUrl(url), "https://x.com/i/web/status/1234");
});

test("general webpages, direct media, ports, and signed queries are preserved", () => {
  for (const url of [
    "https://animenana.com/view/77475126401", "https://vimeo.com/123456789",
    "https://cdn.example.com/master.m3u8?token=abc%2Fdef&expires=123",
    "http://127.0.0.1:8080/video.mp4", "https://youtube.com.evil.test/watch?v=BaW_jenozKc",
  ]) assert.equal(videoUrl(url), url);
});

test("non-web URLs, embedded credentials, and malformed links are rejected", () => {
  for (const url of [
    "https://youtube.com@evil.test/watch?v=BaW_jenozKc",
    "file:///etc/passwd", "javascript:alert(1)", "blob:https://example.com/123",
    "https://example.com:0/video", "https://example.com/path\nheader",
    "https://example.com\\path", "not a url",
    "https://user:password@youtube.com/watch?v=BaW_jenozKc",
  ]) assert.throws(() => videoUrl(url), url);
});
