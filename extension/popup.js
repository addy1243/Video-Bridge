import { videoUrl } from "./url.js";
import { metrics, formatLabel } from "./display.js";
import { BUILD_VERSION, isCurrent } from "./version.js";

const $ = (id) => document.getElementById(id);
let checking = false;
let loadingChoices = false;
let videos = [];
let choicesUrl = null;
let generation = 0;
let currentTabId = null;
let sources = [];
let detecting = false;
let finding = false;
let needsReload = true;
let canReload = false;
let sessionHost = null;
let lastState = { status: "idle" };
function sessionAuth() {
  if (!$("useSession").checked) return null;
  const url = videoUrl($("url").value.trim());
  if (new URL(url).hostname !== sessionHost) throw new Error("The site changed. Enable session sharing again for this site.");
  return { url, tabId: currentTabId };
}
$("useSession").addEventListener("change", async () => {
  sessionHost = null;
  if (!$("useSession").checked) { $("sessionMessage").textContent = "Session sharing is off."; return; }
  try {
    if (needsReload) throw new Error("Reload VideoBridge before enabling session sharing.");
    const host = new URL(videoUrl($("url").value.trim())).hostname;
    if (!await chrome.permissions.request({ permissions: ["cookies"] })) throw new Error("Cookie permission declined. Session sharing stays off.");
    sessionHost = host;
    $("sessionMessage").textContent = `Session sharing enabled for ${host}. Cookies are read only when you request formats or a download. They are not saved.`;
  } catch (error) { $("useSession").checked = false; $("sessionMessage").textContent = error.message; }
});
function checkVersion(state) {
  const manifest = chrome.runtime.getManifest();
  needsReload = !isCurrent(manifest, state?.build);
  const busy = state && (["starting", "downloading", "processing"].includes(state.status) || state.helperBusy);
  canReload = Boolean(state?.status) && !busy;
  $("version").textContent = needsReload ? `Files v${BUILD_VERSION} · loaded v${manifest.version}` : `v${BUILD_VERSION}`;
  $("reloadNotice").hidden = !needsReload;
  $("reload").disabled = !canReload;
  $("reloadMessage").textContent = busy ? "Finish the current operation before reloading."
    : state ? "New files are ready. Reload to activate the current background worker and site permissions."
      : "The background worker could not be reached. Open the extensions page and reload VideoBridge after any downloads finish.";
}
function selectedSource() {
  const source = sources[Number($("source").value)];
  return source || { url: videoUrl($("url").value.trim()), referer: null };
}
function addSources(found) {
  const selectedUrl = selectedSource().url;
  const merged = new Map(sources.map((source) => [source.url, source]));
  for (const source of found) {
    if (merged.size >= 200) break;
    try {
      const url = videoUrl(source.url);
      if (!merged.has(url)) merged.set(url, { ...source, url });
    } catch { /* Ignore unsupported browser-only sources. */ }
  }
  if (merged.size === sources.length) return;
  sources = [...merged.values()];
  $("source").replaceChildren(...sources.map((source, index) => {
    const url = new URL(source.url);
    return new Option(`${source.kind}: ${url.hostname}${url.pathname.slice(0, 90)}`, String(index));
  }));
  const previous = sources.findIndex((source) => source.url === selectedUrl);
  if (previous >= 0) $("source").value = String(previous);
  $("sourceGroup").hidden = !sources.length;
}
function resetChoices() {
  generation += 1;
  choicesUrl = null;
  videos = [];
  $("videoGroup").hidden = true;
  $("quality").replaceChildren(new Option("Best available", "best"), new Option("Prefer 1080p", "1080"), new Option("Prefer 720p", "720"));
  $("choicesMessage").textContent = "";
}
function showFormats() {
  const video = videos[Number($("video").value)];
  $("quality").replaceChildren(new Option("Best available", "best"));
  for (const format of video?.formats || []) $("quality").add(new Option(formatLabel(format), `format:${format.id}`));
}
function render(state) {
  lastState = state;
  const busy = ["starting", "downloading", "processing"].includes(state.status);
  const unavailable = needsReload || busy || state.helperBusy || loadingChoices || finding;
  for (const id of ["download", "scan", "check", "update", "resume", "find"]) $(id).disabled = Boolean(unavailable);
  $("detect").disabled = needsReload || currentTabId === null;
  $("useSession").disabled = Boolean(unavailable);
  $("clearHistory").disabled = Boolean(unavailable) || state.status === "idle";
  $("resume").hidden = state.status !== "error" || !state.request;
  $("status").textContent = ({ idle: "Ready", starting: "Starting", downloading: "Downloading", processing: "Joining audio and video", complete: "Saved", error: "Needs attention" })[state.status] || "Ready";
  $("message").textContent = state.message || "";
  $("path").textContent = state.path || "";
  $("metrics").textContent = metrics(state);
  $("progress").hidden = !busy;
  if (Number.isFinite(state.percent)) $("progress").value = state.percent;
  else $("progress").removeAttribute("value");
}
async function refresh() {
  if (!checking) {
    let state;
    try { state = await chrome.runtime.sendMessage({ type: "status" }); }
    catch (error) { checkVersion(null); render({ ...lastState, message: error.message }); return; }
    checkVersion(state);
    render(state || { status: "error", message: "The background worker did not respond." });
  }
  if (needsReload) return;
  const { updater } = await chrome.storage.local.get("updater");
  if (updater) $("updater").textContent = updater.message;
  if (currentTabId !== null) {
    const result = await chrome.runtime.sendMessage({ type: "captureStatus", tabId: currentTabId });
    const capture = result.capture;
    detecting = Boolean(capture);
    $("detect").textContent = detecting ? "Stop streaming detection" : "Detect streaming video";
    let enteredUrl;
    try { enteredUrl = videoUrl($("url").value.trim()); } catch { /* An unfinished pasted link is not a capture target. */ }
    if (capture && enteredUrl === capture.pageUrl) {
      if (!sources.length) addSources([{ url: capture.pageUrl, referer: null, kind: "Webpage" }]);
      addSources(capture.sources);
      $("detection").textContent = `Detection active for this tab · ${capture.sources.length} media link(s). Start or seek the video, then choose a detected stream. Stops after 15 minutes or navigation.`;
    }
  }
}
$("url").addEventListener("input", () => {
  if (sessionHost) {
    try { if (new URL(videoUrl($("url").value.trim())).hostname !== sessionHost) $("useSession").checked = false; }
    catch { $("useSession").checked = false; }
    if (!$("useSession").checked) { sessionHost = null; $("sessionMessage").textContent = "The site changed. Session sharing is off."; }
  }
  sources = [];
  $("sourceGroup").hidden = true;
  resetChoices();
});
$("source").addEventListener("change", resetChoices);
$("find").addEventListener("click", async () => {
  if (needsReload) return;
  finding = true;
  render(lastState);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = videoUrl(tab.url);
    const result = await chrome.runtime.sendMessage({ type: "pageScan", tabId: tab.id });
    if (result.status !== "scanned") throw new Error(result.message || "Could not scan this page.");
    $("url").value = pageUrl;
    sources = [];
    resetChoices();
    addSources([{ url: pageUrl, referer: null, kind: "Webpage" }, ...result.sources]);
    $("detection").textContent = result.sources.length
      ? `Found ${result.sources.length} possible media/player link(s). Choose one below, then Show available choices.`
      : result.blobs ? "The player uses a browser-only blob URL. Enable streaming detection, then start or seek playback."
        : "No media link found yet. Start playback, or enable streaming detection and try again.";
  } catch (error) { $("detection").textContent = error.message; }
  finally { finding = false; render(lastState); }
});
$("detect").addEventListener("click", async () => {
  if (needsReload) return;
  try {
    if (!detecting && !await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] })) {
      $("detection").textContent = "Allow VideoBridge access to all sites in the extension's Details > Site access settings, then retry.";
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: detecting ? "captureStop" : "captureStart", tabId: currentTabId });
    if (result.status !== "capture") throw new Error(result.message || "Could not change streaming detection.");
    detecting = Boolean(result.capture);
    $("detection").textContent = detecting ? "Start or seek the video in this tab, then reopen VideoBridge to see detected streams." : "Streaming detection stopped.";
    await refresh();
  } catch (error) { $("detection").textContent = error.message; }
});
$("video").addEventListener("change", showFormats);
$("scan").addEventListener("click", async () => {
  const currentGeneration = ++generation;
  loadingChoices = true;
  render(lastState);
  $("choicesMessage").textContent = "Finding available formats…";
  try {
    const { url, referer } = selectedSource();
    const result = await chrome.runtime.sendMessage({ type: "inspect", url, referer, auth: sessionAuth() });
    if (currentGeneration !== generation) return;
    if (result.status !== "inspected") throw new Error(result.message || "Could not load choices. Update the helper and retry.");
    videos = result.videos;
    choicesUrl = url;
    $("video").replaceChildren(...videos.map((video, index) => new Option(video.title, String(index))));
    $("videoGroup").hidden = videos.length < 2;
    showFormats();
    $("choicesMessage").textContent = "Choose a format below. Video-only sizes exclude the additional audio.";
  } catch (error) {
    if (currentGeneration === generation) $("choicesMessage").textContent = error.message;
  } finally { loadingChoices = false; render(lastState); }
});
$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const { url, referer } = selectedSource();
    const chosen = $("quality").value;
    const video = videos[Number($("video").value)];
    const selection = choicesUrl === url && video
      ? { formatId: chosen.startsWith("format:") ? chosen.slice(7) : null, entry: video.entry } : null;
    render({ status: "starting", message: "Starting download…" });
    render(await chrome.runtime.sendMessage({ type: "download", url, referer, quality: selection ? "best" : chosen, selection, auth: sessionAuth() }));
  } catch (error) { render({ status: "error", message: error.message }); }
});
$("resume").addEventListener("click", async () => {
  try { render(await chrome.runtime.sendMessage({ type: "resume", auth: sessionAuth() })); }
  catch (error) { render({ ...lastState, status: "error", message: error.message }); }
});
$("clearHistory").addEventListener("click", async () => {
  $("clearHistory").disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "clearHistory" });
    render(result);
    if (result.status === "idle") {
      sources = [];
      detecting = false;
      $("sourceGroup").hidden = true;
      $("detect").textContent = "Detect streaming video";
      $("detection").textContent = "History and detected links cleared.";
      resetChoices();
      $("useSession").checked = false;
      sessionHost = null;
      $("sessionMessage").textContent = "Session sharing is off.";
    }
  }
  catch (error) { render({ ...lastState, message: error.message }); }
});
$("update").addEventListener("click", async () => {
  $("update").disabled = true;
  $("updater").textContent = "Checking for downloader updates…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "update" });
    $("updater").textContent = result.message;
  } catch (error) { $("updater").textContent = error.message; }
  finally { await refresh(); }
});
$("extensionId").value = chrome.runtime.id;
$("copyId").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(chrome.runtime.id); $("copyId").textContent = "Copied"; }
  catch { $("extensionId").select(); }
});
$("check").addEventListener("click", async () => {
  checking = true;
  $("check").disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "check" });
    $("helper").textContent = result.message;
  } catch (error) { $("helper").textContent = error.message; }
  finally { $("check").disabled = false; checking = false; }
});
$("reload").addEventListener("click", () => { if (canReload) chrome.runtime.reload(); });
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = Number.isInteger(tab?.id) ? tab.id : null;
  try { $("url").value = videoUrl(tab?.url || ""); } catch { /* A pasted video link works on other tabs. */ }
  await refresh();
}
render(lastState);
init().catch((error) => { checkVersion(null); render({ status: "error", message: error.message }); });
setInterval(() => refresh().catch((error) => render({ status: "error", message: error.message })), 1000);
