/* W7 saver · the deposit watchdog (lib/deposits.ts) and the household profiles (lib/household.ts), run in node on synthetic rows.
   Run: npm run test:deposits */
import { HISH_CAP_MONTHLY, HISH_RATES, PENSION_RATES, SEVERANCE_FULL, addMonths, auditDeposits, deadlineOf, defaultRates, depSummary, expectedOf, kindOf, letterOf, monthsWindow, rateTotal, rowTotal, validYm } from '../src/lib/deposits';
import type { DepositRow } from '../src/lib/clientTypes';
import { EMPTY_PROFILES, PER_PROFILE_KEYS, addProfile, keyFor, normProfiles, removeProfile, setActive, thirdPerson } from '../src/lib/household';
import { scriptOf } from '../src/lib/script';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, tol = 0.01) => a != null && Math.abs(a - b) <= tol;

/* ---- rates and the expected deposit ---- */
ok(rateTotal(PENSION_RATES) === 18.5 && PENSION_RATES.employee === 6 && PENSION_RATES.employer === 6.5 && PENSION_RATES.severance === 6, 'pension minimum 6 + 6.5 + 6 = 18.5%');
ok(SEVERANCE_FULL === 8.33 && rateTotal(HISH_RATES) === 10, 'full severance 8.33%; השתלמות 2.5 + 7.5');
ok(kindOf('פנסיה מקיפה') === 'pension' && kindOf('פנסיה כללית') === 'pension' && kindOf('השתלמות') === 'hishtalmut' && kindOf('גמל') === null, 'kindOf');
const e = expectedOf(12000, PENSION_RATES, 'pension');
ok(near(e.employee, 720) && near(e.employer, 780) && near(e.severance, 720) && near(e.total, 2220) && !e.capped, 'pension on 12,000: 720 / 780 / 720 = 2,220');
const h = expectedOf(20000, HISH_RATES, 'hishtalmut');
ok(h.capped && h.base === HISH_CAP_MONTHLY && near(h.employee, 392.8) && near(h.employer, 1178.4) && near(h.total, 1571.2), 'השתלמות on 20,000 is capped at 15,712: 392.8 / 1,178.4');
ok(!expectedOf(10000, HISH_RATES, 'hishtalmut').capped, 'השתלמות under the cap is not capped');
ok(defaultRates('pension').employee === 6 && defaultRates('hishtalmut').severance === 0, 'default rates per kind');

/* ---- rows and months ---- */
ok(rowTotal({ ym: '2025-01', employee: 720, employer: 780, severance: 720 }) === 2220, 'itemised row sums the parts');
ok(rowTotal({ ym: '2025-01', total: 2220 }) === 2220 && rowTotal({ ym: '2025-01' }) === null, 'a total-only row; an empty row says nothing');
ok(rowTotal({ ym: '2025-01', employee: 700, total: 9999 }) === 700, 'parts win over a stated total');
ok(validYm('2025-01') && !validYm('2025-13') && !validYm('25-01') && !validYm(null), 'validYm');
ok(addMonths('2025-12', 1) === '2026-01' && addMonths('2025-01', -1) === '2024-12' && addMonths('2025-03', -11) === '2024-04', 'addMonths crosses years');
ok(deadlineOf('2025-03') === '2025-04-15', 'deadline: the 15th of the following month');
const win = monthsWindow([{ ym: '2025-06' }, { ym: '2024-11' }]);
ok(win.length === 12 && win[0] === '2024-07' && win[11] === '2025-06', 'the window ends at the latest row');
ok(monthsWindow([], 12, new Date(2026, 10, 2))[11] === '2026-10', 'no rows: the window ends at the month before today');

/* ---- the audit: a clean year ---- */
const full = (ym: string, extra: Partial<DepositRow> = {}): DepositRow => ({ ym, employee: 720, employer: 780, severance: 720, ...extra });
const year = Array.from({ length: 12 }, (_, i) => full(addMonths('2025-01', i), { paid: `${addMonths(addMonths('2025-01', i), 1)}-10` }));
const a0 = auditDeposits(year, 12000, PENSION_RATES, 'pension');
ok(a0.months.length === 12 && a0.missing.length === 0 && a0.short.length === 0 && a0.late.length === 0 && a0.totalGap === 0 && a0.n === 12, 'a full year on time: nothing to report');
ok(near(a0.totalGot, 26640) && near(a0.totalExp, 26640), 'totals add up (12 × 2,220)');
ok(depSummary(a0) === null, 'no summary line when all is well');
ok(/כל ההפקדות נמצאו בסכום הצפוי ובמועד/.test(letterOf(a0, { fund: 'קרן א', prod: 'פנסיה מקיפה' })), 'the clean letter says so');

