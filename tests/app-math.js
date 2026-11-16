// Run against the bundled engine, including the dynamically loaded offline glyph files.
const assert=(value,message)=>{if (!value) throw Error(message);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,message) {
  for (let i=0;i<180;i++){if(check()) return; await sleep(20);}
  throw Error(message);
}
const docFrom=html=>new DOMParser().parseFromString(html,'text/html');
const equation=String.raw`$$\begin{equation}\mathbb{R}=\mathfrak{g}\label{value}\end{equation}$$`;
const source=String.raw`见 $\eqref{value}$。`+'\n\n'+equation+'\n\n'+String.raw`同式 \ref{value}。目标价$120，估值用$2x+1$。`;
const prefix=String.raw`$$\begin{equation}a=b\end{equation}$$`+'\n\n';
const root=document.createElement('section'),other=document.createElement('section');
document.body.append(root,other);
const editor=SimaEditor.create(root,{text:source});
const second=SimaEditor.create(other,{text:prefix+source});
function reference(host) { return host.querySelector('.sima-tex mjx-container')?.textContent; }
try {
  const exports=await Promise.all([editor.html(),second.html()]);
  for (const [index,html] of exports.entries()) {
    const doc=docFrom(html),n=index+1;
    assert(doc.querySelectorAll('mjx-container').length===4+index && [...doc.querySelectorAll('mjx-container')].every(n=>n.querySelector('svg')),'完整导出公式');
    assert(!doc.querySelector('.sima-math-source,.sima-tex,svg text[data-mjx-error]'),'没有待渲染公式');
    assert(doc.body.textContent.includes('目标价$120，估值用'),'金额和公式分隔');
    const target=doc.getElementById('mjx-eqn:value');
    assert(target && [...doc.querySelectorAll('a')].some(a=>decodeURIComponent(a.getAttribute('href'))==='#mjx-eqn:value'),'引用锚点');
    const eq=target.closest('mjx-container');
    for (const cp of ['211D','1D524']) assert(eq.querySelector('path[data-c="'+cp+'"],g[data-c="'+cp+'"] path'),'离线字形 '+cp);
    assert(eq.textContent.includes('('+n+')'),'文档自身的编号');
    const refs=[...doc.querySelectorAll('mjx-container')].filter(e=>e.querySelector('a'));
    assert(refs[0].textContent==='('+n+')' && refs[1].textContent===String(n),'正反向引用');
    assert(!doc.querySelector('script,link[rel=stylesheet]') && doc.head.textContent.includes('mjx-assistive-mml'),'导出含本地样式');
  }
  await wait(()=>reference(root)==='(1)' && other.querySelector('a[data-math-target]'),'两个标签页预览');
  const id=root.querySelector('a[data-math-target]').dataset.mathTarget;
  assert(root.contains(document.getElementById(id)) && !other.contains(document.getElementById(id)),'当前文档的目标');
  const prior=SimaRender.parse(source).find(b=>b.source.includes('begin{equation}'));
  editor.locate(prior.start+8);
  await wait(()=>root.querySelector('textarea') && reference(root)==='(1)','正在编辑的方程仍参与编号');
  const output=MathJax.startup.constructors.svg.prototype,original=output.typeset;
  let calls=0;
  output.typeset=function(...args){calls++;return original.apply(this,args);};
  try {
    editor.setText(source+' 其他文字。');
    await wait(()=>reference(root)==='(1)','重绘公式');
    assert(calls===0,'普通文字修改复用 SVG');
    editor.setText(prefix+source);
    await wait(()=>root.querySelector('a[data-math-target]')?.closest('mjx-container')?.textContent==='(2)','插入方程后更新编号');
    assert(calls<5,'复用不受编号变化影响的公式');
    editor.setText(source);
    await wait(()=>reference(root)==='(1)','删除方程后恢复编号');
  } finally {output.typeset=original;}
  const tagged=docFrom(await SimaRender.exportHTML(String.raw`见 $\eqref{custom}$。

$$\begin{align}a&=b\notag\\ c&=d\tag{A}\label{custom}\end{align}$$`));
  assert(tagged.querySelector('mjx-container').textContent==='(A)','多行公式、自定义编号和正向引用');
  const table='|值|\n|---|\n|$V_0$|';
  editor.setText(table+'\n\n'+equation);
  await wait(()=>root.querySelector('td .sima-tex svg'),'表格内公式');
  editor.setText('|引用|\n|---|\n|'+String.raw`\eqref{value}`+'|\n\n'+equation);
  await wait(()=>root.querySelector('td a[data-math-target]'),'表格中的公式引用');
  const link=root.querySelector('td a[data-math-target]');
  const destination=document.getElementById(link.dataset.mathTarget);
  let visited=false;
  destination.scrollIntoView=()=>{visited=true;};
  link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  assert(visited,'点击表格引用能跳到本页方程');
  editor.setText('先 $x$，后 $x$。');
  await wait(()=>root.querySelectorAll('.sima-tex svg').length===2,'重复行内公式');
  return {passed:true,mathjax:MathJax.version};
} finally {
  editor.destroy();second.destroy();root.remove();other.remove();
}
