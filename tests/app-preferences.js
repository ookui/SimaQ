// This phase runs in a disposable workspace inside the shipping WKWebView.
const checks = [];
function check(value, label) { if (!value) throw Error(label); checks.push(label); }
async function waitFor(test) {
  for (let i=0; i<150; i++) {
    if (test()) return;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw Error('等待图片或工作区界面超时');
}
const note = '公司/公式图片.md', name = '走势 图.png';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
await rpc('asset',{path:note, filename:name, folder:'公式图片.assets',data:image});
await rpc('newFile',{path:note,text:'# 公式图片\n\n' + String.raw`公式 $E=mc^2$ 和 \(\alpha+\beta\)。
$$\frac{1}{2}$$
\[
\begin{pmatrix}a&b\\c&d\end{pmatrix}
\]

![走势](走势%20图.png)`});
await SimaShell.event('openPath',{path:note,newTab:true});
await SimaSettings.execute('theme.tana');
const title = document.querySelector('#write h1');
check(title && getComputedStyle(title,'::after').backgroundImage.includes('radial-gradient'),'Tana 首个一级标题的渐变已应用');
check(getComputedStyle(document.querySelector('#write')).fontFamily.includes('Tana PingFang'),'Tana 中文字体已应用');
const formulas=document.querySelectorAll('#write mjx-container[jax="SVG"]');
check(formulas.length===4 && !document.querySelector('#write [data-mml-node="merror"]'),'两种行内及两种独立公式离线渲染，含分式与矩阵');
await SimaSettings.execute('file.images');
const field=document.querySelector('[aria-label="图片子目录"]');
field.value='${filename}.assets';
[...document.querySelectorAll('button')].find(b=>b.textContent==='保存图片设置').click();
const img=document.querySelector('#write img');
await waitFor(()=>img.naturalWidth===1);
check((await rpc('getPrefs')).attachmentFolder===field.value,'图片目录已持久保存，已打开笔记按文件名子目录读图');
const rendered=SimaRender.exportHTML((await rpc('read',{path:note})).text,{path:note});
check(rendered.includes('fallback=') && rendered.includes('mjx-container'),'导出包含相同图片定位和公式图形');
SimaSettings.close();
await rpc('newFolder',{path:'_Meta'});
await rpc('newFile',{path:'_Meta/隐藏.md',text:'独有检索词'});
await rpc('rebuildIndex'); await rpc('indexReady');
check(!(await rpc('tree')).some(n=>n.path==='_Meta') && !(await rpc('search',{q:'独有检索词'})).length,'默认排除目录在文件树与索引中均不可见');
await SimaSettings.execute('file.exclusions');
await waitFor(()=>!!document.querySelector('.sq-excluded button'));
document.querySelector('.sq-excluded button').click();
await waitFor(()=>document.querySelector('.sq-excluded')?.textContent.includes('没有排除'));
await rpc('indexReady');
check((await rpc('tree')).some(n=>n.path==='_Meta') && (await rpc('search',{q:'独有检索词'})).length===1,'取消排除后文件树和检索同步恢复');
SimaSettings.close();
await SimaSettings.execute('app.settings');
const originalLanguage=SimaSettings.settings.menuLanguage;
for (const [language,label] of [['en','Save'],['zh-Hans','保存'],['zh-Hant','儲存']]) {
  const picker=document.querySelector('[data-language-picker]');
  picker.value=language;
  picker.dispatchEvent(new Event('change',{bubbles:true}));
  await waitFor(()=>!picker.isConnected);
  const save=SimaSettings.commands.find(c=>c.id==='file.save');
  check(save.label===label && SimaSettings.binding(save.id)==='Cmd+S','菜单即时切换 '+language+'，保留存储快捷键');
  check((await rpc('getPrefs')).menuLanguage===language,'保存菜单语言 '+language);
}
const picker=document.querySelector('[data-language-picker]');
picker.value=originalLanguage;
picker.dispatchEvent(new Event('change',{bubbles:true}));
await waitFor(()=>!picker.isConnected);
SimaSettings.close();
const journalPath = '公司';
const chooseJournal = SimaSettings.execute('file.journalFolder');
await waitFor(()=>!!document.querySelector('.sq-dialog input[name=query]'));
const query = document.querySelector('.sq-dialog input[name=query]');
query.value = journalPath;
query.dispatchEvent(new Event('input'));
document.querySelector('.sq-dialog [data-answer=ok]').click();
await chooseJournal;
check((await rpc('bootstrap')).journalFolder === journalPath && !document.querySelector('#todayButton').hidden,'通过文件菜单设置日记目录并立即显示日历入口');
document.querySelector('#todayButton').click();
await waitFor(()=>!!document.querySelector('.journal-entry'));
check(document.querySelector('.journal-list').textContent.includes('富瀚微'),'日历读取所选目录中的既有笔记');
return {checks};
