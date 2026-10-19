import test from "node:test";
import assert from "node:assert/strict";
import { bytes, metrics, formatLabel } from "../extension/display.js";

test("progress labels handle unknown totals, estimated sizes, and resumed bytes", () => {
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(1024), "1.0 KiB");
  assert.equal(metrics({}), "");
  assert.match(metrics({ downloaded: 2048, total: 4096, estimated: true, speed: 1024, eta: 62 }), /2.0 KiB \/ ~4.0 KiB · 1.0 KiB\/s · 1m 2s/);
  assert.equal(metrics({ downloaded: 1024 }), "Current stream: 1.0 KiB");
  assert.match(formatLabel({ id: "137", width: 1920, height: 1080, fps: 30, ext: "mp4", size: 1048576, approximate: true, audio: false }), /1920×1080.*MP4.*~1.0 MiB \+ audio.*137/);
});
