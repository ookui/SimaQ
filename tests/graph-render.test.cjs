const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Capture draw commands from the production canvas renderer with a controlled animation clock.
function graphFrame(nodes, edges = []) {
  let nextFrame, resizeCallback, resets = 0;
  const labels = new Map(), dots = [];
  const context = {
    clearRect() { labels.clear(); dots.length = 0; },
    arc(x,y,r) { dots.push({x,y,r}); },
    fillText(title,x,y) { labels.set(title,{x,y}); },
    measureText(title) { return {width:title.length*7}; },
    fill() {}, stroke() {}, beginPath() {}, moveTo() {}, lineTo() {}, setTransform() {}
  };
  const canvas = {
    style:{}, getContext:()=>context, setPointerCapture(){}, addEventListener(){},
    getBoundingClientRect:()=>({left:0,top:0,width:900,height:640}),
    set width(value) { this.pixelWidth=value; resets++; }, get width(){return this.pixelWidth;},
    set height(value) { this.pixelHeight=value; resets++; }, get height(){return this.pixelHeight;}
  };
  const parts = new Map([['canvas',canvas],['.graph-tip',{style:{},firstElementChild:{},lastElementChild:{}}]]);
  const panel = {querySelector(key){if(!parts.has(key))parts.set(key,{});return parts.get(key);}};
  const env = vm.createContext({
    window:{}, document:{addEventListener(){},removeEventListener(){}},performance,
    ResizeObserver:class {constructor(cb){resizeCallback=cb;}observe(){}disconnect(){}},
    getComputedStyle:()=>({fontFamily:'sans-serif',color:'#222',borderTopColor:'#368',outlineColor:'#aaa'}),
    requestAnimationFrame:cb=>{nextFrame=cb;return 1;},cancelAnimationFrame:()=>{nextFrame=null;}
  });
  for (const name of ['graph-layout.js','graph.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../Web',name),'utf8'),env);
  }
  const view=env.window.SimaGraph.mount(panel,{tr:s=>s,colorFor:()=>null});
  view.update({nodes,edges});
  function frame() {const cb=nextFrame;nextFrame=null;cb?.();}
  while(nextFrame)frame();
  function pointer(action,x,y) {canvas['onpointer'+action]({button:0,pointerId:1,clientX:x,clientY:y});}
  return {frame,pointer,labels,dots,resize:resizeCallback,resets:()=>resets,layout:env.SimaGraphLayout};
}
const notes=Array.from({length:360},(_,i)=>({path:i+'.md',title:String(i).padStart(3,'0')+' Document with a long title'}));
test('panning translates central labels without switching them on and off',()=>{
  const branches=notes.slice(1,55).map((_,i)=>[i+1,Math.floor(i/2)]);
  const ui=graphFrame(notes,branches);
  const center=()=>[...ui.labels].filter(([,p])=>p.x>180 && p.x<720 && p.y>130 && p.y<510);
  const initial=center();
  assert.ok(initial.length>10);
  ui.pointer('down',1,1);
  for(let dx=4;dx<=16;dx++){
    ui.pointer('move',1+dx,1);ui.frame();
    for(const [title,p] of initial){
      const now=ui.labels.get(title);
      assert.ok(now,title+' disappeared on pan '+dx);
      assert.ok(Math.abs(now.x-p.x-dx)<.001);
    }
  }
});
test('an unchanged resize notification leaves the canvas bitmap intact',()=>{
  const ui=graphFrame(notes.slice(0,3));
  const before=ui.resets();ui.resize();ui.frame();
  assert.equal(ui.resets(),before);
});

test('a heavily linked index stays legible alongside leaf notes and peripheral islands',()=>{
  const fan=320;
  const nodes=Array.from({length:520},(_,i)=>({path:i+'.md',title:String(i).padStart(3,'0')+' 资料登记与研究记录'}));
  const edges=Array.from({length:fan},(_,i)=>[i+1,0]);
  for (let i=321;i<341;i+=2) edges.push([i,i+1]);
  const {dots,labels,layout}=graphFrame(nodes,edges);
  assert.equal(dots.length,nodes.length);
  assert.ok(dots[0].r>dots[1].r && dots[1].r>dots.at(-1).r);
  assert.ok((dots[0].r/dots.at(-1).r)**2<=6);
  assert.ok(dots[1].r>=2 && dots.at(-1).r>=2);
  const graph=layout.layout({nodes,edges}), simulation=layout.solver(graph);
  while(simulation.step()){}
  const distance=n=>Math.hypot(n.x,n.y);
  const core=Math.max(...graph.nodes.slice(0,fan+1).map(distance));
  const rim=graph.nodes.slice(fan+1);
  assert.ok(rim.every(n=>distance(n)>core));
  const angles=new Set(rim.map(n=>Math.floor((Math.atan2(n.y,n.x)+Math.PI)*8/Math.PI)));
  assert.ok(angles.size>=16);
  const rows=[...labels];
  assert.ok(rows.length>20);
  for(let i=0;i<rows.length;i++) for(let j=0;j<i;j++){
    const [a,p]=rows[i],[b,q]=rows[j];
    assert.ok(Math.abs(p.y-q.y)>=10 || Math.abs(p.x-q.x)>=(a.length+b.length)*3.5,
      'overlapping captions: '+a+' and '+b);
  }
});
