'use strict';
const { K, W, districts, measures, calculate, evaluate, baseline } = require('./engine');
const names = ['Разгрузка дорог', 'Общественный транспорт', 'Озеленение', 'Качество воздуха', 'Школы и детсады', 'Поликлиники', 'Безопасность улиц', 'Безопасность движения', 'Надёжность ЖКХ', 'Обращения жителей'];
const lookup = Object.fromEntries(measures.map(m => [m.id, m]));
const fmt = n => n.toFixed(2);
const signed = n => `${n >= 0 ? '+' : ''}${fmt(n)}`;

// Exact Shapley allocation for five decisions: evaluate 32 subsets.
// Subsets are mathematical counterfactuals, not playable scenarios.
function attribution(choices) {
  const n = choices.length, scores = [], factorial = [1, 1, 2, 6, 24, 120];
  for (let mask = 0; mask < 2 ** n; mask++) scores[mask] = evaluate(choices.filter((_, i) => mask & (1 << i))).score;
  return choices.map((choice, i) => {
    let value = 0;
    for (let mask = 0; mask < 2 ** n; mask++) {
      if (mask & (1 << i)) continue;
      const size = mask.toString(2).replaceAll('0', '').length;
      value += factorial[size] * factorial[n - size - 1] / factorial[n] * (scores[mask | (1 << i)] - scores[mask]);
    }
    return { ...choice, name: lookup[choice.id].name, value };
  });
}

