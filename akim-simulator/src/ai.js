'use strict';
// The model selects verified fact IDs. Only server-owned text reaches the UI.
// This deliberately limits narrative freedom in exchange for numerical grounding.
const { relevantFacts } = require('./analysis');
const instructions = `Ты советник в синтетическом симуляторе городского управления. Изучи расчёт, факты и варианты замен. Если есть вопрос пользователя, в первую очередь выбери факты, которые на него отвечают. Выбери от одного до трёх наиболее существенных сильных сторон и от одного до трёх рисков, расположив их по важности. Если есть улучшающие варианты, выбери один по балансу Score, слабейшего района и критических показателей. Верни ТОЛЬКО JSON: {"strength_ids":["существующий id"],"risk_ids":["существующий id"],"recommendation_id":"существующий id или null"}. Используй только идентификаторы из соответствующих списков facts. Если есть critical-remain или tradeoff-M11, обязательно включи эти риски. Не считай новые числа, не создавай факты, не добавляй пояснений вне JSON.`;

function providerConfig(env = process.env) {
  const provider = env.AI_PROVIDER || 'offline';
  const prefix = provider === 'openai' ? 'OPENAI' : 'NVIDIA';
  return { provider, key: env[`${prefix}_API_KEY`] || '', model: env[`${prefix}_MODEL`] || '' };
}
function status(env = process.env) {
  const c = providerConfig(env);
  return { provider: c.provider, configured: ['openai', 'nvidia'].includes(c.provider) && Boolean(c.key && c.model), model: c.model || null };
}
function localBriefing(analysis, reason = 'offline', requestedProvider = 'offline', question = '') {
  const facts = analysis.facts;
  const selected = relevantFacts(analysis, question);
  return { mode: 'offline', requestedProvider, reason, summary: facts.summary, strengths: selected.strengths.map(f => f.text), risks: selected.risks.map(f => f.text), recommendation: facts.recommendations[0] || null };
}
function parseSelection(text, facts) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).some(k => !['strength_ids', 'risk_ids', 'recommendation_id'].includes(k))) throw new Error('invalid_selection');
  for (const [field, allowed] of [['strength_ids', facts.strengths], ['risk_ids', facts.risks]]) {
    const ids = parsed[field];
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => !allowed.some(f => f.id === id))) throw new Error('invalid_selection');
  }
  for (const required of ['critical-remain', 'tradeoff-M11']) if (facts.risks.some(f => f.id === required) && !parsed.risk_ids.includes(required)) throw new Error('invalid_selection');
  if (facts.recommendations.length ? !facts.recommendations.some(f => f.id === parsed.recommendation_id) : parsed.recommendation_id !== null) throw new Error('invalid_selection');
  return parsed;
}

async function explain(analysis, { env = process.env, fetchImpl = fetch, question = '' } = {}) {
  const c = providerConfig(env);
  if (c.provider === 'offline') return localBriefing(analysis, 'offline', 'offline', question);
  if (!['openai', 'nvidia'].includes(c.provider)) return localBriefing(analysis, 'unknown_provider', c.provider, question);
  if (!c.key || !c.model) return localBriefing(analysis, 'missing_configuration', c.provider, question);
  const data = JSON.stringify({ question, score: analysis.score, average: analysis.average, minimum: analysis.minimum, critical: analysis.criticalCells, rows: analysis.rows, attribution: analysis.attribution, candidates: analysis.recommendations.candidates, facts: analysis.facts });
  const isOpenAI = c.provider === 'openai';
  const url = isOpenAI ? 'https://api.openai.com/v1/responses' : 'https://integrate.api.nvidia.com/v1/chat/completions';
  const body = isOpenAI
    ? { model: c.model, instructions, input: data, max_output_tokens: 2048, store: false }
    : { model: c.model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: data }], max_tokens: 2048, stream: false };
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) return localBriefing(analysis, `provider_http_${response.status}`, c.provider, question);
    const payload = await response.json();
    const text = isOpenAI ? (payload.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n') : payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length > 16000) throw new Error('invalid_selection');
    const selection = parseSelection(text, analysis.facts);
    const pick = (ids, list) => ids.map(id => list.find(f => f.id === id).text);
    return { mode: 'live', provider: c.provider, model: c.model, summary: analysis.facts.summary, strengths: pick(selection.strength_ids, analysis.facts.strengths), risks: pick(selection.risk_ids, analysis.facts.risks), recommendation: analysis.facts.recommendations.find(f => f.id === selection.recommendation_id) || null };
  } catch (error) {
    const reason = ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : error.message === 'invalid_selection' || error instanceof SyntaxError ? 'invalid_selection' : 'connection_error';
    return localBriefing(analysis, reason, c.provider, question);
  }
}
module.exports = { explain, status, parseSelection, localBriefing };
