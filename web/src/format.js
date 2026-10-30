export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "never";
}

export function renderMentions(text) {
  // Intel strings wrap names as [[Name]]; show them as plain highlighted names.
  return String(text || "").split(/(\[\[[^[\]]+\]\])/g).map((part, index) =>
    part.startsWith("[[") ? { key: index, mention: part.slice(2, -2) } : { key: index, text: part });
}

// The map viewer (and exported HTML) takes notes keyed by lowercased alias.
export function notesForExport(notes) {
  return Object.fromEntries(notes.list.map((item) => [item.aliasKey, { rating: item.rating, note: item.note }]));
}

// Your nickname wins; the NP name stays visible as secondary text.
export function gameTitle(game, gameNumber) {
  return game?.nickname || game?.name || `Game ${game?.gameNumber || gameNumber}`;
}

export function gameFacts(game) {
  const parts = [];
  if (game.nickname && game.name) parts.push(game.name);
  parts.push(`#${game.gameNumber}`);
  if (game.playerCount) parts.push(`${game.playerCount} players`);
  if (game.myAlias) parts.push(`you: ${game.myAlias}`);
  return parts.join(" · ");
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
