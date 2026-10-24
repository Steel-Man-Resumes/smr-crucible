import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, MARKS, MAX_SCORE, MEDIAN_FIRST_UNIT, STEEL_MAN_MIN_FACTS, STEEL_MAN_MIN_LINES, STEEL_MAN_MIN_RESUMES, bandFor, componentPoints, componentViews, countWhereUnitBelow, dailyUnits, firstUnit, gainOptions, isSteelMan, nextGain, nextMark, saturationCount, scoreOf, steelManRequirements, weekStreak } from '../steelman/score';
import { COMPONENT_IDS, type ComponentCounts } from '../steelman/types';

test('first-unit weights follow f = round(4 x sqrt(t) x m) (memo 3.2)', () => {
  assert.deepEqual(Object.fromEntries(COMPONENT_IDS.map((id) => [id, firstUnit(id)])),
    { facts: 7, lines: 6, resumes: 27, lanes: 13, tailored: 18, sent: 20, practice: 20, disclosure: 26, proof: 13, feedback: 9 });
});
test('per-component maxima and the 532 ceiling fall out of the parts', () => {
  assert.deepEqual(componentViews({}).map((c) => c.max), [38, 29, 76, 30, 67, 94, 69, 67, 41, 21]);
  assert.equal(MAX_SCORE, 532);
});
test('caps: facts is the code cap, lines is the memo table value, every other cap is the saturation count (memo 3.4)', () => {
  assert.deepEqual(Object.fromEntries(COMPONENT_IDS.map((id) => [id, saturationCount(id)])),
    { facts: 10, lines: 9, resumes: 6, lanes: 4, tailored: 12, sent: 25, practice: 10, disclosure: 5, proof: 8, feedback: 4 });
  for (const id of COMPONENT_IDS) if (id !== 'facts' && id !== 'lines') assert.equal(COMPONENTS[id].cap, saturationCount(id), id);
  assert.equal(COMPONENTS.facts.cap, 40); assert.equal(COMPONENTS.lines.cap, 28);
});
test('marks derive from the curve: 65, 159, 235, 375', () => {
  assert.equal(MEDIAN_FIRST_UNIT, 15.5);
  assert.deepEqual(Object.fromEntries(COMPONENT_IDS.map((id) => [id, countWhereUnitBelow(id, MEDIAN_FIRST_UNIT)])),
    { facts: 1, lines: 1, resumes: 3, lanes: 1, tailored: 2, sent: 2, practice: 2, disclosure: 2, proof: 1, feedback: 1 });
  assert.deepEqual({ ...MARKS }, { firstLoop: 65, everyPart: 159, breadth: 235, depth: 375 });
});
test('a fresh account scores 0, band Showing up, and is pointed at real work', () => {
  assert.equal(scoreOf({}), 0);
  const band = bandFor(0, false);
  assert.equal(band.id, 'showing_up'); assert.equal(band.label, 'Showing up');
  assert.deepEqual(nextMark(0, false), { score: 65, label: 'In the game', pointsAway: 65 });
  assert.equal(isSteelMan({}), false);
  assert.match(nextGain({}).label, /\+\d+ points, about \d+ minutes\.$/);
  for (const c of componentViews({})) assert.equal(c.value, 0);
});
const week1: ComponentCounts = { facts: 5, lines: 14, resumes: 1, lanes: 1, tailored: 1, sent: 1 };
test('week 1 worked example = 120, In the game, next moves match memo 3.3', () => {
  assert.equal(scoreOf(week1), 120);
  assert.equal(bandFor(120, false).label, 'In the game');
  assert.deepEqual(gainOptions(week1).slice(0, 5).map((g) => [g.id, g.points]), [['feedback', 9], ['practice', 20], ['proof', 13], ['disclosure', 26], ['sent', 12]]);
  assert.ok(Math.abs(componentPoints('facts', 5) + componentPoints('lines', 14) - (18.1 + 23.4)) < 0.1);
});
const week6: ComponentCounts = { facts: 17, lines: 22, resumes: 2, lanes: 2, tailored: 5, sent: 9, practice: 3, disclosure: 1, proof: 2, feedback: 0 };
test('week 6 worked example = 319, Putting in work, 56 to Steel Man', () => {
  assert.equal(scoreOf(week6), 319);
  assert.equal(bandFor(319, false).label, 'Putting in work');
  assert.deepEqual(nextMark(319, false), { score: 375, label: 'Steel Man', pointsAway: 56 });
  assert.equal(gainOptions(week6)[0].id, 'feedback');
  assert.equal(gainOptions(week6)[1].id, 'disclosure');
});
test('the grinder scores 267 and every extra unit of what they ground adds nothing', () => {
  const g: ComponentCounts = { facts: 40, lines: 28, resumes: 1, lanes: 1, tailored: 12, sent: 25 };
  assert.equal(scoreOf(g), 267);
  assert.equal(scoreOf({ ...g, sent: 400, tailored: 99, facts: 1000 }), 267);
  assert.equal(bandFor(267, false).label, 'Putting in work');
  assert.ok(gainOptions(g).every((o) => !['facts', 'lines', 'tailored', 'sent'].includes(o.id)));
});
test('the slow careful reader scores 180, Covering ground; nothing looks at time', () => {
  assert.equal(scoreOf({ facts: 8, lines: 12, resumes: 1, lanes: 1, tailored: 1, sent: 2, practice: 1, disclosure: 1 }), 180);
  assert.equal(bandFor(180, false).label, 'Covering ground');
});
test('max = 532 and the breadth proof: the five largest components at cap stay under 375', () => {
  const all = Object.fromEntries(COMPONENT_IDS.map((id) => [id, COMPONENTS[id].cap]));
  assert.equal(scoreOf(all), 532);
  assert.ok(isSteelMan(all));
  const top5 = componentViews({}).map((c) => componentPoints(c.id, COMPONENTS[c.id].cap)).sort((a, b) => b - a).slice(0, 5);
  const sum = top5.reduce((a, b) => a + b, 0);
  assert.ok(sum < MARKS.depth, `top five at cap ${sum}`);
  assert.ok(Math.max(...top5) < 100);
});
test('a realistic Steel Man profile (memo 4.3) scores 387 and meets every requirement', () => {
  const p: ComponentCounts = { facts: 18, lines: 22, resumes: 3, lanes: 2, tailored: 7, sent: 12, practice: 5, disclosure: 2, proof: 3, feedback: 1 };
  assert.equal(scoreOf(p), 387);
  assert.ok(isSteelMan(p));
  assert.equal(bandFor(scoreOf(p), true).label, 'Steel Man');
  assert.equal(nextMark(scoreOf(p), true), null);
});
test('375 points without breadth stays Putting in work and lists what is left in plain words', () => {
  const p: ComponentCounts = { facts: 40, lines: 28, resumes: 6, lanes: 4, tailored: 12, sent: 25, practice: 0, disclosure: 0, proof: 8, feedback: 4 };
  assert.ok(scoreOf(p) >= 375, String(scoreOf(p)));
  assert.equal(isSteelMan(p), false);
  assert.equal(bandFor(scoreOf(p), false).label, 'Putting in work');
  const left = steelManRequirements(p).filter((r) => !r.done).map((r) => r.left).join(' ');
  assert.match(left, /Not started yet: interview practice, disclosure ready/);
  assert.doesNotMatch(left, /missing|failed|behind|lost|only/i);
});
test('Steel Man thresholds: 10 facts, 9 lines, 2 lanes or 3 resumes (Q3)', () => {
  assert.equal(STEEL_MAN_MIN_FACTS, 10); assert.equal(STEEL_MAN_MIN_LINES, 9); assert.equal(STEEL_MAN_MIN_RESUMES, 3);
  const base: ComponentCounts = { facts: 18, lines: 22, resumes: 2, lanes: 1, tailored: 7, sent: 12, practice: 5, disclosure: 2, proof: 3, feedback: 1 };
  assert.equal(steelManRequirements(base).find((r) => r.id === 'breadth')!.done, false);
  assert.equal(steelManRequirements({ ...base, lanes: 2 }).find((r) => r.id === 'breadth')!.done, true);
  assert.equal(steelManRequirements({ ...base, resumes: 3 }).find((r) => r.id === 'breadth')!.done, true);
});
test('no component is ever negative and bad input counts as zero', () => {
  assert.equal(scoreOf({ facts: -5, lines: Number.NaN, sent: Infinity }), 0);
});
test('copy: next-gain lines say minutes as information, never quick, never a prediction', () => {
  const all = [...gainOptions({}), ...gainOptions(week6)].map((g) => g.label).join(' ');
  assert.doesNotMatch(all, /quick|ready|hireable|likely|chance|odds|predict|—/i);
});
test('30-day strip counts units per UTC day, oldest first', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const strip = dailyUnits([{ component: 'sent', at: '2026-10-23T01:00:00Z' }, { component: 'facts', at: '2026-10-23T05:00:00Z' }, { component: 'proof', at: '2026-10-01T05:00:00Z' }, { component: 'proof', at: '2026-08-01T05:00:00Z' }], now);
  assert.equal(strip.length, 30); assert.equal(strip[29].day, '2026-10-23'); assert.equal(strip[29].units, 2);
  assert.equal(strip.find((d) => d.day === '2026-10-01')!.units, 1);
  assert.equal(strip.reduce((a, d) => a + d.units, 0), 3);
});
test('week streak: open week never breaks, two reserve weeks per eight, never shown under 2', () => {
  const now = new Date('2026-10-23T12:00:00Z'); // a Friday
  const w = (weeksAgo: number) => new Date(now.getTime() - weeksAgo * 7 * 86400000).toISOString();
  assert.deepEqual(weekStreak([], now), { weeks: 0, reserveLeft: 2, show: false });
  assert.deepEqual(weekStreak([w(0)], now), { weeks: 1, reserveLeft: 2, show: false });
  assert.equal(weekStreak([w(1), w(2), w(3)], now).weeks, 3); // this week still open
  const bridged = weekStreak([w(0), w(2), w(3)], now);
  assert.deepEqual(bridged, { weeks: 3, reserveLeft: 1, show: true });
  assert.equal(weekStreak([w(0), w(2), w(4), w(6)], now).weeks, 3); // the third quiet week inside 8 has no reserve
});
