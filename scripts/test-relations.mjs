import assert from "node:assert/strict";
import { extractRelations } from "../backend/src/relations.js";
import { buildDiplomacy } from "../backend/src/diplomacy.js";

const tech = (weapons) => ({ 5: { kind: 5, level: weapons } });
const player = (uid, alias, weapons, extra = {}) => ({ uid, alias, totalStars: 10, totalStrength: 100, conceded: 0, tech: tech(weapons), ...extra });

// 1 = viewer, allied with 2. 3 and 4 park fleets at each other's stars.
// 5 attacks 6.
function snapshot(tick, { owners, weapons }) {
  const stars = {};
  const coords = [[0, 0], [5, 0], [10, 0], [10.4, 0], [20, 0], [20.5, 0], [30, 0]];
  coords.forEach(([x, y], index) => {
    const uid = index + 1;
    stars[uid] = { uid, n: `S${uid}`, x, y, puid: owners[uid] ?? uid };
  });
  return {
    tick,
    playerUid: 1,
    players: {
      1: player(1, "Me", weapons[1], { war: { 2: 0, 3: 3, 4: 3, 5: 3, 6: 3 } }),
      2: player(2, "Friend", weapons[2]),
      3: player(3, "Alpha", weapons[3]),
      4: player(4, "Beta", weapons[4]),
      5: player(5, "Raider", weapons[5]),
      6: player(6, "Victim", weapons[6])
    },
    stars,
    fleets: {
      1: { uid: 1, puid: 3, x: 10.4, y: 0, st: 50, o: [] }, // Alpha at Beta's star
      2: { uid: 2, puid: 4, x: 10, y: 0, st: 70, o: [] }, // Beta at Alpha's star
      3: { uid: 3, puid: 5, x: 25, y: 0, st: 300, o: [[0, 6, 0, 0]] } // Raider flying at Victim
    }
  };
}

const first = extractRelations(snapshot(100, { owners: {}, weapons: { 1: 3, 2: 3, 3: 2, 4: 5, 5: 4, 6: 4 } }), null);
const kinds = (result, kind) => result.observations.filter((item) => item.kind === kind);
assert.deepEqual(kinds(first, "ally_confirmed").map(({ a, b }) => [a, b]), [[1, 2]]);
assert.deepEqual(kinds(first, "guest").map(({ a, b }) => [a, b]).sort(), [[3, 4], [4, 3]]);
assert.deepEqual(kinds(first, "en_route").map(({ a, b }) => [a, b]), [[5, 6]]);
assert.equal(first.events.length, 0, "no events without a previous state");

// Next hour: Raider takes star 6; Alpha jumps Weapons 2 -> 5, a level only Beta had.
const second = extractRelations(snapshot(101, { owners: { 6: 5 }, weapons: { 1: 3, 2: 3, 3: 5, 4: 5, 5: 4, 6: 4 } }), first.state);
const capture = second.events.find((event) => event.kind === "capture");
assert.deepEqual([capture.a, capture.b, capture.detail], [5, 6, "S6"]);
const trade = second.events.find((event) => event.kind === "tech_trade");
assert.deepEqual([trade.a, trade.b], [3, 4], "Alpha probably got Weapons from Beta");

// Fold both scans into relation rows the way the store does, then score.
const rows = new Map();
for (const result of [first, second]) {
  for (const item of [...result.observations, ...result.events]) {
    const key = `${item.kind}:${item.a}:${item.b}`;
    const row = rows.get(key) || { kind: item.kind, a: item.a, b: item.b, count: 0, weight: 0, ships: 0, firstTick: result.tick, lastTick: result.tick, samples: [] };
    row.count += 1;
    row.weight += item.weight ?? 1;
    row.ships = Math.max(row.ships, item.ships || 0);
    row.lastTick = result.tick;
    rows.set(key, row);
  }
}
const players = Object.values(snapshot(101, { owners: {}, weapons: {} }).players);
const diplomacy = buildDiplomacy({ rows: [...rows.values()], events: [], players, viewerUid: 1, snapshotsProcessed: 2, latestTick: 101 });
const status = (a, b) => diplomacy.pairs.find((pair) => pair.a === Math.min(a, b) && pair.b === Math.max(a, b))?.status;
assert.equal(status(1, 2), "allied");
assert.equal(status(3, 4), "allied");
assert.equal(status(5, 6), "war");
const teams = diplomacy.teams.map((team) => team.members.slice().sort());
assert.deepEqual(teams.sort(), [[1, 2], [3, 4]]);
console.log("Relationship intel tests passed.");

