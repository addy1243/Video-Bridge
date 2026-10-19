import test from "node:test";
import assert from "node:assert/strict";
import { siteCookies } from "../extension/session.js";

test("session sharing is opt-in, scoped to the page URL, and uses the current tab's cookie store", async () => {
  assert.deepEqual(await siteCookies(null), []);
  const auth = { url: "https://example.com/watch", tabId: 7 };
  const reads = [];
  let granted = true;
  globalThis.chrome = {
    tabs: { get: async () => ({ url: "https://example.com/watch" }) },
    permissions: { contains: async () => granted },
    cookies: {
      getAllCookieStores: async () => [{ id: "regular", tabIds: [1] }, { id: "private", tabIds: [7] }],
      getAll: async (query) => { reads.push(query); return [{ name: "session", value: "fake-test-token", domain: "example.com", path: "/", hostOnly: true, secure: true, httpOnly: true }]; },
    },
  };
  try {
    const result = await siteCookies(auth);
    assert.equal(result[0].value, "fake-test-token");
    assert.deepEqual(reads, [{ url: auth.url, storeId: "private" }]);
    await assert.rejects(siteCookies({ ...auth, url: "https://unrelated.example/watch" }), /current tab/);
    assert.equal(reads.length, 1);
    granted = false;
    await assert.rejects(siteCookies(auth), /approve the browser permission/);
    assert.equal(reads.length, 1);
  } finally { delete globalThis.chrome; }
});
