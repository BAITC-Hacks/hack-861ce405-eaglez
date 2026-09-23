'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate,swaps,runAgent}=require('./agent');
const {createServer}=require('./server');
const choices=[['M7','Нура'],['M8','Нура'],['M10','Нура'],['M12',null],['M5','Сарыарка']].map(([id,district])=>({id,district}));
const reply=output=>({ok:true,json:async()=>({status:'completed',output})});
test('malformed and inherited IDs are rejected',()=>{
 for(const c of [null,{},[null,null,null,null,null],choices.map(c=>({...c,id:'constructor'}))]) assert.equal(evaluate(c).valid,false);
});
test('every suggested replacement is a valid strict improvement',()=>{
 const before=JSON.stringify(choices), r=evaluate(choices), candidates=swaps(choices);
 assert.ok(candidates.length);
 for(const c of candidates){assert.ok(evaluate(c.choices).valid);assert.ok(c.result.score>r.score);assert.equal(c.delta,c.result.score-r.score);assert.equal(c.choices.filter((x,i)=>JSON.stringify(x)!==JSON.stringify(choices[i])).length,1);}
 assert.equal(JSON.stringify(choices),before);
});
test('agent executes tools and submits computed results',async()=>{
 let count=0;
 const data=await runAgent(choices,{apiKey:'test',model:'test',fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);count++;
  assert.equal(body.store,false);
  if(count===1){assert.equal(body.tool_choice.name,'find_improvements');return reply([{type:'function_call',call_id:'one',name:'find_improvements',arguments:'{}'}]);}
  const tool=body.input.find(x=>x.type==='function_call_output');
  assert.ok(JSON.parse(tool.output)[0].result.valid);
  return reply([{type:'message',content:[{type:'output_text',text:'Проверенное объяснение.'}]}]);
 }});
 assert.equal(count,2);assert.ok(data.recommendations.length);assert.equal(data.text,'Проверенное объяснение.');
});
test('invalid model proposals never become recommendations',async()=>{
 let n=0;
 const data=await runAgent(choices,{apiKey:'x',model:'x',fetchImpl:async()=>++n===1?reply([{type:'function_call',call_id:'bad',name:'evaluate_scenario',arguments:'{"choices":[]}'}]):reply([{type:'message',content:[{type:'output_text',text:'Нет допустимых предложений.'}]}])});
 assert.deepEqual(data.recommendations,[]);
});
test('missing configuration, upstream failure and empty reply are explicit',async()=>{
 await assert.rejects(runAgent(choices,{apiKey:'',model:''}),/OPENAI_API_KEY/);
 await assert.rejects(runAgent(choices,{apiKey:'x',model:'x',fetchImpl:async()=>({ok:false,status:401})}),/401/);
 await assert.rejects(runAgent(choices,{apiKey:'x',model:'x',fetchImpl:async()=>reply([])}),/не вернула/);
});
test('tool loop has a fixed limit',async()=>{
 let count=0;
 await assert.rejects(runAgent(choices,{apiKey:'x',model:'x',fetchImpl:async()=>{count++;return reply([{type:'function_call',call_id:String(count),name:'find_improvements',arguments:'{}'}]);}}),/лимит шагов/);
 assert.equal(count,5);
});
test('HTTP serves only public files and validates inputs before analysis',async(t)=>{
 let calls=0;const server=createServer(async c=>{calls++;return {result:evaluate(c)};});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/')).status,200);
 for(const file of ['/.env','/agent.js','/server.js'])assert.equal((await fetch(base+file)).status,404);
 const post=(body,headers={})=>fetch(base+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
 assert.equal((await post('{')).status,400);
 assert.equal((await post('null')).status,400);
 assert.equal((await post(JSON.stringify({choices:[]}))).status,400);
 assert.equal((await post(JSON.stringify({choices}),{Origin:'https://example.com'})).status,403);
 const response=await post(JSON.stringify({choices,score:999}));
 assert.equal(response.status,200);assert.equal((await response.json()).result.score,evaluate(choices).score);assert.equal(calls,1);
});
