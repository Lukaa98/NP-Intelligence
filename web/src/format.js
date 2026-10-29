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
