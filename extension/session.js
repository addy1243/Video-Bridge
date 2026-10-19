import { videoUrl } from "./url.js";

export async function siteCookies(auth) {
  if (!auth) return [];
  if (!Number.isInteger(auth.tabId)) throw new Error("Open the signed-in video page and enable session sharing again.");
  const url = videoUrl(auth.url);
  const tab = await chrome.tabs.get(auth.tabId);
  if (new URL(videoUrl(tab.url)).hostname !== new URL(url).hostname) throw new Error("Open this site's signed-in page in the current tab before sharing its session.");
  if (!await chrome.permissions.contains({ permissions: ["cookies"] })) throw new Error("Enable Use this site's signed-in session and approve the browser permission.");
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find((entry) => entry.tabIds.includes(auth.tabId));
  if (!store) throw new Error("The current browser cookie store could not be identified.");
  const cookies = (await chrome.cookies.getAll({ url, storeId: store.id })).map((cookie) => ({
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
    secure: cookie.secure, httpOnly: cookie.httpOnly, hostOnly: cookie.hostOnly,
    expirationDate: cookie.expirationDate ?? null,
  }));
  if (!cookies.length) throw new Error("No session cookies apply to this page. Sign in in this browser window and retry.");
  if (cookies.length > 100 || new TextEncoder().encode(JSON.stringify(cookies)).length > 32768) throw new Error("This page's cookies exceed the safe transfer limit.");
  return cookies;
}
