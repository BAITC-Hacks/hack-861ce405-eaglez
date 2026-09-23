'use strict';
const aiPanel=document.createElement('div');
aiPanel.className='panel';
aiPanel.innerHTML='<h2>AI-советник</h2><p>Агент проверяет альтернативы расчётным ядром и объясняет сильные стороны, риски и компромиссы.</p><button id="analyzeAI" class="primary">Проанализировать с ИИ</button><p id="aiStatus" role="status" aria-live="polite"></p><div id="aiText" style="white-space:pre-wrap"></div><div id="aiRecommendations"></div>';
document.querySelector('main').append(aiPanel);
let aiRevision=0, aiController;
const originalRender=render;
render=function(){
 aiRevision++;aiController?.abort();
 originalRender();
 $('analyzeAI').disabled=!calculate(choices).valid;
 $('aiStatus').textContent='';$('aiText').textContent='';$('aiRecommendations').replaceChildren();
};
render();
$('analyzeAI').onclick=async()=>{
 if(location.protocol==='file:'){$('aiStatus').textContent='Для ИИ запустите node --env-file=.env server.js и откройте http://127.0.0.1:3000';return;}
 const revision=aiRevision;
 aiController=new AbortController();
 $('analyzeAI').disabled=true;$('aiStatus').textContent='Агент анализирует сценарий и проверяет замены…';
 $('aiText').textContent='';$('aiRecommendations').replaceChildren();
 try {
  const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({choices}),signal:aiController.signal});
  const data=await response.json();
  if(revision!==aiRevision)return;
  if(!response.ok)throw new Error(data.error||'Ошибка сервера.');
  $('aiStatus').textContent='AI-анализ · '+data.model+' · вызовов инструментов: '+data.trace.length+'. Числа в карточках рассчитаны алгоритмом; текст ИИ может содержать ошибки.';
  $('aiText').textContent=data.text;
  for(const candidate of data.recommendations){
   const card=document.createElement('div');card.className='panel';
   const detail=document.createElement('p');
   detail.textContent=candidate.choices.map(c=>c.id+' ('+(c.district||'Город')+')').join(' · ')+
    '\nScore: '+fmt(candidate.result.score)+' (+'+fmt(candidate.delta)+'), бюджет: '+candidate.result.cost+
    ', критических показателей: '+candidate.result.critical.length;
   const button=document.createElement('button');button.textContent='Применить проверенный вариант';
   button.onclick=()=>{choices.splice(0,choices.length,...candidate.choices.map(c=>({...c})));render();};
   card.append(detail,button);$('aiRecommendations').append(card);
  }
 } catch(error){if(revision===aiRevision && error.name!=='AbortError')$('aiStatus').textContent=error.message+' Шаблонное объяснение остаётся в разделе «Итог».';}
 finally{if(revision===aiRevision)$('analyzeAI').disabled=!calculate(choices).valid;}
};
