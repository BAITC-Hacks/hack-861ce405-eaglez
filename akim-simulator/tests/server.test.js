'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const choices = [['M7', 'Нура'], ['M8', 'Нура'], ['M10', 'Нура'], ['M12', null], ['M5', 'Сарыарка']].map(([id, district]) => ({ id, district }));
async function withServer(run, opts = {}) {
  const server = createServer({ env: {}, ...opts });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const post = (base, route, data) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
test('server computes authoritative score and rejects forged/invalid scenario', () => withServer(async base => {
  const r = await post(base, '/api/analyze', { choices, score: 999, cost: 0 });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Math.abs(body.score - 56.54307) < 1e-9);
  assert.equal(body.cost, 95);
  const invalid = await post(base, '/api/analyze', { choices: choices.slice(1) });
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).score, undefined);
}));
test('private files and secrets are never served', () => withServer(async base => {
  for (const route of ['/.env', '/.env.example', '/server.js', '/src/ai.js', '/package.json', '/%2e%2e/.env']) assert.equal((await fetch(base + route)).status, 404);
  const config = await (await fetch(base + '/api/config')).text();
  assert.ok(!config.includes('private-secret'));
}, { env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'private-secret', OPENAI_MODEL: 'test-model' } }));
test('malformed JSON, oversized payload and cross-origin posts rejected', () => withServer(async base => {
  const headers = { 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/analyze', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/analyze', { method: 'POST', headers, body: 'x'.repeat(17000) })).status, 413);
  assert.equal((await fetch(base + '/api/analyze', { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: '{}' })).status, 403);
}));
test('offline briefing and preview validation work without keys', () => withServer(async base => {
  assert.equal((await post(base, '/api/validate', { choices: [] })).status, 200);
  const response = await post(base, '/api/explain', { choices });
  const briefing = await response.json();
  assert.equal(briefing.mode, 'offline');
  assert.ok(briefing.summary.includes('56.54'));
}));
test('questions require valid input and receive scenario-specific facts', () => withServer(async base => {
  const bad = await post(base, '/api/ask', { choices, question: 123 });
  assert.equal(bad.status, 422);
  const response = await post(base, '/api/ask', { choices, question: 'Что произошло с Нурой?' });
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.ok(answer.strengths.some(f => f.includes('Нура:')));
}));
test('successful live briefing is cached for identical unordered scenario', () => {
  let calls = 0;
  return withServer(async base => {
    const a = await (await post(base, '/api/explain', { choices })).json();
    const b = await (await post(base, '/api/explain', { choices: [...choices].reverse() })).json();
    assert.equal(a.mode, 'live'); assert.equal(b.cached, true); assert.equal(calls, 1);
  }, { env: { AI_PROVIDER: 'nvidia', NVIDIA_API_KEY: 'test', NVIDIA_MODEL: 'test' }, fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ strength_ids: ['critical-cleared'], risk_ids: ['weakest'], recommendation_id: 'candidate-1' }) } }] }) }; } });
});
