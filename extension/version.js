export const BUILD_VERSION = "0.4.0";

export function isCurrent(manifest, backgroundBuild) {
  return manifest.version === BUILD_VERSION && backgroundBuild === BUILD_VERSION &&
    ["scripting", "webRequest"].every((permission) => manifest.permissions?.includes(permission)) &&
    ["http://*/*", "https://*/*"].every((origin) => manifest.host_permissions?.includes(origin)) &&
    manifest.optional_permissions?.includes("cookies");
}
