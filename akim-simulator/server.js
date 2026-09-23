'use strict';
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {runAgent,check}=require('./agent');
const assets={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/engine.js':['engine.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/advisor.js':['advisor.js','text/javascript']};
function createServer(analyze=runAgent) {
 let busy=false;
 return http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  res.setHeader('X-Content-Type-Options','nosniff');
  const host=req.headers.host||'';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(403,{error:'Недопустимый host.'});
  if (req.method==='GET' && assets[req.url]) {
   const [file,type]=assets[req.url];
   try { const body=await fs.readFile(path.join(__dirname,file));res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(body); }
   catch {send(500,{error:'Не удалось прочитать файл.'});} return;
  }
  if(req.method!=='POST'||req.url!=='/api/analyze') return send(404,{error:'Не найдено.'});
  if(req.headers.origin && req.headers.origin!=='http://'+host) return send(403,{error:'Недопустимый origin.'});
  if(!req.headers['content-type']?.startsWith('application/json')) return send(415,{error:'Ожидается JSON.'});
  if(busy) return send(429,{error:'Анализ уже выполняется. Дождитесь завершения.'});
  busy=true;
  try {
   const chunks=[];let size=0;
   for await (const chunk of req) {size+=chunk.length;if(size>16384){send(413,{error:'Слишком большой запрос.'});return;}chunks.push(chunk);}
   let payload;try {payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'Некорректный JSON.'});}
   const errors=check(payload?.choices);
   if(errors.length) return send(400,{error:errors.join(' ')});
   send(200,await analyze(payload.choices));
  } catch(error) {send(error.status||500,{error:error.status?error.message:'Не удалось выполнить анализ.'});}
  finally {busy=false;}
 });
}
if(require.main===module) {
 const port=Number(process.env.PORT||3000);
 createServer().listen(port,'127.0.0.1',()=>console.log('Аким-симулятор: http://127.0.0.1:'+port));
}
module.exports={createServer};
