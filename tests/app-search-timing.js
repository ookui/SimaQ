// Real WKWebView benchmark; run only in test-app.sh's disposable workspace.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const wait=async(fn,label)=>{const t=performance.now();while(!fn()){if(performance.now()-t>120000)throw Error(label);await sleep(3);}};
const dist=values=>{const v=[...values].sort((a,b)=>a-b),q=p=>Math.round(v[Math.ceil(v.length*p)-1]*10)/10;return {n:v.length,minMs:q(1/v.length),p50Ms:q(.5),p95Ms:q(.95),maxMs:q(1),samplesMs:values.map(x=>Math.round(x*10)/10)};};
const nativeRPC=window.rpc, records=[];
window.rpc=async(method,args={})=>{const r=method==='search'?{q:args.q,done:false}:null;if(r)records.push(r);const value=await nativeRPC(method,args);if(r)r.done=true;return value;};
const boot=await rpc('bootstrap');let ready=!!boot.indexReadyAt;const pending=rpc('indexReady').then(()=>ready=true);
const inputDuringBuild={scope:'synthetic composition in real textarea; OS IME candidate window untested',startedBeforeReady:!ready};
const probe=document.createElement('div');probe.style.cssText='position:fixed;right:10px;bottom:10px;width:380px;height:120px;z-index:99999';document.body.append(probe);
const editor=SimaEditor.create(probe,{text:'索引期间中文输入：',path:'__performance_probe.md'});editor.action('view.source');editor.focus();
const field=probe.querySelector('textarea');if(!field)throw Error('native textarea not found');
field.setSelectionRange(field.value.length,field.value.length);field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
const inputTimes=[];
for(const text of ['中','中文','中文输入','中文输入完成']){const t=performance.now();field.value='索引期间中文输入：'+text;field.setSelectionRange(field.value.length,field.value.length);field.dispatchEvent(new InputEvent('input',{bubbles:true,data:text,inputType:'insertCompositionText',isComposing:true}));await frames();inputTimes.push(performance.now()-t);}
field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文输入完成'}));await frames();
inputDuringBuild.textRetained=editor.getText()==='索引期间中文输入：中文输入完成';inputDuringBuild.endedBeforeReady=!ready;inputDuringBuild.latency=dist(inputTimes);editor.destroy();probe.remove();
if(!inputDuringBuild.textRetained)throw Error('composition text lost');
await pending;const indexedBoot=await rpc('bootstrap');await SimaShell.run('search.workspace');
const type=q=>{const e=document.getElementById('queryInput');e.value=q;e.dispatchEvent(new Event('input',{bubbles:true}));};
async function measure(q){type('');await frames();const n=records.length,t=performance.now();type(q);await wait(()=>records.slice(n).some(r=>r.q===q&&r.done),'query timeout '+q);await frames();if(!document.querySelector('.hit-row'))throw Error('no rendered hits '+q);return performance.now()-t;}
const firstQueryMs=await measure('physical ai'),queries={};
for(const q of ['physical ai','moderate marker','wide marker','广泛样本','quarterly revenue']){await measure(q);const values=[];for(let i=0;i<20;i++)values.push(await measure(q));queries[q]=dist(values);}
const unique='增量验证标记'+Date.now(),note=await rpc('read',{path:'note-1.md'}),t=performance.now();
await rpc('save',{path:'note-1.md',version:note.version,text:note.text+'\n'+unique+'\n'});
let attempts=0,found=false;while(performance.now()-t<30000){attempts++;const rows=await rpc('search',{q:unique});if((Array.isArray(rows)?rows:rows.groups||[]).length){found=true;break;}await sleep(20);}
if(!found)throw Error('incremental index timeout');const saveToSearchableMs=performance.now()-t,incrementalPaintMs=await measure(unique);window.rpc=nativeRPC;
return {scope:'input event → debounce → bridge → native search → DOM → two animation frames (paint proxy)',corpus:{markdown:10000,approxBytes:208000000,html:0,pdf:0},initialIndexMs:indexedBoot.indexReadyAt-indexedBoot.indexStartedAt,firstQueryMs:Math.round(firstQueryMs),queries,inputDuringBuild,incremental:{saveToSearchableMs:Math.round(saveToSearchableMs),inputToPaintMs:Math.round(incrementalPaintMs),attempts},searchesRecorded:records.length};
