'use strict';
const K=['T1','T2','E1','E2','S1','S2','B1','B2','C1','C2'];
const W=[.10,.10,.09,.11,.11,.11,.09,.09,.10,.10];
const districts=[
 {name:'Есиль',pop:.27,v:[45,62,68,72,48,55,78,60,75,70]},
 {name:'Алматы',pop:.24,v:[40,75,50,55,60,65,62,52,50,60]},
 {name:'Сарыарка',pop:.20,v:[50,70,42,40,62,68,58,55,45,55]},
 {name:'Байконур',pop:.13,v:[52,68,55,50,58,60,52,58,55,58]},
 {name:'Нура',pop:.16,v:[55,40,45,65,38,35,55,50,60,50]}
];
const measures=[
 ['M1','Транспорт','Выделенные полосы для автобусов','Район',18,2,{T1:6,T2:9}],
 ['M2','Транспорт','Умные светофоры','Город',22,2,{T1:4,B2:3}],
 ['M3','Транспорт','Линия ЛРТ / расширение','Район',30,4,{T1:16,T2:20,E2:4}],
 ['M4','Экология','Парк / сквер','Район',15,2,{E1:12,E2:3,B1:2}],
 ['M5','Экология','Переход на чистое топливо','Район',25,3,{E2:14,C1:4}],
 ['M6','Экология','Озеленение и ветрозащитные полосы','Город',20,4,{E1:5,E2:3}],
 ['M7','Соцсфера','Школа + детсад','Район',24,3,{S1:16}],
 ['M8','Соцсфера','Центр семейного здоровья','Район',20,3,{S2:14}],
 ['M9','Соцсфера','Дворовые спорт-хабы','Район',10,1,{S1:3,S2:3,B1:3}],
 ['M10','Безопасность','Освещение и камеры','Район',12,1,{B1:12,B2:2}],
 ['M11','Безопасность','Безопасные переходы','Район',10,1,{B2:12,T1:-2}],
 ['M12','Сервисы','Платформа обращений','Город',14,1,{C2:5}],
 ['M13','Сервисы','Модернизация сетей','Район',28,4,{C1:18,E2:2}],
 ['M14','Сервисы','Аварийные бригады ЖКХ','Город',16,1,{C1:5,C2:2}]
].map(([id,category,name,type,cost,lag,effects])=>({id,category,name,type,cost,lag,effects}));
const byId=Object.fromEntries(measures.map(m=>[m.id,m]));
function validate(choices,complete=true){
 const errors=[]; if(!Array.isArray(choices))return ['Ожидался список решений.'];
 if(complete&&choices.length!==5)errors.push('Нужно ровно 5 решений.');
 if(choices.length>5)return ['Нельзя выбрать более 5 решений.'];
 const seen=new Set(),counts={},where={};let cost=0;
 for(const choice of choices){const m=choice && typeof choice.id==='string' && Object.hasOwn(byId,choice.id)?byId[choice.id]:null;if(!m){errors.push('Неизвестное мероприятие.');continue}
  if(seen.has(m.id))errors.push(`${m.id} уже выбрано.`);seen.add(m.id);cost+=m.cost;counts[m.category]=(counts[m.category]||0)+1;
  if(m.type==='Район'&&!districts.some(d=>d.name===choice.district))errors.push(`${m.id}: выберите район.`);
  if(m.type==='Город'&&choice.district!=null)errors.push(`${m.id}: для городской меры район не выбирают.`);
  where[m.id]=choice.district;
 }
 if(cost>100)errors.push(`Бюджет превышен: ${cost} > 100.`);
 for(const [category,n] of Object.entries(counts))if(n>2)errors.push(`Направление «${category}»: более двух мер.`);
 if(seen.has('M1')&&seen.has('M3'))errors.push('M1 и M3 несовместимы.');
 for(const [a,b] of [['M4','M7'],['M5','M13']])if(seen.has(a)&&seen.has(b)&&where[a]===where[b])errors.push(`${a} и ${b} несовместимы в одном районе.`);
 return errors;
}
function calculate(choices){const errors=validate(choices);if(errors.length)return {valid:false,errors};
 return evaluate(choices);
}
// Internal counterfactual evaluator: callers must validate playable scenarios.
function evaluate(choices){
 const values=districts.map(d=>[...d.v]);const contributions=[];
 for(const choice of [...choices].sort((a,b)=>a.id.localeCompare(b.id))){const m=byId[choice.id],targets=m.type==='Город'?districts.map((_,i)=>i):[districts.findIndex(d=>d.name===choice.district)],factor=(8-m.lag)/8;
  for(const d of targets)for(const [key,raw] of Object.entries(m.effects)){const k=K.indexOf(key),delta=raw*factor;values[d][k]+=delta;contributions.push({source:m.id,district:districts[d].name,indicator:key,delta});}
 }
 const ids=new Set(choices.map(c=>c.id));
 for(const [a,b,key,bonus] of [['M1','M2','T1',2],['M10','M12','B1',2],['M5','M6','E2',2]])if(ids.has(a)&&ids.has(b)){
  const d=districts.findIndex(x=>x.name===choices.find(c=>c.id===a).district);values[d][K.indexOf(key)]+=bonus;contributions.push({source:`${a}+${b}`,district:districts[d].name,indicator:key,delta:bonus});
 }
 const rows=values.map((v,i)=>{const indicators=v.map(x=>Math.max(0,Math.min(100,x)));const score=indicators.reduce((s,x,k)=>s+x*W[k],0);return {name:districts[i].name,pop:districts[i].pop,indicators,score,baseline:districts[i].v.reduce((s,x,k)=>s+x*W[k],0)};});
 const average=rows.reduce((s,r)=>s+r.pop*r.score,0),minimum=Math.min(...rows.map(r=>r.score));
 const critical=rows.flatMap(r=>r.indicators.flatMap((x,k)=>x<40?[`${r.name} · ${K[k]} (${x.toFixed(2)})`]:[]));
 const criticalCells=rows.flatMap(r=>r.indicators.flatMap((value,k)=>value<40?[{district:r.name,indicator:K[k],value}]:[]));
 return {valid:true,cost:choices.reduce((s,c)=>s+byId[c.id].cost,0),score:.7*average+.3*minimum-critical.length,average,minimum,critical,criticalCells,rows,contributions};
}
const baseline=(()=>{const rows=districts.map(d=>d.v.reduce((s,x,k)=>s+x*W[k],0));const avg=rows.reduce((s,x,i)=>s+x*districts[i].pop,0);const critical=districts.flatMap(d=>d.v.filter(x=>x<40)).length;return {rows,average:avg,critical,score:.7*avg+.3*Math.min(...rows)-critical}})();
module.exports={K,W,districts,measures,validate,calculate,evaluate,baseline};