/* ---- the audit: gaps ---- */
const rows = year.filter((r) => r.ym !== '2025-03' && r.ym !== '2025-07')                      // two months missing
  .map((r) => (r.ym === '2025-05' ? { ...r, employer: 300 } : r))                               // one month short by 480
  .map((r) => (r.ym === '2025-02' ? { ...r, paid: '2025-04-22' } : r))                          // one month late (deadline 15.03)
  .map((r) => (r.ym === '2025-09' ? { ...r, employee: 719 } : r));                              // 1 ₪ off: rounding, not a shortfall
const a1 = auditDeposits(rows, 12000, PENSION_RATES, 'pension', { months: a0.months.map((m) => m.ym) });
ok(a1.missing.map((m) => m.ym).join() === '2025-03,2025-07', 'the two months with no row are missing');
ok(a1.short.length === 1 && a1.short[0].ym === '2025-05' && a1.short[0].gap === 480 && a1.short[0].got === 1740, 'May is short by 480');
ok(a1.months.find((m) => m.ym === '2025-09')?.status === 'ok', 'a 1 ₪ difference is within the tolerance');
ok(a1.late.length === 1 && a1.late[0].ym === '2025-02' && a1.late[0].lateDays === 38, 'February reached the fund 38 days after 15.03');
ok(a1.totalGap === 2220 * 2 + 480, 'the total shortfall adds the missing months in full');
ok(a1.n === 10, 'ten months carry a row');
const sum = depSummary(a1)!;
ok(/3 חודשים חסרים או חלקיים/.test(sum) && /4,920/.test(sum) && /הפקדה אחת הגיעה באיחור/.test(sum), `summary line: ${sum}`);

/* ---- several rows in a month, a row with its own salary, a total-only row ---- */
const a2 = auditDeposits([{ ym: '2025-01', total: 1000 }, { ym: '2025-01', total: 1220 }, { ym: '2025-02', employee: 900, employer: 975, severance: 900, salary: 15000 }], 12000, PENSION_RATES, 'pension', { months: ['2025-01', '2025-02', '2025-03'] });
ok(a2.months[0].got === 2220 && a2.months[0].status === 'ok', 'two rows of one month add up');
ok(a2.months[1].salary === 15000 && near(a2.months[1].exp.total, 2775) && a2.months[1].status === 'ok', 'a row with its own salary is read against it');
ok(a2.months[2].status === 'missing' && a2.months[2].gap === 2220, 'a month with no row is missing in full');
/* a saver with a different agreed rate (full severance) */
const a3 = auditDeposits([full('2025-01')], 12000, { ...PENSION_RATES, severance: SEVERANCE_FULL }, 'pension', { months: ['2025-01'] });
ok(a3.short.length === 1 && near(a3.short[0].gap, 280, 1), 'with 8.33% severance the same row is short by ~280');
/* overpayment is not a shortfall */
const a4 = auditDeposits([full('2025-01', { employer: 2000 })], 12000, PENSION_RATES, 'pension', { months: ['2025-01'] });
ok(a4.months[0].status === 'over' && a4.totalGap === 0, 'more than expected is "over", not a gap');
/* השתלמות with the cap */
const a5 = auditDeposits([{ ym: '2025-01', employee: 392.8, employer: 1178.4 }], 20000, HISH_RATES, 'hishtalmut', { months: ['2025-01'] });
ok(a5.months[0].status === 'ok' && a5.months[0].exp.capped, 'השתלמות at the cap is read as ok');
/* invalid rows are ignored */
const a6 = auditDeposits([{ ym: 'bad', total: 5 } as DepositRow, { ym: '2025-01', total: 2220 }], 12000, PENSION_RATES, 'pension', { months: ['2025-01'] });
ok(a6.months[0].status === 'ok' && a6.n === 1, 'a row with a bad month is ignored');

