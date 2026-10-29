import viewerSource from "./mapViewer.js?raw";

// Builds a single self-contained HTML file for a snapshot: the viewer source is
// inlined (with its ES exports stripped) and the scan data is embedded as JSON,
// so the page keeps working after NP deletes the game and offline.
export function buildStandaloneHtml(snapshot, notes = {}, relations = []) {
  const title = `${snapshot.gameName || "Neptune's Pride"} — tick ${snapshot.tick ?? "?"}`;
  const payload = {
    snapshot: {
      gameName: snapshot.gameName,
      gameNumber: snapshot.gameNumber,
      capturedAt: snapshot.capturedAt,
      label: snapshot.label,
      tick: snapshot.tick,
      data: snapshot.data
    },
    notes,
    relations
  };

  const script = viewerSource.replace(/^export\s+/gm, "");
  // Escape "<" so player aliases or star names can never close the script tag.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>html, body { margin: 0; height: 100%; background: #14123a; } #map { height: 100vh; }</style>
</head>
<body>
<div id="map"></div>
<script id="np-snapshot" type="application/json">${json}</script>
<script>
${script}
const payload = JSON.parse(document.getElementById("np-snapshot").textContent);
mountMap(document.getElementById("map"), payload.snapshot, { notes: payload.notes, relations: payload.relations });
</script>
</body>
</html>
`;
}

export function downloadStandaloneHtml(snapshot, notes, relations) {
  const html = buildStandaloneHtml(snapshot, notes, relations);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = String(snapshot.gameName || "np-game").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  link.href = url;
  link.download = `${safeName || "np-game"}-tick-${snapshot.tick ?? 0}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
