// Standalone Neptune's Pride galaxy viewer.
//
// This file must stay dependency-free (no imports): the dashboard imports it as
// a module, and the "Download HTML" export inlines its raw source into a
// self-contained page. Everything it needs, styles included, lives here.

const NP_COLORS = ["#0000ff", "#009fdf", "#40c000", "#ffc000", "#df5f00", "#c00000", "#c000c0", "#6000c0"];
const NP_SHAPES = ["circle", "square", "hexagon", "triangle", "cross", "diamond", "star", "pill"];
const TECH_LABELS = {
  0: "Banking", 1: "Experimentation", 2: "Manufacturing", 3: "Range", 4: "Scanning", 5: "Weapons", 6: "Terraforming",
  banking: "Banking", research: "Experimentation", manufacturing: "Manufacturing", propulsion: "Range",
  scanning: "Scanning", weapons: "Weapons", terraforming: "Terraforming"
};

const STYLE_ID = "npmap-styles";
const STYLES = `
.npmap { position: relative; width: 100%; height: 100%; min-height: 420px; background: #14123a; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; color: #e8ecff; display: flex; }
.npmap * { box-sizing: border-box; }
.npmap-side { width: 340px; max-width: 46%; flex: none; background: #1f1d4f; border-right: 1px solid #2f2c70; display: flex; flex-direction: column; overflow: hidden; z-index: 2; }
.npmap-side.collapsed { display: none; }
.npmap-head { padding: 12px 14px; background: #29266a; }
.npmap-title { font-size: 20px; color: #ffb45c; margin: 0; }
.npmap-sub { font-size: 12px; color: #a9b0e6; margin-top: 4px; }
.npmap-banner { padding: 10px 14px; background: #34318a; text-align: center; }
.npmap-banner strong { display: block; font-size: 17px; letter-spacing: .02em; }
.npmap-banner span { font-size: 13px; color: #d7dbff; }
.npmap-scroll { overflow-y: auto; flex: 1; }
.npmap-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #0b0a1f; border-bottom: 1px solid #1f1d4f; cursor: pointer; width: 100%; color: inherit; border-left: 0; border-right: 0; border-top: 0; text-align: left; font: inherit; }
.npmap-row:hover, .npmap-row.active { background: #232060; }
.npmap-row .nm { flex: 1; min-width: 0; color: #ffa040; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.npmap-row .vl { font-size: 13px; color: #e8ecff; white-space: nowrap; text-align: right; }
.npmap-row .vl small { display: block; color: #8e95cf; font-size: 11px; }
.npmap-row.out .nm { color: #8e7a66; }
.npmap-note { font-size: 14px; }
.npmap-detail { padding: 12px 14px; border-top: 1px solid #2f2c70; background: #18163f; max-height: 46%; overflow-y: auto; }
.npmap-detail h3 { margin: 0 0 6px; font-size: 17px; color: #ffb45c; display: flex; align-items: center; gap: 8px; }
.npmap-detail .close { margin-left: auto; background: none; border: 0; color: #a9b0e6; font-size: 18px; cursor: pointer; }
.npmap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 13px; }
.npmap-grid span { color: #8e95cf; }
.npmap-notetext { margin-top: 8px; padding: 8px; border-radius: 6px; background: #0b0a1f; font-size: 13px; white-space: pre-wrap; }
.npmap-link { background: none; border: 0; padding: 0; color: #ffa040; cursor: pointer; font: inherit; text-decoration: underline; }
.npmap-stage { position: relative; flex: 1; min-width: 0; }
.npmap-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
.npmap-stage canvas.dragging { cursor: grabbing; }
.npmap-tools { position: absolute; right: 10px; top: 10px; display: flex; flex-direction: column; gap: 6px; z-index: 1; }
.npmap-tools button { width: 36px; height: 36px; border-radius: 6px; border: 0; background: #5a57c9; color: white; font-size: 18px; cursor: pointer; }
.npmap-tools button:hover { background: #6d6ae0; }
.npmap-hint { position: absolute; left: 10px; bottom: 8px; font-size: 11px; color: #8e95cf; pointer-events: none; }
@media (max-width: 720px) {
  .npmap { flex-direction: column; }
  .npmap-side { width: 100%; max-width: none; max-height: 45%; border-right: 0; border-bottom: 1px solid #2f2c70; }
  .npmap-stage { min-height: 320px; }
}
`;

