import { videoUrl } from "./url.js";
import { scanPage, networkMedia } from "./detect.js";
import { BUILD_VERSION } from "./version.js";
import { siteCookies } from "./session.js";

const HOST = "com.videobridge.downloader";
let port = null;
let preparing = false;
let captures = {};
const captureReady = chrome.storage.session.get("captures").then((value) => { captures = value.captures || {}; });
let captureSaving = Promise.resolve();
function saveCaptures() {
  const snapshot = structuredClone(captures);
  captureSaving = captureSaving.catch(() => {}).then(() => chrome.storage.session.set({ captures: snapshot }));
  return captureSaving;
}
function withoutHash(value) { const url = new URL(value); url.hash = ""; return url.href; }

chrome.webRequest.onHeadersReceived.addListener((details) => {
  captureReady.then(async () => {
    const capture = captures[details.tabId];
    if (!capture || Date.now() > capture.expires || !networkMedia(details) || capture.sources.length >= 100) return;
    const url = videoUrl(details.url);
    if (capture.sources.some((source) => source.url === url)) return;
    let referer = capture.pageUrl;
    try { referer = videoUrl(details.initiator); } catch { /* Use the opted-in page when the initiator is unavailable. */ }
    capture.sources.push({ url, kind: "Detected stream", referer });
    await saveCaptures();
  }).catch(() => {});
}, { urls: ["http://*/*", "https://*/*"] }, ["responseHeaders"]);

chrome.webRequest.onBeforeRequest.addListener((details) => {
  captureReady.then(async () => {
    const capture = captures[details.tabId];
    if (capture && withoutHash(details.url) !== withoutHash(capture.pageUrl)) {
      delete captures[details.tabId];
      await saveCaptures();
    }
  }).catch(() => {});
}, { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] });
chrome.tabs.onRemoved.addListener((tabId) => {
  captureReady.then(async () => { delete captures[tabId]; await saveCaptures(); }).catch(() => {});
});
let state = { status: "idle", message: "Ready to download." };
const ready = chrome.storage.local.get("download").then(({ download }) => {
  if (download) state = ["starting", "downloading", "processing"].includes(download.status)
    ? { ...download, status: "error", message: "Browser connection ended. Retry to resume any partial download." }
    : download;
});
let saving = Promise.resolve();
function update(change) {
  state = { ...state, ...change };
  const snapshot = { ...state };
  saving = saving.catch(() => {}).then(() => chrome.storage.local.set({ download: snapshot }));
}

function nativeCall(request, progress = () => {}) {
  if (port) return Promise.reject(new Error("The helper is busy. Wait for the current operation."));
  return new Promise((resolve, reject) => {
    const connection = chrome.runtime.connectNative(HOST);
    port = connection;
    let finished = false;
    function finish(error, result) {
      if (finished) return;
      finished = true;
      if (port === connection) port = null;
      connection.disconnect();
      if (error) reject(error);
      else resolve(result);
    }
    connection.onMessage.addListener((result) => {
      if (result.status === "error") return finish(new Error(result.message));
      if (["ready", "inspected", "complete", "updated"].includes(result.status)) return finish(null, result);
      progress(result);
    });
    connection.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (!finished) finish(new Error(error || "Helper disconnected. You can resume partial downloads."));
    });
    try { connection.postMessage(request); } catch (error) { finish(error); }
  });
}

async function updateHelper(automatic = false) {
  if (port || preparing) {
    if (automatic) {
      await chrome.alarms.create("retry-update", { delayInMinutes: 10 });
      return;
    }
    throw new Error("Wait for the current helper operation to finish.");
  }
  preparing = true;
  try {
    await chrome.storage.local.set({ updater: { status: "updating", message: "Checking for downloader updates…" } });
    const pending = nativeCall({ action: "update" });
    preparing = false;
    const result = await pending;
    await chrome.storage.local.set({ updater: { ...result, checkedAt: Date.now() } });
    return result;
  } catch (error) {
    const result = { status: "error", message: error.message, checkedAt: Date.now() };
    await chrome.storage.local.set({ updater: result });
    return result;
  } finally {
    preparing = false;
  }
}

