'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { K, W, districts, measures, validate, evaluate, baseline } = require('./src/engine');
const { analyze, names } = require('./src/analysis');
const { explain, status } = require('./src/ai');
const { example, cheap } = require('./src/presets');
if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));

const assets = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };

function createServer({ env = process.env, fetchImpl = fetch } = {}) {
  const cachedBriefings = new Map();
  let inFlight = false;
  return http.createServer(async (req, res) => {
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const route = req.url?.split('?')[0];
    if (req.method === 'GET') {
      if (route === '/api/config') return send(200, { indicators: K.map((id, i) => ({ id, name: names[i], weight: W[i] })), districts, measures, baseline: { ...baseline, details: evaluate([]) }, ai: status(env), presets: { example, cheap } });
      if (Object.hasOwn(assets, route)) {
        const [file, type] = assets[route];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(fs.readFileSync(path.join(__dirname, 'public', file)));
      }
      return send(404, { errors: ['Страница не найдена.'] });
    }
    if (req.method !== 'POST' || !['/api/analyze', '/api/explain', '/api/ask', '/api/validate'].includes(route)) return send(404, { errors: ['Маршрут не найден.'] });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return send(403, { errors: ['Запрос должен приходить со страницы приложения.'] });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { errors: ['Нужен Content-Type application/json.'] });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) return send(413, { errors: ['Слишком большой запрос.'] });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { errors: ['Некорректный JSON.'] }); }
      const question = route === '/api/ask' && typeof body?.question === 'string' ? body.question.trim() : '';
      if (route === '/api/ask' && (typeof body?.question !== 'string' || question.length < 3 || question.length > 240)) return send(422, { errors: ['Вопрос должен содержать от 3 до 240 символов.'] });
      const complete = route !== '/api/validate';
      const errors = validate(body?.choices, complete);
      if (errors.length) return send(422, { valid: false, errors });
      // Ignore all client-supplied scores, costs and effects.
      const choices = body.choices.map(c => ({ id: c.id, district: c.district ?? null }));
      if (!complete) return send(200, { valid: true });
      const analysis = analyze(choices);
      if (route === '/api/analyze') return send(200, analysis);
      const signature = JSON.stringify({ choices: choices.map(c => `${c.id}:${c.district || ''}`).sort(), question });
      if (cachedBriefings.has(signature)) return send(200, { ...cachedBriefings.get(signature), cached: true });
      if (inFlight) return send(429, { errors: ['Уже готовится объяснение. Подождите его завершения.'] });
      inFlight = true;
      try {
        const briefing = await explain(analysis, { env, fetchImpl, question });
        if (briefing.mode === 'live') {
          if (cachedBriefings.size >= 50) cachedBriefings.delete(cachedBriefings.keys().next().value);
          cachedBriefings.set(signature, briefing);
        }
        return send(200, briefing);
      } finally { inFlight = false; }
    } catch { if (!res.headersSent) send(500, { errors: ['Не удалось обработать запрос. Попробуйте ещё раз.'] }); }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '127.0.0.1', () => console.log(`Аким на 5 часов: http://localhost:${port}\nРежим объяснений: ${status().provider}. Ctrl+C — остановить.`));
}
module.exports = { createServer };
