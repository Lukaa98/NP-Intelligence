import assert from 'node:assert/strict';
import { diffSnapshots, strategicIntel, summarize } from '../backend/src/intel.js';
import { isGameOver } from '../backend/src/npApi.js';

const previous = {
  data: {
    tick: 10,
    players: {
      1: { uid: 1, alias: 'Luka', totalStrength: 100, totalStars: 10, totalEconomy: 20, totalIndustry: 10, totalScience: 5, tech: { 5: { level: 2 } } },
      2: { uid: 2, alias: 'Bob', totalStrength: 90, totalStars: 8, totalEconomy: 12, totalIndustry: 8, totalScience: 4, tech: { 5: { level: 2 } } },
    },
    stars: {
      7: { uid: 7, n: 'Vega', puid: 1, ships: 20 },
    },
  },
};

const current = {
  data: {
    tick: 11,
    players: {
      1: { uid: 1, alias: 'Luka', totalStrength: 146, totalStars: 11, totalEconomy: 22, totalIndustry: 10, totalScience: 6, tech: { 5: { level: 3 } } },
      2: { uid: 2, alias: 'Bob', totalStrength: 82, totalStars: 7, totalEconomy: 12, totalIndustry: 8, totalScience: 4, tech: { 5: { level: 2 } } },
    },
    stars: {
      7: { uid: 7, n: 'Vega', puid: 2, ships: 12 },
    },
  },
};

assert.equal(summarize(current).tick, 11);
const events = diffSnapshots(previous, current);
const plain = (text) => String(text).replace(/\[\[([^\]]+)\]\]/g, '$1');
const messages = events.map((event) => plain(event.message));
assert(messages.includes('Luka gained 46 ships since last scan.'));
assert(messages.includes('Luka gained 1 stars since last scan.'));
assert(messages.includes('Luka upgraded Weapons from 2 to 3.'));
assert(messages.includes('Vega changed owner from Luka to Bob.'));
assert(messages.includes('Vega lost 8 stationed ships.'));

const intel = strategicIntel(summarize(current), events).map((item) => plain(item.title));
assert(intel.includes('Luka lost 1 planet to Bob.'));
assert(intel.includes('Bob lost 8 ships in the selected window.'));
assert(intel.includes('Luka is investing in economy.'));
assert.equal(isGameOver({ game_over: 1 }), true);
assert.equal(isGameOver({ gameOver: true }), true);
assert.equal(isGameOver({ game_over: 0 }), false);
assert.equal(isGameOver({}), false);
console.log('Intel diff tests passed.');