// Team building must not chain rival blocs through a single weak link:
// 1-2 and 3-4 are allied, 2-3 is allied, but 1 is at war with 4.
const pair = (a, b, kind, extra = {}) => ({ kind, a, b, count: 3, weight: 3, ships: 0, firstTick: 1, lastTick: 10, samples: [], ...extra });
const vetoed = buildDiplomacy({
  rows: [
    pair(1, 2, "guest"), pair(2, 1, "guest"),
    pair(3, 4, "guest"), pair(4, 3, "guest"),
    pair(2, 3, "guest", { count: 2 }),
    pair(1, 4, "capture", { count: 4 })
  ],
  events: [],
  players: [1, 2, 3, 4].map((uid) => ({ uid, alias: `P${uid}`, totalStars: 10 })),
  viewerUid: 99,
  snapshotsProcessed: 10,
  latestTick: 10
});
assert.equal(vetoed.teams.length, 2, "war between 1 and 4 keeps the blocs apart");
assert(vetoed.teams.every((team) => team.members.length === 2));

// A formal alliance seen earlier but not in the newest scan is no longer current.
const lapsed = buildDiplomacy({
  rows: [pair(1, 2, "ally_confirmed", { lastTick: 5 })],
  events: [],
  players: [1, 2].map((uid) => ({ uid, alias: `P${uid}`, totalStars: 10 })),
  viewerUid: 1,
  snapshotsProcessed: 10,
  latestTick: 10
});
assert.equal(lapsed.pairs[0].status, "former_allies");
console.log("Team-building tests passed.");

// Game-over scans don't report alliances; they must not mark allies as former.
const afterGameOver = buildDiplomacy({
  rows: [pair(1, 2, "ally_confirmed", { lastTick: 9 }), pair(1, 1, "ally_census", { lastTick: 9 })],
  events: [],
  players: [1, 2].map((uid) => ({ uid, alias: `P${uid}`, totalStars: 10 })),
  viewerUid: 1,
  snapshotsProcessed: 10,
  latestTick: 10
});
assert.equal(afterGameOver.pairs[0].status, "allied");
const overSnapshot = extractRelations({ ...snapshot(102, { owners: {}, weapons: { 1: 3, 2: 3, 3: 5, 4: 5, 5: 4, 6: 4 } }), gameOver: true }, second.state);
assert.equal(overSnapshot.observations.filter((item) => item.kind.startsWith("ally_")).length, 0);
console.log("Game-over alliance tests passed.");

// One player fighting two others becomes one conflict, not two rows; the
// enemies' own war with each other is a separate conflict, used once.
const multiFront = buildDiplomacy({
  rows: [
    pair(1, 2, "capture", { count: 3 }),
    pair(3, 1, "capture", { count: 1 }),
    pair(5, 6, "capture", { count: 2 })
  ],
  events: [],
  players: [1, 2, 3, 5, 6].map((uid) => ({ uid, alias: `P${uid}`, totalStars: 10 })),
  viewerUid: 99,
  snapshotsProcessed: 10,
  latestTick: 10
});
const hub = multiFront.conflicts.find((conflict) => conflict.side.includes(1));
assert.deepEqual(hub.enemies.map((enemy) => enemy.members[0]).sort(), [2, 3]);
assert.equal(hub.took, 3);
assert.equal(hub.lost, 1);
assert.equal(multiFront.conflicts.length, 2, "1 vs (2, 3) and 5 vs 6");
const usedPairs = multiFront.conflicts.reduce((sum, conflict) => sum + conflict.enemies.length, 0);
assert.equal(usedPairs, 3, "every war appears exactly once");
console.log("Conflict grouping tests passed.");
