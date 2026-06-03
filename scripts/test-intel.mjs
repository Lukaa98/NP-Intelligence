import assert from 'node:assert/strict';
import { diffSnapshots, summarize } from '../src/intel.js';

const previous = {
  data: {
    tick: 10,
    players: {
      1: { uid: 1, alias: 'Luka', totalStrength: 100, totalStars: 10, totalEconomy: 20, totalIndustry: 10, totalScience: 5, tech: { 5: { level: 2 } } },
    },
  },
};

const current = {
  data: {
    tick: 11,
    players: {
      1: { uid: 1, alias: 'Luka', totalStrength: 146, totalStars: 11, totalEconomy: 22, totalIndustry: 10, totalScience: 6, tech: { 5: { level: 3 } } },
    },
  },
};

assert.equal(summarize(current).tick, 11);
const messages = diffSnapshots(previous, current).map((event) => event.message);
assert(messages.includes('Luka gained 46 ships since last scan.'));
assert(messages.includes('Luka gained 1 stars since last scan.'));
assert(messages.includes('Luka upgraded Weapons from 2 to 3.'));
console.log('Intel diff tests passed.');
