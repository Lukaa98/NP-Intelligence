import assert from "node:assert/strict";
import { analyseActivity, guessTimezone } from "../web/src/activityHistory.js";

// A player in US East (UTC-5) who plays 6pm-10pm local = 23:00-03:00 UTC,
// active for 4 days, then AFK for 3 days, then back today.
const now = Date.parse("2026-11-11T15:00:00Z");
const events = [];
let tick = 1000;
const at = (iso) => new Date(Date.parse(iso)).toISOString();
for (const day of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]) {
  for (const hour of [23, 0, 1, 2]) {
    const base = Date.parse(`${day}T00:00:00Z`) + (hour < 12 ? 24 + hour : hour) * 3600000;
    events.push({ tick: tick += 1, at: new Date(base + 1800000).toISOString(), kind: "activity", detail: "infra", weight: 2 });
  }
}
events.push({ tick: tick += 1, at: at("2026-11-11T01:30:00Z"), kind: "activity", detail: "carriers", weight: 1 });

const result = analyseActivity(
  { events, firstTick: 990, lastTick: tick, firstAt: "2026-10-31T00:00:00Z", anchor: { tick, at: "2026-11-11T14:30:00Z" } },
  { now, localHour: (ms) => (new Date(ms).getUTCHours() + 24 - 5) % 24 }
);
assert.equal(result.moments, 17);
assert.equal(result.timezone.offset <= -3 && result.timezone.offset >= -7, true, `timezone ${JSON.stringify(result.timezone)}`);
const longSpell = result.spells.find((spell) => spell.hours >= 72 && !spell.ongoing);
assert(longSpell, "the multi-day gap before today's return is an AFK spell");
assert.equal(result.busiest.start >= 17 && result.busiest.start <= 20, true, `busiest ${JSON.stringify(result.busiest)}`);
assert.equal(guessTimezone(Array(24).fill(0), 2), null, "too few samples: no guess");
console.log("Activity history tests passed.");
