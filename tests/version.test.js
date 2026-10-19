import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILD_VERSION, isCurrent } from "../extension/version.js";

test("manifest and worker builds agree and include the required stream-detection permissions", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, BUILD_VERSION);
  assert.equal(isCurrent(manifest, BUILD_VERSION), true);
  assert.equal(isCurrent(manifest, undefined), false);
  assert.equal(isCurrent({ ...manifest, version: "0.2.1" }, BUILD_VERSION), false);
  assert.equal(isCurrent({ ...manifest, host_permissions: [] }, BUILD_VERSION), false);
  assert.equal(isCurrent({ ...manifest, permissions: [] }, BUILD_VERSION), false);
});