function recommend(choices, current) {
  const seen = new Set(), candidates = [];
  let checked = 0;
  for (let remove = 0; remove < choices.length; remove++) {
    const rest = choices.filter((_, i) => i !== remove);
    for (const measure of measures) {
      if (rest.some(c => c.id === measure.id)) continue;
      for (const district of measure.type === 'Город' ? [null] : districts.map(d => d.name)) {
        const replacement = { id: measure.id, district };
        if (JSON.stringify(replacement) === JSON.stringify(choices[remove])) continue;
        const next = [...rest, replacement];
        const key = next.map(c => `${c.id}:${c.district || ''}`).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const result = calculate(next);
        if (!result.valid) continue;
        checked++;
        if (result.score <= current.score + 1e-9) continue;
        candidates.push({ choices: next, remove: choices[remove], add: replacement, score: result.score, gain: result.score - current.score, cost: result.cost, critical: result.critical.length, minimum: result.minimum });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.cost - b.cost || JSON.stringify(a.choices).localeCompare(JSON.stringify(b.choices)));
  return { checked, scope: 'Все допустимые замены одной меры или её района; глобальный оптимум не заявляется.', candidates: candidates.slice(0, 3).map((c, i) => ({ id: `candidate-${i + 1}`, ...c })) };
}

function factCatalog(result, shares, recommendations) {
  const strengths = [], risks = [];
  const weak = result.rows.filter(r => Math.abs(r.score - result.minimum) < 1e-9).map(r => r.name).join(', ');
  const summary = `Score ${fmt(result.score)}: ${signed(result.score - baseline.score)} к базе ${fmt(baseline.score)}. Бюджет ${result.cost} из 100.`;
  strengths.push({ id: 'formula', text: `Формула: 0,7 × средневзвешенный балл ${fmt(result.average)} + 0,3 × балл слабейшего района ${fmt(result.minimum)} − штраф ${result.critical.length} = ${fmt(result.score)}.` });
  for (const [i, row] of result.rows.entries()) {
    const delta = row.score - row.baseline;
    if (delta > 0) strengths.push({ id: `district-${i}`, text: `${row.name}: оценка района выросла с ${fmt(row.baseline)} до ${fmt(row.score)} (${signed(delta)}).` });
    if (Math.abs(delta) < 1e-9) risks.push({ id: `unchanged-${i}`, text: `${row.name}: оценка района осталась ${fmt(row.score)}; сценарий не улучшает его показатели.` });
  }
  const count = result.critical.length;
  if (!count) strengths.unshift({ id: 'critical-cleared', text: 'Все показатели достигли порога 40: штраф за критические значения равен 0.' });
  else risks.unshift({ id: 'critical-remain', text: `Критических значений ниже 40: ${count}. Штраф ${count}; проблемные ячейки: ${result.critical.join('; ')}.` });
  risks.push({ id: 'weakest', text: `Слабейший район: ${weak}, балл ${fmt(result.minimum)}. Эта оценка задаёт 30% итоговой формулы.` });
  for (const contribution of result.contributions.filter(c => c.delta < 0)) risks.push({ id: `tradeoff-${contribution.source}`, text: `${contribution.source}: ${contribution.district}, ${names[K.indexOf(contribution.indicator)]} снижается на ${fmt(-contribution.delta)} — компромисс выбранной меры.` });
  const lagged = shares.map(c => lookup[c.id]).filter(m => m.lag >= 3);
  if (lagged.length) risks.push({ id: 'lag', text: `У мер ${lagged.map(m => m.id).join(', ')} лаг от 3 кварталов. В горизонте 8 кварталов учтена только часть полного эффекта.` });
  const top = [...shares].sort((a, b) => b.value - a.value)[0];
  if (top) strengths.push({ id: 'attribution', text: `${top.id} (${top.name}) получает наибольший вклад по Шепли: ${signed(top.value)} балла. Метод распределяет общий прирост с учётом взаимодействий.` });
  for (const contribution of shares) {
    const fact = { id: `measure-${contribution.id}`, text: `${contribution.id} (${contribution.name}, ${contribution.district || 'весь город'}): распределённый вклад в Score ${signed(contribution.value)} балла.` };
    (contribution.value < 0 ? risks : strengths).push(fact);
  }
  for (const [id, label, indices] of [
    ['transport', 'Транспорт', [0, 1]], ['ecology', 'Экология', [2, 3]],
    ['social', 'Соцсфера', [4, 5]], ['safety', 'Безопасность', [6, 7]],
    ['services', 'Городские сервисы', [8, 9]]
  ]) {
    const delta = result.rows.reduce((sum, row, i) => sum + row.pop * indices.reduce((s, k) => s + W[k] * (row.indicators[k] - districts[i].v[k]), 0), 0);
    const fact = { id: `category-${id}`, text: `${label}: вклад направления в средневзвешенную оценку города изменился на ${signed(delta)} балла.` };
    (delta < 0 ? risks : strengths).push(fact);
  }
  const synergySources = [...new Set(result.contributions.filter(c => c.source.includes('+')).map(c => c.source))];
  if (synergySources.length) strengths.push({ id: 'synergy', text: `Сработали синергии ${synergySources.join(', ')}; фиксированные бонусы добавлены без уменьшения на лаг.` });
  return { summary, strengths, risks, recommendations: recommendations.candidates.map(c => ({ id: c.id, text: `Заменить ${c.remove.id} (${c.remove.district || 'город'}) на ${c.add.id} (${c.add.district || 'город'}): Score ${fmt(c.score)}, прирост ${signed(c.gain)}, стоимость ${c.cost}.` })) };
}

function relevantFacts(analysis, question = '') {
  const q = question.toLocaleLowerCase('ru').trim();
  const priority = [];
  if (/нур/.test(q)) priority.push('district-4', 'weakest', 'critical-remain');
  if (/есил/.test(q)) priority.push('district-0');
  if (/алмат/.test(q)) priority.push('district-1');
  if (/сарыарк/.test(q)) priority.push('district-2');
  if (/байконур/.test(q)) priority.push('district-3');
  for (const [pattern, id] of [
    [/транспорт|пробк|автобус|ларт|лрт/, 'transport'], [/эколог|воздух|озелен|смог/, 'ecology'],
    [/школ|поликлин|соц/, 'social'], [/безопас|дтп|камер/, 'safety'], [/жкх|сервис|обращен/, 'services']
  ]) if (pattern.test(q)) priority.push(`category-${id}`);
  const measure = q.match(/\bm\s?(1[0-4]|[1-9])\b/i);
  if (measure) priority.push(`measure-M${measure[1]}`);
  if (/score|балл|формул|почему/.test(q)) priority.push('formula', 'attribution');
  if (/улучш|замен|лучше|рекоменд/.test(q)) priority.push('attribution');
  const ordered = facts => [...facts].sort((a, b) => {
    const ai = priority.indexOf(a.id), bi = priority.indexOf(b.id);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
  });
  const facts = analysis.facts;
  return { strengths: ordered(facts.strengths).slice(0, 3), risks: ordered(facts.risks).slice(0, 3) };
}

function analyze(choices) {
  const result = calculate(choices);
  if (!result.valid) return result;
  const shares = attribution(choices), recommendations = recommend(choices, result);
  return { ...result, baseline, delta: result.score - baseline.score, attribution: shares, recommendations, facts: factCatalog(result, shares, recommendations) };
}
module.exports = { analyze, attribution, recommend, relevantFacts, names, fmt };
