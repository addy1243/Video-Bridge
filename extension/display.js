export function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return "Unknown size";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function metrics(state) {
  if (!Number.isFinite(state.downloaded)) return "";
  const parts = [`${state.status === "complete" ? "Saved" : "Current stream"}: ${bytes(state.downloaded)}`];
  if (Number.isFinite(state.total)) parts[0] += ` / ${state.estimated ? "~" : ""}${bytes(state.total)}`;
  if (Number.isFinite(state.speed) && state.speed > 0) parts.push(`${bytes(state.speed)}/s`);
  if (Number.isFinite(state.eta) && state.eta >= 0) {
    const seconds = Math.ceil(state.eta);
    parts.push(`${Math.floor(seconds / 60)}m ${seconds % 60}s remaining`);
  }
  return parts.join(" · ");
}

export function formatLabel(format) {
  const resolution = format.width && format.height ? `${format.width}×${format.height}` : "Video";
  const parts = [resolution, format.fps ? `${format.fps} fps` : null, format.ext?.toUpperCase(), format.codec];
  if (Number.isFinite(format.size)) parts.push(`${format.approximate ? "~" : ""}${bytes(format.size)}${format.audio ? "" : " + audio"}`);
  return parts.filter(Boolean).join(" · ") + ` [${format.id}]`;
}