function pick(object, ...keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }
  return undefined;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Accepts a stored snapshot ({ data, gameName, tick, ... }) or raw
// scanning_data and returns one normalized shape. NP payloads have used both
// snake_case and camelCase field names, so every read tolerates either.
export function normalizeSnapshot(input) {
  const data = input?.data || input || {};
  const rawPlayers = data.players || {};
  const rawStars = data.stars || data.galaxy?.stars || {};
  const rawFleets = data.fleets || data.carriers || data.galaxy?.fleets || {};

  const players = Object.entries(rawPlayers).map(([key, raw]) => {
    const uid = num(pick(raw, "uid"), num(key));
    return {
      uid,
      alias: String(pick(raw, "alias", "name") ?? `Player ${uid}`),
      color: playerColor(raw, uid),
      shape: playerShape(raw, uid),
      stars: num(pick(raw, "totalStars", "total_stars")),
      ships: num(pick(raw, "totalStrength", "total_strength")),
      economy: num(pick(raw, "totalEconomy", "total_economy")),
      industry: num(pick(raw, "totalIndustry", "total_industry")),
      science: num(pick(raw, "totalScience", "total_science")),
      fleets: num(pick(raw, "totalFleets", "total_fleets", "totalCarriers")),
      vp: pick(raw, "vp", "vps", "victoryPoints", "victory_points"),
      conceded: num(pick(raw, "conceded")),
      ai: num(pick(raw, "ai")),
      tech: raw.tech || {},
      raw
    };
  });
  const playerByUid = new Map(players.map((player) => [player.uid, player]));

  const stars = Object.entries(rawStars).map(([key, raw]) => {
    const puid = num(pick(raw, "puid", "playerUid", "player_uid", "owner"), -1);
    return {
      uid: num(pick(raw, "uid"), num(key)),
      name: String(pick(raw, "n", "name") ?? `Star ${key}`),
      x: num(raw.x),
      y: num(raw.y),
      puid,
      owner: playerByUid.get(puid) || null,
      ships: pick(raw, "st", "ships", "strength"),
      economy: pick(raw, "e", "economy"),
      industry: pick(raw, "i", "industry"),
      science: pick(raw, "s", "science"),
      resources: pick(raw, "nr", "r", "resources"),
      gate: num(pick(raw, "ga", "gate")),
      visible: String(pick(raw, "v", "visible") ?? "1") !== "0",
      raw
    };
  });
  const starByUid = new Map(stars.map((star) => [star.uid, star]));

  const fleets = Object.entries(rawFleets).map(([key, raw]) => {
    const puid = num(pick(raw, "puid", "playerUid", "player_uid", "owner"), -1);
    const orders = Array.isArray(raw.o) ? raw.o : Array.isArray(raw.orders) ? raw.orders : [];
    const route = orders
      .map((order) => starByUid.get(num(Array.isArray(order) ? order[1] : order?.starId ?? order?.planetId, -9)))
      .filter(Boolean);
    return {
      uid: num(pick(raw, "uid"), num(key)),
      name: String(pick(raw, "n", "name") ?? `Fleet ${key}`),
      x: num(raw.x),
      y: num(raw.y),
      puid,
      owner: playerByUid.get(puid) || null,
      ships: pick(raw, "st", "ships", "strength"),
      orbiting: starByUid.get(num(pick(raw, "ouid", "orbiting"), -9)) || null,
      route,
      raw
    };
  });

  for (const player of players) {
    if (!player.stars) {
      player.stars = stars.filter((star) => star.puid === player.uid).length;
    }
  }

  const gameOver = pick(data, "gameOver", "game_over");
  return {
    gameName: input?.gameName || data.name || data.config?.name || "Neptune's Pride",
    gameNumber: input?.gameNumber || "",
    capturedAt: input?.capturedAt || "",
    label: input?.label || "",
    tick: num(pick(data, "tick"), num(input?.tick)),
    productionCounter: pick(data, "productionCounter", "production_counter"),
    productionRate: pick(data, "productionRate", "production_rate"),
    tickRate: pick(data, "tickRate", "tick_rate"),
    viewerUid: num(pick(data, "playerUid", "player_uid"), -1),
    gameOver: Boolean(gameOver) && gameOver !== "0",
    players,
    stars,
    fleets
  };
}

