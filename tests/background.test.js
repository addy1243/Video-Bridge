import test from "node:test";
import assert from "node:assert/strict";
import { BUILD_VERSION } from "../extension/version.js";

test("background owns the native connection and saves completion or disconnect errors", async () => {
  let listener;
  let connection;
  let saved;
  let cleared = false;
  let updater;
  let alarmListener;
  let installedListener;
  let headerListener;
  let navigationListener;
  let captureSession = {};
  const alarms = new Map();
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      onInstalled: { addListener: (fn) => { installedListener = fn; } },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: (fn) => { listener = fn; } },
      connectNative: () => {
        connection = {
          onMessage: { addListener: (fn) => { connection.receive = fn; } },
          onDisconnect: { addListener: (fn) => { connection.disconnected = fn; } },
          postMessage(message) {
            this.request = message;
            if (message.action === "check") queueMicrotask(() => this.receive({ status: "ready", message: "Helper ready" }));
            if (message.action === "inspect") queueMicrotask(() => this.receive({ status: "inspected", videos: [] }));
          },
          disconnect() { this.disconnected(); },
        };
        return connection;
      },
      sendNativeMessage: async () => ({ status: "ready", message: "Helper ready" }),
    },
    tabs: { get: async (id) => ({ id, url: "https://example.com/watch" }), onRemoved: { addListener: () => {} } },
    permissions: { contains: async () => true },
    cookies: {
      getAllCookieStores: async () => [{ id: "test-store", tabIds: [7] }],
      getAll: async () => [{ name: "session", value: "fake-session-value", domain: "example.com", path: "/", hostOnly: true, secure: true, httpOnly: true }],
    },
    webRequest: {
      onHeadersReceived: { addListener: (fn) => { headerListener = fn; } },
      onBeforeRequest: { addListener: (fn) => { navigationListener = fn; } },
    },
    storage: { session: {
      get: async () => structuredClone(captureSession),
      set: async (value) => { captureSession = value; },
    }, local: {
      get: async (key) => key === "updater" ? { updater } : { download: cleared ? undefined : saved || { status: "downloading" } },
      set: async (value) => { if (value.download) saved = value.download; if (value.updater) updater = value.updater; },
      remove: async (key) => { assert.equal(key, "download"); saved = undefined; cleared = true; },
    } },
    alarms: {
      get: async (name) => alarms.get(name),
      create: async (name, options) => alarms.set(name, options),
      onAlarm: { addListener: (fn) => { alarmListener = fn; } },
    },
  };
  await import("../extension/background.js");
  const request = (message) => new Promise((resolve) => listener(message, { id: "test-extension" }, resolve));
  assert.equal((await request({ type: "status" })).status, "error");
  assert.equal((await request({ type: "status" })).build, BUILD_VERSION);
  assert.equal((await request({ type: "check" })).status, "ready");
  assert.equal((await request({ type: "inspect", url: "https://youtu.be/BaW_jenozKc" })).status, "inspected");
  assert.equal((await request({ type: "download", url: "file:///secret", quality: "best" })).status, "error");
  assert.equal((await request({ type: "captureStart", tabId: 7 })).status, "capture");
  headerListener({ tabId: 8, statusCode: 200, url: "https://cdn.example.com/ignored.mp4" });
  headerListener({ tabId: 7, statusCode: 200, url: "https://cdn.example.com/segment.ts", responseHeaders: [{ name: "Content-Type", value: "video/mp2t" }] });
  headerListener({ tabId: 7, statusCode: 200, url: "https://cdn.example.com/master.m3u8?token=abc", initiator: "https://player.example.com" });
  await new Promise((resolve) => setImmediate(resolve));
  const detected = (await request({ type: "captureStatus", tabId: 7 })).capture;
  assert.equal(detected.sources.length, 1);
  assert.equal(detected.sources[0].referer, "https://player.example.com/");
  navigationListener({ tabId: 7, url: "https://example.com/another-page" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await request({ type: "captureStatus", tabId: 7 })).capture, null);
  const command = { type: "download", url: "https://youtu.be/BaW_jenozKc?list=x", referer: "https://example.com/watch", quality: "best", selection: { entry: 1, formatId: "137" }, auth: { url: "https://example.com/watch", tabId: 7 } };
  assert.equal((await request(command)).status, "starting");
  assert.equal(connection.request.url, "https://www.youtube.com/watch?v=BaW_jenozKc");
  assert.equal(connection.request.cookies[0].value, "fake-session-value");
  assert.equal(JSON.stringify(saved).includes("fake-session-value"), false);
  assert.match((await request(command)).message, /already running/);
  assert.match((await request({ type: "clearHistory" })).message, /Wait for/);
  assert.equal(cleared, false);
  alarmListener({ name: "downloader-update" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alarms.get("retry-update").delayInMinutes, 10);
  connection.receive({ status: "downloading", percent: 40, message: "Video" });
  assert.equal((await request({ type: "status" })).percent, 40);
  connection.receive({ status: "complete", path: "C:/Downloads/video.mp4", message: "Saved", percent: 100 });
  assert.equal((await request({ type: "status" })).status, "complete");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved.path, "C:/Downloads/video.mp4");
  await request(command);
  chrome.runtime.lastError = { message: "Native host missing" };
  connection.disconnected();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await request({ type: "status" })).message, "Native host missing");
  delete chrome.runtime.lastError;
  assert.match((await request({ type: "resume" })).message, /Enable Use this site's signed-in session/);
  assert.equal((await request({ type: "resume", auth: command.auth })).status, "starting");
  assert.deepEqual(connection.request.selection, command.selection);
  assert.equal(connection.request.referer, command.referer);
  connection.receive({ status: "error", message: "Network unavailable" });
  await new Promise((resolve) => setImmediate(resolve));
  // Recreate the service worker to verify that the resume request survives a restart.
  await import("../extension/background.js?restart=1");
  assert.equal((await request({ type: "resume", auth: command.auth })).status, "starting");
  assert.deepEqual(connection.request.selection, command.selection);
  connection.receive({ status: "complete", message: "Saved" });
  await new Promise((resolve) => setImmediate(resolve));
  const updating = request({ type: "update" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connection.request.action, "update");
  assert.equal((await request(command)).status, "error");
  connection.receive({ status: "updated", message: "Up to date" });
  assert.equal((await updating).status, "updated");
  assert.equal(updater.message, "Up to date");
  installedListener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alarms.get("downloader-update").periodInMinutes, 1440);
  assert.equal((await request({ type: "clearHistory" })).status, "idle");
  assert.equal(saved, undefined);
  assert.equal(updater.message, "Up to date");
  assert.equal((await request({ type: "status" })).request, undefined);
  assert.match((await request({ type: "resume" })).message, /No saved download/);
  await import("../extension/background.js?cleared=1");
  assert.equal((await request({ type: "status" })).status, "idle");
  delete globalThis.chrome;
});
