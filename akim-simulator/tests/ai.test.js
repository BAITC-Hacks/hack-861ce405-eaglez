'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../src/analysis');
const { explain, parseSelection } = require('../src/ai');
const analysis = analyze([['M7', 'Нура'], ['M8', 'Нура'], ['M10', 'Нура'], ['M12', null], ['M5', 'Сарыарка']].map(([id, district]) => ({ id, district })));
const selection = { strength_ids: ['critical-cleared'], risk_ids: ['weakest'], recommendation_id: analysis.facts.recommendations[0].id };
test('offline and missing config make no network request', async () => {
  const fetchImpl = () => { throw new Error('must not call'); };
  assert.equal((await explain(analysis, { env: {}, fetchImpl })).reason, 'offline');
  assert.equal((await explain(analysis, { env: { AI_PROVIDER: 'openai' }, fetchImpl })).reason, 'missing_configuration');
});
for (const provider of ['openai', 'nvidia']) test(`${provider} adapter uses documented endpoint and emits only trusted fact text`, async () => {
  const env = { AI_PROVIDER: provider, [`${provider.toUpperCase()}_API_KEY`]: 'test-secret', [`${provider.toUpperCase()}_MODEL`]: 'test-model' };
  const fetchImpl = async (url, options) => {
    assert.equal(url, provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(JSON.parse(options.body).model, 'test-model');
    return { ok: true, json: async () => provider === 'openai' ? { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(selection) }] }] } : { choices: [{ message: { content: JSON.stringify(selection) } }] } };
  };
  const r = await explain(analysis, { env, fetchImpl });
  assert.equal(r.mode, 'live');
  assert.equal(r.provider, provider);
  assert.deepEqual(r.strengths, [analysis.facts.strengths.find(f => f.id === 'critical-cleared').text]);
  assert.ok(!JSON.stringify(r).includes('test-secret'));
});
test('invented facts, extra fields and unverified numbers are rejected', () => {
  for (const invalid of [{ ...selection, strength_ids: ['Score=999'] }, { ...selection, score: 100 }, { ...selection, recommendation_id: 'imaginary' }, { ...selection, risk_ids: [] }]) assert.throws(() => parseSelection(JSON.stringify(invalid), analysis.facts));
});
test('HTTP error, malformed output and timeout return labelled fallback', async () => {
  const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'secret', OPENAI_MODEL: 'test-model' };
  assert.equal((await explain(analysis, { env, fetchImpl: async () => ({ ok: false, status: 401 }) })).reason, 'provider_http_401');
  assert.equal((await explain(analysis, { env, fetchImpl: async () => ({ ok: true, json: async () => ({ output: [] }) }) })).reason, 'invalid_selection');
  assert.equal((await explain(analysis, { env, fetchImpl: async () => { throw new DOMException('test', 'TimeoutError'); } })).reason, 'timeout');
});
test('local question about Nura selects the district calculation', async () => {
  const r = await explain(analysis, { env: {}, question: 'Что произошло с Нурой?' });
  assert.equal(r.mode, 'offline');
  assert.ok(r.strengths.some(f => f.includes('Нура:')));
});