/* ---- the letter ---- */
const L = letterOf(a1, { fund: 'הראל פנסיה', prod: 'פנסיה מקיפה', id: 1234 });
ok(L.startsWith('שלום,'), 'letter opens');
ok(/לא נמצאה הפקדה: 03\/2025, 07\/2025/.test(L), 'letter names the missing months');
ok(/05\/2025: הופקדו 1,740 ש"ח במקום כ-2,220 ש"ח \(חסרים כ-480 ש"ח\)/.test(L), 'letter states the short month with amounts');
ok(/סך ההפרש: כ-4,920 ש"ח/.test(L), 'letter totals the shortfall');
ok(/02\/2025 הגיעה ב-22\.04\.2025 \(38 ימים אחרי ה-15 בחודש העוקב\)/.test(L), 'letter names the late deposit');
ok(/6% עובד, 6.5% מעסיק ו-6% פיצויים \(18.5% בסך הכול\), המינימום לפי צו ההרחבה לביטוח פנסיוני מקיף במשק/.test(L), 'letter cites the order and the rates');
ok(/תקנות הפיקוח על שירותים פיננסיים \(קופות גמל\) \(תשלומים לקופת גמל\), התשע"ד-2014/.test(L) && /7 ימי עסקים/.test(L) && /15 יום מתום החודש/.test(L), 'letter cites the regulations and the deadline');
ok(/מינהל הסדרה ואכיפת חוקי עבודה במשרד העבודה \(מוקד 1-800-354-354\)/.test(L), 'letter names the complaints body');
ok(!/מומלץ|כדאי לעבור/.test(L), 'letter recommends nothing');
const L3 = letterOf(a1, { fund: 'הראל פנסיה', prod: 'פנסיה מקיפה', third: true });
ok(/החוסך\/ת/.test(L3) && !/\bשלי\b/.test(L3) && !/אפנה/.test(L3), 'third-person letter names "החוסך/ת" and no one else');
const LH = letterOf(auditDeposits([{ ym: '2025-01', total: 1000 }], 20000, HISH_RATES, 'hishtalmut', { months: ['2025-01'] }), { fund: 'קרן ב', prod: 'השתלמות' });
ok(/2.5% עובד ו-7.5% מעסיק/.test(LH) && /תקרת השכר של 15,712 ש"ח/.test(LH) && /כפי שסוכם/.test(LH), 'השתלמות letter: agreed rates and the cap, no statutory claim');

/* ---- household profiles ---- */
ok(keyFor('mine', 'me') === 'mine' && keyFor('my:age', 'me') === 'my:age', '"אני" keeps the plain keys: nothing saved before this wave moves');
ok(keyFor('mine', 'spouse') === 'mine@spouse' && keyFor('my:seen', 'parent') === 'my:seen@parent', 'other profiles get a suffix');
ok(JSON.stringify(normProfiles(null)) === JSON.stringify(EMPTY_PROFILES) && JSON.stringify(normProfiles({ active: 'x', list: ['zzz', 'spouse', 'spouse'] })) === JSON.stringify({ v: 1, active: 'me', list: ['me', 'spouse'] }), 'normProfiles cleans anything');
const p1 = addProfile(EMPTY_PROFILES, 'spouse');
ok(p1.active === 'spouse' && p1.list.join() === 'me,spouse' && addProfile(p1, 'spouse').list.length === 2, 'adding a profile activates it, once');
const p2 = addProfile(p1, 'parent');
ok(setActive(p2, 'me').active === 'me' && setActive(p2, 'spouse').active === 'spouse', 'switching');
const rm = removeProfile(p2, 'parent');
ok(rm.profiles.active === 'me' && rm.profiles.list.join() === 'me,spouse' && rm.drop.length === PER_PROFILE_KEYS.length && rm.drop.includes('mine@parent') && rm.drop.includes('my:seen@parent'), 'removing the active profile falls back to "אני" and names its keys');
ok(removeProfile(p2, 'me').drop.length === 0 && removeProfile(p2, 'me').profiles.list.length === 3, '"אני" cannot be removed');
ok(!thirdPerson('me') && thirdPerson('spouse'), 'the note speaks in the first person only for "אני"');
const V = { fee: { own: true, v: 0.5, med: 0.3, q1: null, cap: null, higher: 0, lower: 0, n: 0, word: 'high' as const, pct: null, basis: 'avg' as const, ref: 0.3 }, dep: null, dflt: null };
const s3 = scriptOf({ name: 'קרן א', prod: 'פנסיה מקיפה', track: 'כללי', src: 'פנסיה-נט, 09/26', v: V, third: true });
ok(/החוסך\/ת/.test(s3) && !/אני /.test(s3) && !/שלי/.test(s3), 'the agent note for another profile says "החוסך/ת", never a name or "אני"');
ok(/אני חוסך\/ת/.test(scriptOf({ name: 'קרן א', prod: 'פנסיה מקיפה', track: 'כללי', src: 'x', v: V })), 'the note for "אני" is unchanged');

console.log(`deposits + household: ${pass} passed, ${fail} failed`);
if (fail) { for (const b of bad) console.log('  FAIL', b); process.exit(1); }