function playerColor(raw, uid) {
  const value = pick(raw, "color", "colour", "colorIndex", "color_index");
  if (typeof value === "string" && value.startsWith("#")) {
    return value;
  }
  if (value !== undefined && Number.isFinite(Number(value))) {
    return NP_COLORS[num(value) % NP_COLORS.length];
  }
  return NP_COLORS[uid % NP_COLORS.length];
}

function playerShape(raw, uid) {
  const value = pick(raw, "shape", "shapeIndex", "shape_index");
  if (typeof value === "string" && NP_SHAPES.includes(value)) {
    return value;
  }
  if (value !== undefined && Number.isFinite(Number(value))) {
    return NP_SHAPES[num(value) % NP_SHAPES.length];
  }
  return NP_SHAPES[Math.floor(uid / NP_COLORS.length) % NP_SHAPES.length];
}

// Ranks the leaderboard the way NP does: VPs when the game reports them, then
// stars, then ships.
export function rankPlayers(players) {
  return [...players].sort((left, right) =>
    num(right.vp, -1) - num(left.vp, -1) || right.stars - left.stars || right.ships - left.ships);
}

function shapePath(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  } else if (shape === "hexagon") {
    polygon(ctx, x, y, r, 6, 0);
  } else if (shape === "triangle") {
    polygon(ctx, x, y + r * 0.2, r * 1.15, 3, -Math.PI / 2);
  } else if (shape === "diamond") {
    polygon(ctx, x, y, r * 1.1, 4, -Math.PI / 2);
  } else if (shape === "star") {
    for (let index = 0; index < 10; index += 1) {
      const radius = index % 2 === 0 ? r * 1.15 : r * 0.5;
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      ctx[index ? "lineTo" : "moveTo"](x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    ctx.closePath();
  } else if (shape === "cross") {
    const a = r * 0.38;
    const b = r;
    ctx.moveTo(x - a, y - b);
    ctx.lineTo(x + a, y - b);
    ctx.lineTo(x + a, y - a);
    ctx.lineTo(x + b, y - a);
    ctx.lineTo(x + b, y + a);
    ctx.lineTo(x + a, y + a);
    ctx.lineTo(x + a, y + b);
    ctx.lineTo(x - a, y + b);
    ctx.lineTo(x - a, y + a);
    ctx.lineTo(x - b, y + a);
    ctx.lineTo(x - b, y - a);
    ctx.lineTo(x - a, y - a);
    ctx.closePath();
  } else if (shape === "pill") {
    const w = r * 0.6;
    const h = r * 1.05;
    ctx.moveTo(x - w, y - h + w);
    ctx.arc(x, y - h + w, w, Math.PI, 0);
    ctx.lineTo(x + w, y + h - w);
    ctx.arc(x, y + h - w, w, 0, Math.PI);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

function polygon(ctx, x, y, r, sides, rotation) {
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (index * Math.PI * 2) / sides;
    ctx[index ? "lineTo" : "moveTo"](x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.closePath();
}

export function shapeSvg(shape, color, size = 22) {
  const canvasSize = size;
  const ctxPath = [];
  // Reuse the canvas path builder by recording into a fake context.
  const recorder = {
    beginPath() {},
    closePath() { ctxPath.push("Z"); },
    moveTo(x, y) { ctxPath.push(`M${x.toFixed(2)} ${y.toFixed(2)}`); },
    lineTo(x, y) { ctxPath.push(`L${x.toFixed(2)} ${y.toFixed(2)}`); },
    rect(x, y, w, h) { ctxPath.push(`M${x} ${y}h${w}v${h}h${-w}Z`); },
    arc(cx, cy, r, start, end) {
      const steps = 16;
      const sweep = end > start ? end - start : end - start + Math.PI * 2;
      for (let index = 0; index <= steps; index += 1) {
        const angle = start + (sweep * index) / steps;
        ctxPath.push(`${ctxPath.length ? "L" : "M"}${(cx + Math.cos(angle) * r).toFixed(2)} ${(cy + Math.sin(angle) * r).toFixed(2)}`);
      }
    }
  };
  const half = canvasSize / 2;
  shapePath(recorder, shape, half, half, half * 0.72);
  return `<svg width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}" aria-hidden="true"><path d="${ctxPath.join(" ")}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
}

function noteIcon(note) {
  if (!note) return "";
  if (note.rating > 0) return "👍";
  if (note.rating < 0) return "👎";
  return note.note ? "📝" : "";
}

/**
 * Mounts the viewer into `container`.
 * options:
 *   notes: { [lowercased alias]: { rating, note } } shown next to players
 *   onPlayerSelect(player | null): called when a player is opened
 *   showSidebar: default true
 *   relations: [{ a, b, status, allyScore, warScore }] diplomacy pairs to draw
 *              as lines between empires (toggle with the ⚭ button)
 */
export function mountMap(container, snapshot, options = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  let model = normalizeSnapshot(snapshot);
  let ranked = rankPlayers(model.players);
  // Stars whose owner changed since the previous frame (timeline playback).
  let changedStars = new Set();
  let notes = options.notes || {};
  let relations = options.relations || [];
  let showRelations = Boolean(options.showRelations ?? relations.length);

  container.innerHTML = `
    <div class="npmap">
      <aside class="npmap-side${options.showSidebar === false ? " collapsed" : ""}">
        <div class="npmap-head">
          <p class="npmap-title"></p>
          <div class="npmap-sub"></div>
        </div>
        <div class="npmap-banner" hidden></div>
        <div class="npmap-scroll"></div>
        <div class="npmap-detail" hidden></div>
      </aside>
      <div class="npmap-stage">
        <canvas></canvas>
        <div class="npmap-tools">
          <button type="button" data-act="side" title="Toggle leaderboard">☰</button>
          <button type="button" data-act="relations" title="Show alliances and wars">⚭</button>
          <button type="button" data-act="in" title="Zoom in">+</button>
          <button type="button" data-act="out" title="Zoom out">−</button>
          <button type="button" data-act="fit" title="Fit galaxy">⤢</button>
        </div>
        <div class="npmap-hint">Drag to pan · scroll or pinch to zoom · click stars, fleets and players</div>
      </div>
    </div>`;

  const root = container.querySelector(".npmap");
  const side = root.querySelector(".npmap-side");
  const list = root.querySelector(".npmap-scroll");
  const detail = root.querySelector(".npmap-detail");
  const banner = root.querySelector(".npmap-banner");
  const stage = root.querySelector(".npmap-stage");
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");

  function renderHeader() {
    root.querySelector(".npmap-title").textContent = model.gameName;
    const subParts = [`Tick ${model.tick}`];
    if (model.productionCounter !== undefined) subParts.push(`production counter ${model.productionCounter}`);
    if (model.capturedAt) subParts.push(`captured ${new Date(model.capturedAt).toLocaleString()}`);
    if (model.label) subParts.push(model.label);
    if (changedStars.size) subParts.push(`${changedStars.size} star${changedStars.size === 1 ? "" : "s"} changed hands`);
    root.querySelector(".npmap-sub").textContent = subParts.join(" · ");

    banner.hidden = !model.gameOver;
    if (model.gameOver) {
      const winner = ranked.find((player) => !player.conceded) || ranked[0];
      banner.innerHTML = `<strong>GAME OVER!</strong><span>${winner ? `Winner: ${escapeHtml(winner.alias)}` : "Final state"}</span>`;
    }
  }
  renderHeader();

  const view = { scale: 1, x: 0, y: 0 };
  const selection = { star: null, fleet: null, player: null };
  let width = 0;
  let height = 0;

  function renderList() {
    list.innerHTML = ranked.map((player) => {
      const note = notes[player.alias.toLowerCase()];
      const value = player.vp !== undefined ? `${escapeHtml(player.vp)} VPs` : `${player.stars} stars`;
      const out = player.conceded || player.ai ? " out" : "";
      return `
        <button type="button" class="npmap-row${selection.player === player ? " active" : ""}${out}" data-uid="${player.uid}">
          ${shapeSvg(player.shape, player.color, 26)}
          <span class="nm">${escapeHtml(player.alias)} <span class="npmap-note">${noteIcon(note)}</span></span>
          <span class="vl">${value}<small>${player.ships} ships</small></span>
        </button>`;
    }).join("") || `<div class="npmap-sub" style="padding:12px">No player data in this snapshot.</div>`;
    for (const button of list.querySelectorAll(".npmap-row")) {
      button.addEventListener("click", () => {
        const player = model.players.find((candidate) => String(candidate.uid) === button.dataset.uid);
        selectPlayer(selection.player === player ? null : player, true);
      });
    }
  }

  function renderDetail() {
    const { star, fleet, player } = selection;
    if (!star && !fleet && !player) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    let html = "";
    if (star) {
      const owner = star.owner;
      html = `
        <h3>${owner ? shapeSvg(owner.shape, owner.color, 20) : ""}${escapeHtml(star.name)}<button class="close" type="button">×</button></h3>
        <div class="npmap-grid">
          <span>Owner</span><div>${owner ? `<button class="npmap-link" data-player="${owner.uid}" type="button">${escapeHtml(owner.alias)}</button>` : "Unowned"}</div>
          <span>Ships</span><div>${star.ships ?? "?"}</div>
          <span>Economy</span><div>${star.economy ?? "?"}</div>
          <span>Industry</span><div>${star.industry ?? "?"}</div>
          <span>Science</span><div>${star.science ?? "?"}</div>
          <span>Resources</span><div>${star.resources ?? "?"}</div>
          ${star.gate ? "<span>Warp gate</span><div>Yes</div>" : ""}
          <span>Position</span><div>${star.x.toFixed(2)}, ${star.y.toFixed(2)}</div>
        </div>`;
    } else if (fleet) {
      const owner = fleet.owner;
      html = `
        <h3>${owner ? shapeSvg(owner.shape, owner.color, 20) : ""}${escapeHtml(fleet.name)}<button class="close" type="button">×</button></h3>
        <div class="npmap-grid">
          <span>Owner</span><div>${owner ? `<button class="npmap-link" data-player="${owner.uid}" type="button">${escapeHtml(owner.alias)}</button>` : "Unknown"}</div>
          <span>Ships</span><div>${fleet.ships ?? "?"}</div>
          <span>Orbiting</span><div>${fleet.orbiting ? escapeHtml(fleet.orbiting.name) : "In flight"}</div>
          <span>Route</span><div>${fleet.route.length ? fleet.route.map((item) => escapeHtml(item.name)).join(" → ") : "None"}</div>
        </div>`;
    } else if (player) {
      const note = notes[player.alias.toLowerCase()];
      const techRows = Object.entries(player.tech || {})
        .map(([key, value]) => `<span>${escapeHtml(TECH_LABELS[key] || key)}</span><div>${escapeHtml(typeof value === "object" ? value.level ?? "?" : value)}</div>`)
        .join("");
      html = `
        <h3>${shapeSvg(player.shape, player.color, 20)}${escapeHtml(player.alias)} ${noteIcon(note)}<button class="close" type="button">×</button></h3>
        <div class="npmap-grid">
          ${player.vp !== undefined ? `<span>Victory points</span><div>${escapeHtml(player.vp)}</div>` : ""}
          <span>Stars</span><div>${player.stars}</div>
          <span>Ships</span><div>${player.ships}</div>
          <span>Fleets</span><div>${player.fleets || model.fleets.filter((item) => item.puid === player.uid).length}</div>
          <span>Economy</span><div>${player.economy}</div>
          <span>Industry</span><div>${player.industry}</div>
          <span>Science</span><div>${player.science}</div>
          ${player.conceded ? "<span>Status</span><div>Conceded</div>" : player.ai ? "<span>Status</span><div>AI / inactive</div>" : ""}
          ${techRows}
        </div>
        ${note?.note ? `<div class="npmap-notetext">${escapeHtml(note.note)}</div>` : ""}`;
    }
    detail.innerHTML = html;
    detail.querySelector(".close")?.addEventListener("click", () => {
      selection.star = null;
      selection.fleet = null;
      selectPlayer(null, false);
    });
    for (const link of detail.querySelectorAll("[data-player]")) {
      link.addEventListener("click", () => {
        selectPlayer(model.players.find((candidate) => String(candidate.uid) === link.dataset.player) || null, true);
      });
    }
  }

  function selectPlayer(player, focus) {
    selection.player = player;
    if (player) {
      selection.star = null;
      selection.fleet = null;
    }
    renderList();
    renderDetail();
    if (player && focus) {
      fitTo(model.stars.filter((star) => star.puid === player.uid));
    }
    draw();
    options.onPlayerSelect?.(player);
  }

  function bounds(stars) {
    if (!stars.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const star of stars) {
      minX = Math.min(minX, star.x);
      minY = Math.min(minY, star.y);
      maxX = Math.max(maxX, star.x);
      maxY = Math.max(maxY, star.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function fitTo(stars) {
    const box = bounds(stars.length ? stars : model.stars);
    const spanX = Math.max(box.maxX - box.minX, 0.5);
    const spanY = Math.max(box.maxY - box.minY, 0.5);
    view.scale = Math.min((width - 60) / spanX, (height - 60) / spanY);
    view.scale = Math.max(4, Math.min(view.scale, 400));
    view.x = width / 2 - ((box.minX + box.maxX) / 2) * view.scale;
    view.y = height / 2 - ((box.minY + box.maxY) / 2) * view.scale;
    draw();
  }

  const toScreen = (x, y) => [x * view.scale + view.x, y * view.scale + view.y];

  function zoomAt(factor, sx, sy) {
    const next = Math.max(2, Math.min(view.scale * factor, 2000));
    const k = next / view.scale;
    view.x = sx - (sx - view.x) * k;
    view.y = sy - (sy - view.y) * k;
    view.scale = next;
    draw();
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#14123a";
    ctx.fillRect(0, 0, width, height);

    const focus = selection.player;
    const dim = (puid) => focus && puid !== focus.uid;
    const r = Math.max(3, Math.min(view.scale * 0.09, 14));

    if (showRelations && relations.length) drawRelations(focus);

    // Fleet routes first so stars draw on top.
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const fleet of model.fleets) {
      if (!fleet.route.length) continue;
      ctx.globalAlpha = dim(fleet.puid) ? 0.12 : 0.55;
      ctx.strokeStyle = fleet.owner?.color || "#888";
      ctx.beginPath();
      ctx.moveTo(...toScreen(fleet.x, fleet.y));
      for (const stop of fleet.route) ctx.lineTo(...toScreen(stop.x, stop.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const star of model.stars) {
      const [sx, sy] = toScreen(star.x, star.y);
      if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) continue;
      ctx.globalAlpha = dim(star.puid) ? 0.18 : 1;
      if (star.owner) {
        ctx.lineWidth = Math.max(1.5, r * 0.22);
        ctx.strokeStyle = star.owner.color;
        shapePath(ctx, star.owner.shape, sx, sy, r);
        if (star.gate) {
          ctx.fillStyle = `${star.owner.color}55`;
          ctx.fill();
        }
        ctx.stroke();
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(sx, sy, star.owner ? Math.max(1.4, r * 0.28) : Math.max(1.2, r * 0.22), 0, Math.PI * 2);
      ctx.fill();

      if (changedStars.has(star.uid)) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffe14d";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (star === selection.star) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(sx, sy, r * 1.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (view.scale > 55) {
        ctx.font = `${Math.min(13, 9 + view.scale / 60)}px Segoe UI, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#c9cdf5";
        ctx.fillText(star.name, sx, sy + r * 1.6 + 10);
        if (star.ships !== undefined && star.ships !== null) {
          ctx.fillStyle = "#ffffff";
          ctx.fillText(String(star.ships), sx, sy - r * 1.5 - 3);
        }
      }
    }

    for (const fleet of model.fleets) {
      const [sx, sy] = toScreen(fleet.x, fleet.y);
      if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) continue;
      ctx.globalAlpha = dim(fleet.puid) ? 0.18 : 1;
      const offset = fleet.orbiting ? r * 1.35 : 0;
      ctx.fillStyle = fleet.owner?.color || "#aaa";
      shapePath(ctx, fleet.owner?.shape || "circle", sx + offset, sy - offset, Math.max(2.2, r * 0.42));
      ctx.fill();
      if (fleet === selection.fleet) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (view.scale > 90 && fleet.ships !== undefined && !fleet.orbiting) {
        ctx.fillStyle = "#ffe2b8";
        ctx.font = "11px Segoe UI, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(fleet.ships), sx + r * 0.6, sy - r * 0.6);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Alliance (green) and war (red) lines between each empire's centre of mass.
  let centres = new Map();
  function computeCentres() {
    centres = new Map();
    for (const player of model.players) {
      const owned = model.stars.filter((star) => star.puid === player.uid);
      if (!owned.length) continue;
      centres.set(player.uid, {
        x: owned.reduce((sum, star) => sum + star.x, 0) / owned.length,
        y: owned.reduce((sum, star) => sum + star.y, 0) / owned.length
      });
    }
  }
  computeCentres();

  function drawRelations(focus) {
    for (const pair of relations) {
      const from = centres.get(pair.a);
      const to = centres.get(pair.b);
      if (!from || !to) continue;
      if (focus && pair.a !== focus.uid && pair.b !== focus.uid) continue;
      const allied = pair.status === "allied" || pair.status === "possible_allies";
      const hostile = pair.status === "war" || pair.status === "former_allies" || pair.status === "tension";
      if (!allied && !hostile) continue;
      const strength = allied ? pair.allyScore : pair.warScore;
      ctx.globalAlpha = 0.25 + strength * 0.6;
      ctx.strokeStyle = allied ? "#69d39f" : pair.status === "tension" ? "#ffc000" : "#ff6b5e";
      ctx.lineWidth = 1 + strength * 4;
      ctx.setLineDash(pair.status === "possible_allies" || pair.status === "tension" ? [6, 5] : []);
      ctx.beginPath();
      ctx.moveTo(...toScreen(from.x, from.y));
      ctx.lineTo(...toScreen(to.x, to.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const firstLayout = width === 0;
    width = Math.max(rect.width, 1);
    height = Math.max(rect.height, 1);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (firstLayout) {
      fitTo(model.stars);
    } else {
      draw();
    }
  }

  function hitTest(sx, sy) {
    const radius = Math.max(10, view.scale * 0.12);
    let best = null;
    let bestDistance = radius;
    for (const fleet of model.fleets) {
      if (fleet.orbiting) continue;
      const [fx, fy] = toScreen(fleet.x, fleet.y);
      const distance = Math.hypot(fx - sx, fy - sy);
      if (distance < bestDistance * 0.7) {
        best = { fleet };
        bestDistance = distance;
      }
    }
    for (const star of model.stars) {
      const [x, y] = toScreen(star.x, star.y);
      const distance = Math.hypot(x - sx, y - sy);
      if (distance < bestDistance) {
        best = { star };
        bestDistance = distance;
      }
    }
    return best;
  }

  // Pointer handling: one pointer pans, two pinch-zoom, a short tap selects.
  const pointers = new Map();
  let dragStart = null;
  let pinchStart = null;

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (pointers.size === 1) {
      dragStart = { x: event.offsetX, y: event.offsetY, vx: view.x, vy: view.y, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
      dragStart = null;
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const target = pinchStart.scale * (distance / pinchStart.distance);
      zoomAt(target / view.scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (dragStart) {
      const dx = event.offsetX - dragStart.x;
      const dy = event.offsetY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        dragStart.moved = true;
        canvas.classList.add("dragging");
      }
      view.x = dragStart.vx + dx;
      view.y = dragStart.vy + dy;
      draw();
    }
  });

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    canvas.classList.remove("dragging");
    if (dragStart && !dragStart.moved && event.type === "pointerup") {
      const hit = hitTest(event.offsetX, event.offsetY);
      selection.star = hit?.star || null;
      selection.fleet = hit?.fleet || null;
      if (hit) {
        selection.player = null;
        renderList();
      }
      renderDetail();
      draw();
    }
    if (pointers.size < 2) pinchStart = null;
    dragStart = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.offsetX, event.offsetY);
  }, { passive: false });

  root.querySelector(".npmap-tools").addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.act;
    if (action === "in") zoomAt(1.4, width / 2, height / 2);
    if (action === "out") zoomAt(1 / 1.4, width / 2, height / 2);
    if (action === "fit") fitTo(model.stars);
    if (action === "relations") {
      showRelations = !showRelations;
      draw();
    }
    if (action === "side") {
      side.classList.toggle("collapsed");
      requestAnimationFrame(resize);
    }
  });

  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  renderList();
  resize();

  return {
    get model() {
      return model;
    },
    // Swaps in another snapshot of the same game (timeline), keeping pan/zoom
    // and the selected player, and highlighting stars that changed owner.
    setSnapshot(nextSnapshot) {
      const previousOwners = new Map(model.stars.map((star) => [star.uid, star.puid]));
      model = normalizeSnapshot(nextSnapshot);
      ranked = rankPlayers(model.players);
      changedStars = new Set(model.stars
        .filter((star) => previousOwners.has(star.uid) && previousOwners.get(star.uid) !== star.puid)
        .map((star) => star.uid));
      const selectedUid = selection.player?.uid;
      selection.player = model.players.find((player) => player.uid === selectedUid) || null;
      selection.star = selection.star ? model.stars.find((star) => star.uid === selection.star.uid) || null : null;
      selection.fleet = selection.fleet ? model.fleets.find((fleet) => fleet.uid === selection.fleet.uid) || null : null;
      computeCentres();
      renderHeader();
      renderList();
      renderDetail();
      draw();
    },
    setRelations(nextRelations) {
      relations = nextRelations || [];
      if (options.showRelations === undefined) showRelations = relations.length > 0;
      draw();
    },
    setNotes(nextNotes) {
      notes = nextNotes || {};
      renderList();
      renderDetail();
    },
    selectPlayerByAlias(alias) {
      selectPlayer(model.players.find((player) => player.alias === alias) || null, true);
    },
    destroy() {
      observer.disconnect();
      container.innerHTML = "";
    }
  };
}
