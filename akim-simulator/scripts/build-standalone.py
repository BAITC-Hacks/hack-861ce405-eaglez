"""Build one HTML that opens directly as file:// and needs no server or packages."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]

def bundle_commonjs(source, require_name=None):
    prefix = 'const module={exports:{}};\n'
    if require_name:
        prefix += 'const require = name => {if(name!=="./engine")throw new Error("Unknown module");return CityEngine;};\n'
    return '(function(){\n' + prefix + source + '\nreturn module.exports;\n})()'

engine = bundle_commonjs((root/'src/engine.js').read_text())
analysis = bundle_commonjs((root/'src/analysis.js').read_text(), True)
presets = bundle_commonjs((root/'src/presets.js').read_text())
script = '''const CityEngine=__ENGINE__;
const CityAnalysis=__ANALYSIS__;
const CityPresets=__PRESETS__;
const localApi = async (route, body) => {
  if(route === '/api/config') return {
    indicators:CityEngine.K.map((id,i)=>({id,name:CityAnalysis.names[i],weight:CityEngine.W[i]})),
    districts:CityEngine.districts, measures:CityEngine.measures,
    baseline:{...CityEngine.baseline,details:CityEngine.evaluate([])},
    ai:{provider:'offline',configured:false,model:null},presets:CityPresets
  };
  const complete=route !== '/api/validate';
  const errors=CityEngine.validate(body?.choices,complete);
  if(errors.length)throw new Error(errors.join(' '));
  if(!complete)return {valid:true};
  const result=CityAnalysis.analyze(body.choices);
  if(route === '/api/analyze')return result;
  if(route === '/api/explain' || route === '/api/ask'){
    const question = route === '/api/ask' && typeof body?.question === 'string' ? body.question.trim() : '';
    if(route === '/api/ask' && (question.length < 3 || question.length > 240))throw new Error('Вопрос должен содержать от 3 до 240 символов.');
    const facts=result.facts;
    const selected=CityAnalysis.relevantFacts(result,question);
    return {mode:'offline',reason:'offline',summary:facts.summary,
      strengths:selected.strengths.map(x=>x.text),
      risks:selected.risks.map(x=>x.text),
      recommendation:facts.recommendations[0]||null};
  }
  throw new Error('Неизвестный адрес.');
};
'''.replace('__ENGINE__',engine).replace('__ANALYSIS__',analysis).replace('__PRESETS__',presets)
app = (root/'public/app.js').read_text()
start = app.index('async function api(route, data) {')
end = app.index('function readStored()',start)
app = app[:start]+'const api=localApi;\n'+app[end:]
html = (root/'public/index.html').read_text()
html = re.sub(r'<link rel="stylesheet" href="/styles.css">', '<style>\n'+(root/'public/styles.css').read_text()+'\n</style>', html, count=1)
html = html.replace('<script src="/app.js" defer></script>','')
html = html.replace('</body>', '<script>\n'+script+'\n'+app+'\n</script>\n</body>')
out = root/'dist/akim-standalone.html'
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(html)
print(f'Created {out} ({out.stat().st_size} bytes)')
