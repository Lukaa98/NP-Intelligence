// Turns a player's recorded human actions (from
// GET /api/games/:n/players/:uid/activity) into a day-by-day strip, AFK
// spells and a time-of-day profile with a timezone guess. Pure and
// dependency-free so it can be unit tested in Node.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const REGIONS = {
  "-10": "Hawaii", "-9": "Alaska", "-8": "US Pacific", "-7": "US Mountain", "-6": "US Central",
  "-5": "US East", "-4": "Atlantic, or US East in summer", "-3": "Brazil / Argentina", "0": "UK / Portugal",
  "1": "Western / Central Europe", "2": "Eastern Europe", "3": "Turkey / Moscow", "4": "Gulf",
  "5": "Pakistan", "6": "Bangladesh", "7": "SE Asia", "8": "China / Singapore / Perth", "9": "Japan / Korea",
  "10": "Eastern Australia", "11": "Sydney in summer", "12": "New Zealand"
};

export function analyseActivity(history, { now = Date.now(), days: dayCount = 21, localHour = (ms) => new Date(ms).getHours() } = {}) {
  const anchor = history.anchor;
  // An action is detected at the first scan after the tick it happened in,
  // so place it half an hour earlier.
  const timeOf = (event) => {
    const seen = event.at ? Date.parse(event.at) : anchor ? Date.parse(anchor.at) - (anchor.tick - event.tick) * HOUR : null;
    return seen === null ? null : seen - HOUR / 2;
  };
  const start = history.firstAt
    ? Date.parse(history.firstAt)
    : anchor && history.firstTick !== null ? Date.parse(anchor.at) - (anchor.tick - history.firstTick) * HOUR : null;

  // One "action moment" per tick, with what happened in it.
  const byTick = new Map();
  for (const event of history.events || []) {
    const time = timeOf(event);
    if (time === null) continue;
    const moment = byTick.get(event.tick) || { tick: event.tick, time, infra: 0, carriers: 0, orders: 0, captures: 0 };
    if (event.kind === "capture") moment.captures += 1;
    else moment[event.detail] = (moment[event.detail] || 0) + Number(event.weight || 0);
    byTick.set(event.tick, moment);
  }
  const moments = [...byTick.values()].sort((x, y) => x.time - y.time);

  // Day strip, most recent last.
  const today = startOfLocalDay(now);
  const days = [];
  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const from = today - index * DAY;
    const to = from + DAY;
    const inDay = moments.filter((moment) => moment.time >= from && moment.time < to);
    const tracked = start !== null && to > start;
    days.push({
      from,
      tracked,
      active: inDay.length > 0,
      infra: sum(inDay, "infra"),
      carriers: sum(inDay, "carriers"),
      orders: sum(inDay, "orders"),
      captures: sum(inDay, "captures"),
      hours: inDay.length
    });
  }

  // AFK spells: gaps of a day or more between actions (and before the first
  // or after the latest one), within the tracked period.
  const spells = [];
  const points = [start, ...moments.map((moment) => moment.time), now].filter((value) => value !== null);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (to - from >= DAY) {
      spells.push({ from, to, hours: Math.round((to - from) / HOUR), ongoing: index === points.length - 1, beforeFirst: index === 1 && start !== null });
    }
  }

  // Time of day: action moments per hour, in the viewer's local time and UTC.
  const local = Array(24).fill(0);
  const utc = Array(24).fill(0);
  for (const moment of moments) {
    local[localHour(moment.time)] += 1;
    utc[new Date(moment.time).getUTCHours()] += 1;
  }
  const busiest = busiestWindow(local, 6);

  return {
    moments: moments.length,
    // Newest first, for the "recent actions" list.
    recent: moments.slice(-12).reverse(),
    lastAction: moments.at(-1)?.time ?? null,
    trackedSince: start,
    days,
    spells: spells.reverse(),
    hours: local,
    busiest,
    timezone: guessTimezone(utc, moments.length)
  };
}

// Typical share of a day's play by local hour: little at night, some during
// the day, most in the evening. Each UTC offset is scored by how well the
// player's actions line up with it; neighbouring offsets that score nearly
// as well form the reported range.
// Evenings often run past midnight for gamers, so the plateau is 7pm-1am.
// A night owl still reads a little further west than they are; the range
// reported alongside the guess covers that.
const TYPICAL_DAY = [
  0.6, 0.35, 0.15, 0.06, 0.04, 0.04, 0.1, 0.3, 0.45, 0.5, 0.55, 0.55,
  0.6, 0.6, 0.55, 0.55, 0.65, 0.8, 0.9, 1, 1, 1, 1, 0.85
];

// When someone plays fits a day pattern in several neighbouring timezones
// (an evening player in Denver and a night owl in New York look the same),
// so the guess is reported as the best fit plus or minus two hours.
export const TIMEZONE_UNCERTAINTY = 2;

export function guessTimezone(utc, samples) {
  if (samples < 5) return null;
  const total = utc.reduce((a, b) => a + b, 0) || 1;
  const scoreFor = (offset) => utc.reduce((score, count, hour) => score + count * TYPICAL_DAY[(hour + offset + 48) % 24], 0) / total;
  let best = -10;
  for (let offset = -10; offset <= 12; offset += 1) {
    if (scoreFor(offset) > scoreFor(best)) best = offset;
  }
  const range = [Math.max(-12, best - TIMEZONE_UNCERTAINTY), Math.min(14, best + TIMEZONE_UNCERTAINTY)];
  return {
    offset: best,
    range,
    region: REGIONS[String(best)] || "",
    confidence: samples >= 12 ? "estimate" : "rough guess"
  };
}

function busiestWindow(hours, width) {
  if (!hours.some(Boolean)) return null;
  const counts = [];
  for (let start = 0; start < 24; start += 1) {
    let count = 0;
    for (let step = 0; step < width; step += 1) count += hours[(start + step) % 24];
    counts.push(count);
  }
  // Several windows can hold the same actions; take the middle one.
  const max = Math.max(...counts);
  const tied = counts.map((count, start) => (count === max ? start : null)).filter((start) => start !== null);
  const start = tied[Math.floor(tied.length / 2)];
  return { start, end: (start + width) % 24, share: max / hours.reduce((a, b) => a + b, 0) };
}

function startOfLocalDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function sum(list, key) {
  return list.reduce((total, item) => total + (item[key] || 0), 0);
}

export function formatOffset(offset) {
  if (offset === 0) return "UTC";
  return `UTC${offset > 0 ? "+" : "−"}${Math.abs(offset)}`;
}

export function formatHour(hour) {
  const suffix = hour < 12 ? "am" : "pm";
  const value = hour % 12 === 0 ? 12 : hour % 12;
  return `${value}${suffix}`;
}
