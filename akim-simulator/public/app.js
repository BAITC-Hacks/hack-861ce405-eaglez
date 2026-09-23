'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toFixed(2).replace('.', ',');
const signed = n => `${n >= 0 ? '+' : ''}${fmt(n)}`;
const state = { config: null, choices: [], result: null, filter: 'Все', saved: [], revision: 0, selectedDistricts: {}, busy: false, aiBusy: false };
const storageKey = 'akim-scenarios-v2';
const lookup = id => state.config.measures.find(m => m.id === id);

function notice(text, error = false) {
  $('notice').hidden = !text;
  $('notice').className = `notice${error ? ' error' : ''}`;
  $('notice').textContent = text;
}
async function api(route, data) {
  const response = await fetch(route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const payload = await response.json();
  if (!response.ok) throw new Error((payload.errors || ['Ошибка сервера']).join(' '));
  return payload;
}
function readStored() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(s => s && typeof s.name === 'string' && Array.isArray(s.choices) && s.choices.length === 5).slice(-12).map(s => ({ name: s.name.slice(0, 60), choices: s.choices.map(c => ({ id: c?.id, district: c?.district ?? null })) }));
  } catch { return []; }
}
function writeStored() {
  try { localStorage.setItem(storageKey, JSON.stringify(state.saved.map(({ name, choices }) => ({ name, choices })))); }
  catch { notice('Браузер не разрешил сохранение. Скачайте сценарий как JSON.', true); }
}
function setFilter(category) { state.filter = category; renderCatalog(); }
function renderCatalog() {
  const categories = ['Все', ...new Set(state.config.measures.map(m => m.category))];
  $('filters').innerHTML = categories.map(c => `<button type="button" class="${state.filter === c ? 'active' : ''}" data-filter="${escapeHtml(c)}" aria-pressed="${state.filter === c}">${escapeHtml(c)}</button>`).join('');
  $('filters').querySelectorAll('button').forEach(b => b.onclick = () => setFilter(b.dataset.filter));
  $('catalog').innerHTML = state.config.measures.filter(m => state.filter === 'Все' || m.category === state.filter).map(m => {
    const selected = state.choices.some(c => c.id === m.id);
    const cost = state.choices.reduce((s, c) => s + lookup(c.id).cost, 0);
    const tooExpensive = cost + m.cost > 100;
    const district = state.selectedDistricts[m.id] || 'Нура';
    const disabled = selected || state.choices.length === 5 || tooExpensive || state.busy;
    return `<article class="measure ${selected ? 'selected' : ''}"><div class="measure-top"><span class="category">${escapeHtml(m.category)} · ${m.id}</span><span class="price">${m.cost} <small>ед.</small></span></div><h3>${escapeHtml(m.name)}</h3><div class="meta">${m.type === 'Город' ? 'Все районы' : 'Один район'} · лаг ${m.lag} кв. · реализуется ${(8 - m.lag) / 8 * 100}%</div><div class="effect-tags">${Object.entries(m.effects).map(([k, v]) => `<span class="${v < 0 ? 'negative' : ''}" title="Полный эффект до учёта лага">${k} ${v > 0 ? '+' : ''}${v}</span>`).join('')}</div><div class="add-area">${m.type === 'Район' ? `<select data-district="${m.id}" aria-label="Район для ${m.id}" ${selected ? 'disabled' : ''}>${state.config.districts.map(d => `<option ${d.name === district ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}</select>` : '<span class="city-label">Весь город</span>'}<button data-add="${m.id}" ${disabled ? 'disabled' : ''} title="${tooExpensive && !selected ? 'Не хватает бюджета' : ''}">${selected ? '✓ В плане' : 'Добавить'}</button></div></article>`;
  }).join('');
  $('catalog').querySelectorAll('[data-district]').forEach(s => s.onchange = () => state.selectedDistricts[s.dataset.district] = s.value);
  $('catalog').querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
    const m = lookup(b.dataset.add);
    await changeChoices([...state.choices, { id: m.id, district: m.type === 'Город' ? null : state.selectedDistricts[m.id] || 'Нура' }]);
  });
}
function renderSelection() {
  const cost = state.choices.reduce((s, c) => s + lookup(c.id).cost, 0);
  $('remaining').innerHTML = `${100 - cost} <small>/ 100</small>`;
  $('budget-fill').style.width = `${cost}%`;
  $('decision-count').innerHTML = `${state.choices.length} <small>/ 5</small>`;
  $('decision-dots').innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < state.choices.length ? 'filled' : ''}"></span>`).join('');
  $('selected').innerHTML = Array.from({ length: 5 }, (_, i) => {
    const c = state.choices[i];
    if (!c) return `<div class="slot empty"><span class="slot-number">${i + 1}</span>Место для решения</div>`;
    return `<div class="slot"><span class="slot-number">${i + 1}</span><div class="slot-content"><strong>${c.id} · ${escapeHtml(lookup(c.id).name)}</strong><small>${escapeHtml(c.district || 'Весь город')} · ${lookup(c.id).cost} ед.</small></div><button class="remove" data-remove="${i}" aria-label="Удалить ${c.id}" ${state.busy ? 'disabled' : ''}>×</button></div>`;
  }).join('');
  $('selected').querySelectorAll('[data-remove]').forEach(b => b.onclick = () => changeChoices(state.choices.filter((_, i) => i !== Number(b.dataset.remove))));
  $('plan-message').textContent = state.choices.length === 5 ? `Пять решений, ${new Set(state.choices.map(c => lookup(c.id).category)).size} направления. Остаток ${100 - cost} не даёт бонуса.` : `Осталось выбрать ${5 - state.choices.length}. Максимум две меры на направление.`;
}
async function changeChoices(next) {
  if (state.busy) return;
  state.busy = true;
  renderCatalog();
  try {
    await api('/api/validate', { choices: next });
    state.choices = next;
    state.revision++;
    state.result = null;
    notice('');
    $('briefing').innerHTML = '<p class="empty-note">Сценарий изменён. Получите новый разбор после выбора пяти решений.</p>';
    $('answer').innerHTML = '';
    renderSelection();
    renderResults();
    if (next.length === 5) state.result = await api('/api/analyze', { choices: next });
    renderResults();
  } catch (error) { notice(error.message, true); }
  finally { state.busy = false; renderCatalog(); renderSelection(); }
}
function renderResults() {
  const r = state.result, base = state.config.baseline;
  const visible = r || base.details;
  $('hero-score').textContent = fmt(r ? r.score : base.score);
  $('hero-delta').textContent = r ? `${signed(r.delta)} к исходным ${fmt(base.score)} балла` : 'Базовый Score. Итог появится после пяти решений.';
  $('score-state').textContent = r ? 'Допустимый сценарий' : 'Исходное состояние';
  $('average').textContent = fmt(visible.average);
  $('critical').textContent = visible.critical.length;
  $('save').disabled = $('export').disabled = !r;
  $('explain').disabled = !r || state.aiBusy;
  $('ask').disabled = $('question').disabled = !r || state.aiBusy;
  $('district-chart').innerHTML = visible.rows.map(row => `<div class="district-row"><span>${escapeHtml(row.name)}</span><div class="district-bars" role="img" aria-label="${escapeHtml(row.name)}: было ${fmt(row.baseline)}, стало ${fmt(row.score)}"><span style="width:${row.baseline}%"></span><span style="width:${row.score}%"></span></div><span class="values">${fmt(row.score)}<small>${signed(row.score - row.baseline)}</small></span></div>`).join('');
  const weakest = visible.rows.filter(row => Math.abs(row.score - visible.minimum) < 1e-9).map(row => row.name).join(', ');
  $('weakest').textContent = `Слабейший район: ${weakest} · ${fmt(visible.minimum)}. Его оценка определяет 30% итогового Score. Все шкалы на графике — от 0 до 100.`;
  $('formula-details').textContent = `${fmt(.7 * visible.average)} + ${fmt(.3 * visible.minimum)} − ${visible.critical.length} = ${fmt(visible.score)}. Отдельные слагаемые округлены только для показа.`;
  $('indicator-table').innerHTML = `<table><caption class="muted">Шкала 0–100: больше — лучше. Красным отмечены значения ниже 40.</caption><thead><tr><th>Район</th>${state.config.indicators.map(k => `<th title="${escapeHtml(k.name)}">${k.id}</th>`).join('')}</tr></thead><tbody>${visible.rows.map(row => `<tr><td>${escapeHtml(row.name)}</td>${row.indicators.map((v, i) => `<td class="${v < 40 ? 'danger' : ''}" title="${escapeHtml(state.config.indicators[i].name)}">${fmt(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="footnote">${state.config.indicators.map(k => `${k.id}: ${escapeHtml(k.name)}`).join(' · ')}</p>`;
  if (!r) {
    $('recommendation-note').textContent = 'После пяти решений сравним допустимые замены одной меры или её района.';
    $('recommendations').innerHTML = '';
    $('attribution').innerHTML = $('effects').innerHTML = '<p class="muted">Выберите пять решений.</p>';
    return;
  }
  $('recommendation-note').textContent = `Проверено допустимых альтернатив: ${r.recommendations.checked}. ${r.recommendations.scope}${r.recommendations.candidates.length ? '' : ' Улучшающих замен в этой области поиска нет.'}`;
  $('recommendations').innerHTML = r.recommendations.candidates.map((c, i) => `<article class="recommendation"><span class="category">ВАРИАНТ ${i + 1}</span><div class="recommendation-score">${fmt(c.score)}<small>${signed(c.gain)}</small></div><h3>${c.remove.id} → ${c.add.id}</h3><p>Вместо ${escapeHtml(lookup(c.remove.id).name)} (${escapeHtml(c.remove.district || 'город')}) — ${escapeHtml(lookup(c.add.id).name)} (${escapeHtml(c.add.district || 'город')}).</p><p>Бюджет: ${c.cost} · критических: ${c.critical}<br>Слабейший район: ${fmt(c.minimum)}</p><button data-apply="${i}">Применить замену</button></article>`).join('');
  $('recommendations').querySelectorAll('[data-apply]').forEach(b => b.onclick = () => changeChoices(r.recommendations.candidates[Number(b.dataset.apply)].choices));
  $('attribution').innerHTML = `<table><thead><tr><th>Мера</th><th>Район</th><th>Вклад в Score</th></tr></thead><tbody>${r.attribution.map(a => `<tr><td>${a.id} · ${escapeHtml(a.name)}</td><td>${escapeHtml(a.district || 'город')}</td><td class="positive">${signed(a.value)}</td></tr>`).join('')}<tr><td colspan="2"><strong>Сумма вкладов = общий прирост</strong></td><td><strong>${signed(r.attribution.reduce((s, a) => s + a.value, 0))}</strong></td></tr></tbody></table>`;
  $('effects').innerHTML = `<table><thead><tr><th>Источник</th><th>Район</th><th>Показатель</th><th>Эффект</th></tr></thead><tbody>${r.contributions.map(c => `<tr><td>${c.source}</td><td>${escapeHtml(c.district)}</td><td>${c.indicator}</td><td>${signed(c.delta)}</td></tr>`).join('')}</tbody></table>`;
}
function renderSaved() {
  $('saved').innerHTML = state.saved.length ? `<table><thead><tr><th>Сценарий</th><th>Score</th><th>Бюджет</th><th>Критических</th><th>Действия</th></tr></thead><tbody>${state.saved.map((s, i) => `<tr><td class="saved-name">${escapeHtml(s.name)}</td><td><strong>${fmt(s.result.score)}</strong></td><td>${s.result.cost}</td><td>${s.result.critical.length}</td><td><button data-load="${i}">Открыть</button> <button data-delete="${i}" aria-label="Удалить сохранённый сценарий ${i + 1}">×</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Сохраните два варианта и сравните их Score, бюджет и критические показатели.</p>';
  $('saved').querySelectorAll('[data-load]').forEach(b => b.onclick = () => { const s = state.saved[Number(b.dataset.load)]; $('scenario-name').value = s.name; changeChoices(s.choices.map(c => ({ ...c }))); });
  $('saved').querySelectorAll('[data-delete]').forEach(b => b.onclick = () => { state.saved.splice(Number(b.dataset.delete), 1); writeStored(); renderSaved(); });
}
function reasonText(reason) {
  if (reason?.startsWith('provider_http_')) return `Сервис вернул HTTP ${reason.split('_').at(-1)}. Проверьте ключ, доступ к модели и API-баланс.`;
  return { offline: 'Локальный разбор по правилам; внешняя модель не вызывалась.', missing_configuration: 'На сервере не заданы ключ или модель. Показан локальный разбор.', timeout: 'Модель не ответила вовремя. Показан локальный разбор.', invalid_selection: 'Модель вернула непроверяемые аргументы. Показан локальный разбор.', connection_error: 'Не удалось связаться с моделью. Показан локальный разбор.', unknown_provider: 'Провайдер настроен неверно. Показан локальный разбор.' }[reason] || 'Показан локальный разбор.';
}
function briefingHtml(b, short = false) {
  const strengths = short ? b.strengths.slice(0, 2) : b.strengths;
  const risks = short ? b.risks.slice(0, 2) : b.risks;
  return `<p class="briefing-mode">${b.mode === 'live' ? `ИИ: ${escapeHtml(b.provider)} · ${escapeHtml(b.model)}${b.cached ? ' · сохранённый ответ' : ''}. Модель выбрала аргументы из проверенных фактов.` : escapeHtml(reasonText(b.reason))}</p><p class="briefing-summary">${escapeHtml(b.summary)}</p><h3>Сильные стороны</h3><ul class="briefing-list">${strengths.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul><h3>Риски и компромиссы</h3><ul class="briefing-list">${risks.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>${b.recommendation ? `<h3>Следующий вариант</h3><p class="muted">${escapeHtml(b.recommendation.text)}</p>` : '<p class="muted">Среди проверенных замен улучшения не найдено.</p>'}`;
}
async function showBriefing() {
  if (!state.result || state.aiBusy) return;
  const revision = state.revision;
  state.aiBusy = true;
  $('explain').disabled = true;
  $('explain').textContent = 'Готовим разбор…';
  try {
    const b = await api('/api/explain', { choices: state.choices });
    if (revision !== state.revision) return;
    $('briefing').innerHTML = briefingHtml(b);
  } catch (error) { if (revision === state.revision) notice(error.message, true); }
  finally { state.aiBusy = false; $('explain').textContent = 'Разобрать сценарий'; renderResults(); }
}
async function askQuestion() {
  if (!state.result || state.aiBusy) return;
  const question = $('question').value.trim();
  if (question.length < 3 || question.length > 240) { notice('Вопрос должен содержать от 3 до 240 символов.', true); return; }
  const revision = state.revision;
  state.aiBusy = true;
  $('answer').textContent = 'Подбираем факты для ответа…';
  renderResults();
  try {
    const b = await api('/api/ask', { choices: state.choices, question });
    if (revision === state.revision) $('answer').innerHTML = briefingHtml(b, true);
  } catch (error) { if (revision === state.revision) notice(error.message, true); }
  finally { state.aiBusy = false; renderResults(); }
}
async function start() {
  try {
    state.config = await api('/api/config');
    const ai = state.config.ai;
    $('connection').textContent = ai.configured ? `${ai.provider} · настроен, не проверен` : 'Локальный режим';
    $('example').onclick = () => changeChoices(state.config.presets.example);
    $('cheap').onclick = () => changeChoices(state.config.presets.cheap);
    $('clear').onclick = () => { $('scenario-name').value = ''; changeChoices([]); };
    $('explain').onclick = showBriefing;
    $('question-form').onsubmit = event => { event.preventDefault(); askQuestion(); };
    document.querySelectorAll('[data-question]').forEach(button => button.onclick = () => { $('question').value = button.dataset.question; askQuestion(); });
    $('save').onclick = () => {
      if (!state.result) return;
      state.saved.push({ name: $('scenario-name').value.trim() || `Сценарий ${state.saved.length + 1}`, choices: state.choices.map(c => ({ ...c })), result: state.result });
      if (state.saved.length > 12) state.saved.shift();
      writeStored(); renderSaved();
    };
    $('export').onclick = () => {
      if (!state.result) return;
      const data = { schemaVersion: 2, name: $('scenario-name').value.trim() || 'Сценарий', choices: state.choices, result: state.result };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'akim-scenario.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    renderCatalog(); renderSelection(); renderResults(); renderSaved();
    // Never trust scores in browser storage; recalculate through the server.
    for (const stored of readStored()) {
      try { state.saved.push({ ...stored, result: await api('/api/analyze', { choices: stored.choices }) }); } catch { /* Ignore invalid older scenarios. */ }
    }
    renderSaved();
  } catch { $('connection').textContent = 'Нет связи с сервером'; notice('Не удалось запустить интерфейс. Выполните npm start и откройте http://localhost:3000.', true); }
}
start();
