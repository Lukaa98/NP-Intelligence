import assert from "node:assert/strict";
import { detectThreats } from "../backend/src/threats.js";

// Viewer 1 owns stars 10 (40 ships) and 11 (0 ships); 2 is a formal ally.
const base = () => ({
  playerUid: 1,
  tickRate: 60,
  fleetSpeed: 0.5,
  players: {
    1: { uid: 1, alias: "Me", war: { 2: 0, 3: 3, 4: 3 }, tech: { 5: { level: 3 } } },
    2: { uid: 2, alias: "Ally", tech: { 5: { level: 3 } } },
    3: { uid: 3, alias: "Raider", tech: { 5: { level: 3 } } },
    4: { uid: 4, alias: "Sneaky", tech: { 5: { level: 3 } } }
  },
  stars: {
    10: { uid: 10, n: "Home", x: 0, y: 0, puid: 1, st: 40 },
    11: { uid: 11, n: "Edge", x: 10, y: 0, puid: 1, st: 0 },
    20: { uid: 20, n: "Waypoint", x: 0, y: 5, puid: 3, st: 5 }
  },
  fleets: {}
});

// Route via a waypoint to Home: distance 5 + 5 = 10 at speed 0.5 -> 20 ticks.
const routed = base();
routed.fleets[1] = { uid: 1, n: "Hammer", puid: 3, x: 0, y: 10, lx: 0, ly: 10.5, st: 100, speed: 0.5, o: [[0, 20, 0, 0], [0, 10, 0, 0]] };
routed.fleets[2] = { uid: 2, puid: 2, x: 0, y: 1, st: 500, speed: 0.5, o: [[0, 10, 0, 0]] }; // ally: ignored
routed.fleets[3] = { uid: 3, puid: 1, x: 0, y: 0, st: 25, speed: 0, o: [] }; // my fleet at Home
const [hit, ...rest] = detectThreats(routed);
assert.equal(rest.length, 0, "ally fleets are not threats");
assert.equal(hit.kind, "route");
assert.equal(hit.targetName, "Home");
assert.equal(hit.etaTicks, 20);
assert.equal(hit.etaMinutes, 1200);
assert.equal(hit.defenders, 65, "garrison plus my fleet at the star");
assert.equal(hit.verdict, "likely_falls");

// No visible route, but flying straight at Edge (undefended).
const sneaky = base();
sneaky.fleets[4] = { uid: 4, puid: 4, x: 14, y: 0, lx: 14.5, ly: 0, st: 30, speed: 0.5, o: [] };
const [guess] = detectThreats(sneaky);
assert.equal(guess.kind, "heading");
assert.equal(guess.targetName, "Edge");
assert.equal(guess.verdict, "undefended");

// Moving away, or off by a wide angle: nothing.
const away = base();
away.fleets[5] = { uid: 5, puid: 4, x: 14, y: 0, lx: 13.5, ly: 0, st: 30, speed: 0.5, o: [] };
away.fleets[6] = { uid: 6, puid: 4, x: 14, y: 0, lx: 14.5, ly: 2, st: 30, speed: 0.5, o: [] };
assert.equal(detectThreats(away).length, 0);
console.log("Threat detection tests passed.");

// A 1-ship scout at a heavily defended star is not an alert.
const scout = base();
scout.fleets[7] = { uid: 7, puid: 3, x: 0, y: 3, st: 1, speed: 0.5, o: [[0, 10, 0, 0]] };
assert.equal(detectThreats(scout).length, 0, "tiny fleets are ignored");
console.log("Negligible-fleet filter test passed.");
