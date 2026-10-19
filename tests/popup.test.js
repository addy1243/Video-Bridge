import test from "node:test";
import assert from "node:assert/strict";
import { BUILD_VERSION } from "../extension/version.js";

test("popup downloads the selected post video and ignores outdated scan results", async () => {
  class Element {
    constructor(value = "") { this.value = value; this.listeners = {}; this.children = []; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ""; }
    add(child) { this.children.push(child); }
    removeAttribute() {}
    select() {}
  }
  const ids = ["url", "quality", "video", "form", "scan", "choicesMessage", "videoGroup", "download", "status", "message", "path", "metrics", "progress", "resume", "clearHistory", "check", "helper", "update", "updater", "extensionId", "copyId", "find", "detect", "detection", "source", "sourceGroup", "version", "reloadNotice", "reloadMessage", "reload", "useSession", "sessionMessage"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.quality.value = "best";
  const requests = [];
  let scanReply;
  let capture = null;
  let manifestVersion = BUILD_VERSION;
  let workerBuild = BUILD_VERSION;
  let workerStatus = "idle";
  let permissionGranted = true;
  let reloaded = false;
  let interval;
  const formats = [{ id: "137", width: 1920, height: 1080, ext: "mp4", codec: "h264" }];
  const originalInterval = globalThis.setInterval;
  globalThis.setInterval = (fn) => { interval = fn; return 1; };
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  globalThis.document = { getElementById: (id) => elements[id] };
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 7, url: "https://x.com/person/status/1234" }] },
    permissions: { contains: async () => permissionGranted, request: async () => permissionGranted },
    storage: { local: { get: async () => ({}) } },
    runtime: {
      id: "a".repeat(32),
      getManifest: () => ({ version: manifestVersion, permissions: ["scripting", "webRequest"], host_permissions: ["http://*/*", "https://*/*"], optional_permissions: ["cookies"] }),
      reload: () => { reloaded = true; },
      sendMessage: async (message) => {
        requests.push(message);
        if (message.type === "inspect") return new Promise((resolve) => { scanReply = resolve; });
        if (message.type === "pageScan") return { status: "scanned", sources: [{ url: "https://cdn.example.com/master.m3u8?token=abc", kind: "Loaded media", referer: "https://x.com/i/web/status/1234" }], blobs: 1 };
        if (message.type === "captureStart") capture = { pageUrl: "https://x.com/i/web/status/1234", sources: [] };
        if (["captureStart", "captureStatus"].includes(message.type)) return { status: "capture", capture };
        return { status: message.type === "status" ? workerStatus : "idle", message: "Ready", build: workerBuild };
      },
    },
  };
  try {
    await import("../extension/popup.js");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(elements.url.value, "https://x.com/i/web/status/1234");
    const scan = elements.scan.listeners.click();
    scanReply({ status: "inspected", videos: [{ entry: 1, title: "First", formats }, { entry: 2, title: "Second", formats }] });
    await scan;
    assert.equal(elements.videoGroup.hidden, false);
    elements.video.value = "1";
    elements.video.listeners.change();
    elements.quality.value = "format:137";
    await elements.form.listeners.submit({ preventDefault() {} });
    assert.deepEqual(requests.at(-1).selection, { entry: 2, formatId: "137" });
    elements.quality.value = "best";
    await elements.form.listeners.submit({ preventDefault() {} });
    assert.deepEqual(requests.at(-1).selection, { entry: 2, formatId: null });
    assert.equal(requests.at(-1).auth, null);
    elements.useSession.checked = true;
    await elements.useSession.listeners.change();
    await elements.form.listeners.submit({ preventDefault() {} });
    assert.deepEqual(requests.at(-1).auth, { url: "https://x.com/i/web/status/1234", tabId: 7 });
    const outdated = elements.scan.listeners.click();
    elements.url.value = "https://youtu.be/BaW_jenozKc";
    elements.url.listeners.input();
    assert.equal(elements.useSession.checked, false);
    scanReply({ status: "inspected", videos: [{ entry: 1, title: "Wrong video", formats }] });
    await outdated;
    assert.equal(elements.videoGroup.hidden, true);
    assert.equal(elements.quality.value, "best");
    await elements.find.listeners.click();
    assert.equal(elements.sourceGroup.hidden, false);
    elements.source.value = "1";
    elements.source.listeners.change();
    await elements.form.listeners.submit({ preventDefault() {} });
    assert.equal(requests.at(-1).url, "https://cdn.example.com/master.m3u8?token=abc");
    assert.equal(requests.at(-1).referer, "https://x.com/i/web/status/1234");
    await elements.detect.listeners.click();
    assert.equal(elements.detect.textContent, "Stop streaming detection");
    await elements.clearHistory.listeners.click();
    assert.equal(requests.at(-1).type, "clearHistory");
    assert.equal(elements.resume.hidden, true);
    assert.equal(elements.path.textContent, "");
    assert.equal(elements.metrics.textContent, "");
    assert.equal(elements.version.textContent, `v${BUILD_VERSION}`);
    manifestVersion = "0.2.1";
    workerBuild = undefined;
    await interval();
    assert.equal(elements.reloadNotice.hidden, false);
    assert.equal(elements.find.disabled, true);
    assert.equal(elements.detect.disabled, true);
    const previousRequests = requests.length;
    await elements.find.listeners.click();
    await elements.detect.listeners.click();
    assert.equal(requests.length, previousRequests);
    elements.reload.listeners.click();
    assert.equal(reloaded, true);
    reloaded = false;
    workerStatus = "downloading";
    await interval();
    assert.equal(elements.reload.disabled, true);
    elements.reload.listeners.click();
    assert.equal(reloaded, false);
    manifestVersion = BUILD_VERSION;
    workerBuild = BUILD_VERSION;
    workerStatus = "idle";
    await interval();
    assert.equal(elements.reloadNotice.hidden, true);
    assert.equal(elements.find.disabled, false);
    // A withheld site grant gets actionable settings guidance, not another request.
    await elements.clearHistory.listeners.click();
    permissionGranted = false;
    await elements.detect.listeners.click();
    assert.match(elements.detection.textContent, /Details > Site access/);
  } finally {
    globalThis.setInterval = originalInterval;
    delete globalThis.Option;
    delete globalThis.document;
    delete globalThis.chrome;
  }
});
