'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, validate, evaluate, baseline, K } = require('../src/engine');
const { analyze } = require('../src/analysis');
const make = rows => rows.map(([id, district = null]) => ({ id, district }));
const example = make([['M7', 'Нура'], ['M8', 'Нура'], ['M10', 'Нура'], ['M12'], ['M5', 'Сарыарка']]);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const value = (r, district, key) => r.rows.find(d => d.name === district).indicators[K.indexOf(key)];

test('official example and unrounded baseline match independent golden values', () => {
  near(baseline.score, 52.55768);
  near(calculate(example).score, 56.54307);
  near(calculate(example).score - baseline.score, 3.98539);
  assert.equal(calculate(example).cost, 95);
  assert.deepEqual(calculate(example).critical, []);
});
test('only strictly less than 40 is critical', () => {
  const r = evaluate([]);
  assert.equal(value(r, 'Нура', 'T2'), 40);
  assert.equal(r.critical.length, 2);
  assert.deepEqual(r.criticalCells.map(c => c.indicator), ['S1', 'S2']);
});
test('lag, district scope and unscaled Safe City synergy', () => {
  const r = calculate(example);
  near(value(r, 'Нура', 'S1'), 48);
  near(value(r, 'Нура', 'S2'), 43.75);
  near(value(r, 'Нура', 'B1'), 67.5);
  near(value(r, 'Есиль', 'B1'), 78);
  near(value(r, 'Сарыарка', 'E2'), 48.75);
  for (const row of r.rows) near(row.indicators[9] - evaluate([]).rows.find(d => d.name === row.name).indicators[9], 4.375);
});
test('M1+M2 synergy applies to M1 district only', () => {
  const r = calculate(make([['M1', 'Нура'], ['M2'], ['M9', 'Нура'], ['M12'], ['M10', 'Есиль']]));
  assert.equal(r.valid, true);
  near(value(r, 'Нура', 'T1'), 64.5);
  near(value(r, 'Алматы', 'T1'), 43);
});
test('M5+M6 ecology synergy is unscaled and district-specific', () => {
  const r = calculate(make([['M5', 'Сарыарка'], ['M6'], ['M9', 'Нура'], ['M12'], ['M10', 'Нура']]));
  assert.equal(r.valid, true);
  near(value(r, 'Сарыарка', 'E2'), 52.25);
  near(value(r, 'Нура', 'E2'), 66.5);
});
test('negative transport effect can create a new critical value', () => {
  const r = calculate(make([['M9', 'Нура'], ['M11', 'Алматы'], ['M10', 'Нура'], ['M12'], ['M4', 'Сарыарка']]));
  assert.equal(r.valid, true);
  near(value(r, 'Алматы', 'T1'), 38.25);
  assert.ok(r.criticalCells.some(c => c.district === 'Алматы' && c.indicator === 'T1'));
});
test('all 120 orders of the example give the same result', () => {
  function* permutations(items) { if (!items.length) yield []; else for (let i = 0; i < items.length; i++) for (const tail of permutations(items.filter((_, j) => i !== j))) yield [items[i], ...tail]; }
  for (const choices of permutations(example)) near(calculate(choices).score, 56.54307);
});
test('validator enforces cardinality, duplicates, known IDs and districts', () => {
  for (const bad of [null, {}, [], example.slice(0, 4), [...example, example[0]], [...example.slice(0, 4), example[0]], [{ id: '__proto__' }], [null], [{ id: 'M99' }]]) assert.ok(validate(bad).length);
  assert.ok(validate([{ id: 'M1' }], false).length);
  assert.ok(validate([{ id: 'M1', district: 'Unknown' }], false).length);
  assert.ok(validate([{ id: 'M12', district: 'Нура' }], false).length);
  assert.equal(validate([{ id: 'M12' }], false).length, 0);
});
test('budget exactly 100 allowed, over budget rejected', () => {
  const exact = make([['M3', 'Нура'], ['M4', 'Сарыарка'], ['M7', 'Нура'], ['M10', 'Нура'], ['M9', 'Есиль']]);
  // 30 + 15 + 24 + 12 + 10 = 91; separate exact-100 fixture.
  assert.equal(calculate(exact).cost, 91);
  const hundred = make([['M3', 'Нура'], ['M8', 'Нура'], ['M6'], ['M14'], ['M12']]);
  assert.equal(calculate(hundred).cost, 100);
  const over = make([['M3', 'Нура'], ['M7', 'Нура'], ['M5', 'Сарыарка'], ['M13', 'Алматы'], ['M12']]);
  assert.ok(validate(over).some(e => e.includes('Бюджет')));
});
test('category limit and all incompatibility rules', () => {
  assert.ok(validate(make([['M7', 'Нура'], ['M8', 'Нура'], ['M9', 'Нура']]), false).some(e => e.includes('более двух')));
  assert.ok(validate(make([['M1', 'Нура'], ['M3', 'Есиль']]), false).some(e => e.includes('несовместимы')));
  for (const pair of [['M4', 'M7'], ['M5', 'M13']]) {
    assert.ok(validate(make(pair.map(id => [id, 'Нура'])), false).some(e => e.includes('несовместимы')));
    assert.equal(validate(make([[pair[0], 'Нура'], [pair[1], 'Есиль']]), false).length, 0);
  }
});
test('Shapley contributions sum to total delta; recommendations are valid improvements', () => {
  const r = analyze(example);
  near(r.attribution.reduce((s, a) => s + a.value, 0), r.score - baseline.score);
  assert.ok(r.recommendations.checked > 0);
  assert.ok(r.recommendations.candidates.length > 0);
  let previous = Infinity;
  for (const c of r.recommendations.candidates) {
    const check = calculate(c.choices);
    assert.equal(check.valid, true);
    near(check.score, c.score);
    assert.ok(c.score > r.score && c.score <= previous);
    assert.ok(check.rows.every(row => row.indicators.every(v => v >= 0 && v <= 100)));
    previous = c.score;
  }
});
test('invalid scenarios never receive a score', () => {
  const r = analyze(example.slice(0, 4));
  assert.equal(r.valid, false);
  assert.equal(r.score, undefined);
});