async function handle(message) {
  await ready;
  if (message.type === "status") return { ...state, build: BUILD_VERSION, helperBusy: Boolean(port) || preparing };
  if (preparing) throw new Error("The helper is starting an operation. Please wait.");
  if (["pageScan", "captureStart", "captureStop", "captureStatus"].includes(message.type)) {
    if (!Number.isInteger(message.tabId)) throw new Error("No browser tab selected.");
    await captureReady;
    if (message.type === "pageScan") {
      let results;
      try { results = await chrome.scripting.executeScript({ target: { tabId: message.tabId, allFrames: true }, func: scanPage }); }
      catch { results = await chrome.scripting.executeScript({ target: { tabId: message.tabId }, func: scanPage }); }
      return { status: "scanned", sources: results.flatMap((frame) => frame.result?.sources || []), blobs: results.reduce((sum, frame) => sum + (frame.result?.blobs || 0), 0) };
    }
    if (message.type === "captureStart") {
      if (!await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] })) throw new Error("Allow VideoBridge access to all sites in the extension's Details > Site access settings, then retry.");
      const tab = await chrome.tabs.get(message.tabId);
      captures[message.tabId] = { pageUrl: videoUrl(tab.url), sources: [], expires: Date.now() + 15 * 60 * 1000 };
      await saveCaptures();
    }
    if (message.type === "captureStop" || (captures[message.tabId] && Date.now() > captures[message.tabId].expires)) {
      delete captures[message.tabId];
      await saveCaptures();
    }
    return { status: "capture", capture: captures[message.tabId] || null };
  }
  if (message.type === "clearHistory") {
    if (port) throw new Error("Wait for the current helper operation before clearing history.");
    preparing = true;
    try {
      saving = saving.catch(() => {}).then(() => chrome.storage.local.remove("download"));
      await saving;
      await captureReady;
      captures = {};
      await saveCaptures();
      state = { status: "idle", message: "History cleared. Downloaded files kept." };
      return state;
    } finally { preparing = false; }
  }
  if (message.type === "check") return nativeCall({ action: "check" });
  if (message.type === "update") return updateHelper();
  if (message.type === "inspect") {
    if (port) throw new Error("The helper is busy. Please wait.");
    preparing = true;
    try {
      const cookies = await siteCookies(message.auth);
      const pending = nativeCall({ action: "inspect", url: videoUrl(message.url), referer: message.referer ? videoUrl(message.referer) : null,
        cookies, cookieUrl: message.auth?.url || null });
      return await pending;
    } finally { preparing = false; }
  }
  if (!["download", "resume"].includes(message.type)) throw new Error("Unknown action.");
  if (port) throw new Error("A download or helper operation is already running.");
  const command = message.type === "resume" ? state.request : message;
  if (!command) throw new Error("No saved download to resume.");
  if (message.type === "resume" && command.auth && (!message.auth || new URL(videoUrl(message.auth.url)).hostname !== new URL(command.auth.url).hostname)) {
    throw new Error("Enable Use this site's signed-in session for the original site before resuming this download.");
  }
  const url = videoUrl(command.url);
  if (!["best", "1080", "720"].includes(command.quality)) throw new Error("Invalid quality.");
  const selection = command.selection || null;
  if (selection && ((selection.formatId !== null && !/^[A-Za-z0-9_.-]{1,100}$/.test(selection.formatId)) ||
      !Number.isInteger(selection.entry) || selection.entry < 1 || selection.entry > 1000)) throw new Error("Invalid format selection.");
  const auth = message.auth ? { url: videoUrl(message.auth.url), tabId: message.auth.tabId } : null;
  const request = { action: "download", url, quality: command.quality, selection, referer: command.referer ? videoUrl(command.referer) : null, auth };
  preparing = true;
  try {
    const cookies = await siteCookies(auth);
    state = { status: "starting", url, request, message: "Connecting to local helper…", percent: null };
    update({});
    // Persist choices and consent metadata, never cookie values. Resume asks for fresh consent.
    await saving;
    nativeCall({ ...request, cookies, cookieUrl: auth?.url || null }, update).then(update, (error) => update({ status: "error", message: error.message, percent: null, speed: null, eta: null }));
    return state;
  } finally { preparing = false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  handle(message).then(respond, (error) => respond({ status: "error", message: error.message }));
  return true;
});

async function scheduleUpdates() {
  if (!await chrome.alarms.get("downloader-update")) {
    await chrome.alarms.create("downloader-update", { delayInMinutes: 1, periodInMinutes: 24 * 60 });
  }
  const { updater } = await chrome.storage.local.get("updater");
  if (updater?.status === "updating" || (updater?.checkedAt && Date.now() - updater.checkedAt > 24 * 60 * 60 * 1000)) {
    await chrome.alarms.create("retry-update", { delayInMinutes: 1 });
  }
}
chrome.runtime.onInstalled.addListener(() => { scheduleUpdates().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { scheduleUpdates().catch(() => {}); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (["downloader-update", "retry-update"].includes(alarm.name)) updateHelper(true).catch(() => {});
});
