// Track compare D2 (pages/compare/decisionLead.ts): the "להחלטה" lens marks a row's lead only inside one category, shares ties inside
// the band, never marks a group of one or an all-tied group; signed figures carry a true minus. Bundles the module with esbuild.
// Run: node scripts/compare-decision-test.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'cmpdectest-')), out = join(dir, 'decisionLead.mjs');
let M;
try {
  await build({ entryPoints: [new URL('../src/pages/compare/decisionLead.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  M = await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
const { groupLead, signed, billions } = M;

let pass = 0, fail = 0;
const bad = [];
const eq = (a, b, what) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; bad.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); } };

const A = 'פנסיה | כללי', B = 'פנסיה | מניות';
// fees, lowest wins, one category; equal values share
eq(groupLead([0.62, 0.55, 0.59], [A, A, A], 'lo'), [false, true, false], 'lowest fee');
eq(groupLead([0, 0, 0.02], [A, A, A], 'lo'), [true, true, false], 'equal lowest share');
eq(groupLead([0.5, 0.5, 0.5], [A, A, A], 'lo'), [false, false, false], 'all equal: none');
// returns with the 0.10 band
eq(groupLead([6.7, 7.1, 6.6], [A, A, A], 'hi', 0.1), [false, true, false], '5Y lead');
eq(groupLead([8.4, 8.35, 8.0], [A, A, A], 'hi', 0.1), [true, true, false], 'inside band shares');
eq(groupLead([8.4, 8.35, 8.32], [A, A, A], 'hi', 0.1), [false, false, false], 'all inside band: none');
// across categories: each category on its own; a group of one never marked
eq(groupLead([9.0, 12.0, 8.0], [A, B, A], 'hi', 0.1), [true, false, false], 'cross: within A only');
eq(groupLead([9.0, 12.0], [A, B], 'hi', 0.1), [false, false], 'cross: groups of one');
// old generation / missing: no group, no value
eq(groupLead([0.3, 1.2, 0.5], [A, null, A], 'lo'), [true, false, false], 'old gen never marked');
eq(groupLead([null, 0.5, 0.6], [A, A, A], 'lo'), [false, true, false], 'missing value skipped');
eq(groupLead([null, 0.5], [A, A], 'lo'), [false, false], 'one value left: none');
// signed figures
eq(signed(6.649, 1), '+6.6%', 'plus');
eq(signed(-5.32, 2), '−5.32%', 'true minus U+2212');
eq(signed(-0.04, 1), '0.0%', 'rounds to zero: no sign');
eq(signed(null), '–', 'missing');
eq(billions(6812.4), '6.8', 'billions one decimal');
eq(billions(null), '–', 'billions missing');

console.log(`compare-decision: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
