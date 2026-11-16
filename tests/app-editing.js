// Executed by the native app in its real WKWebView, against SIMAQ_TEST_ROOT.
// All input/composition/paste events below are synthetic, not system IME evidence.
const checks = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ok = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
const wait = async (fn, message) => {
  for (let i = 0; i < 180; i++) { if (fn()) return; await sleep(30); }
  throw Error(message);
};
const normalize = text => text.replace(/\r\n|\r/g, '\n');
const fixturePath = '__编辑验收_' + Date.now() + '.md';
// Mixed line endings make the original hash a check of disk bytes, not only text.
const raw = '---\r\ntitle: "编辑验收"\nflag: true\r\n---\n\n' +
  '<!-- 前部守卫：保留两个空格  -->\r\n\r\n' +
  '# 临时交互验收\n\n研究片段，正文输入位置。\r\n\n' +
  '| 名称 | 数量 | 备注 |\r\n| :--- | ---: | :---: |\n' +
  '| 甲 | 10 | 原样 A |\r\n| 乙 | 20 | 原样 B |\n' +
  '| 丙 | 30 | 保留\\|竖线与 `代码` |\r\n\n' +
  '```text\r\n| 围栏里的文本 | 不应变成表格 |\n```\r\n\n' +
  '末尾守卫：空格  与表情 😀。\r\n';
await rpc('newFile', { path: fixturePath, text: raw });
const initial = await rpc('read', { path: fixturePath });
ok(initial.version === 'a38e825031234b0096c96fc6421c49318c698d0cd3f49587de53fcd47256ce53',
  '样本创建后 UTF-8 与混合换行原始字节正确');
let editor;
// Capture the actual public editor instance created by the shell; no editor mock.
const create = window.SimaEditor.create;
window.SimaEditor.create = function(host, options) {
  const instance = create.call(this, host, options);
  if (options.path === fixturePath) editor = instance;
  return instance;
};
try { await SimaShell.event('openPath', { path: fixturePath, newTab: true }); }
finally { window.SimaEditor.create = create; }
await wait(() => editor && document.querySelector('.tab[aria-selected="true"]')?.title === fixturePath,
  '临时编辑样本未进入真实编辑器');
const host = () => [...document.querySelectorAll('#hosts .doc-host')].find(node => !node.hidden);
ok(editor.getText() === normalize(raw), '真实编辑器读取混合换行样本');
await SimaShell.run('file.save');
ok((await rpc('read', { path: fixturePath })).version === initial.version, '未编辑保存保留原始文件字节');

// The pointer can leave the handle while staying inside the full-width YAML block.
const yamlHandle = host().querySelector('.sima-yaml-toggle');
const yamlPreview = host().querySelector('.md-meta-block');
const initiallyCollapsed = editor.getState().yamlCollapsed;
if (!initiallyCollapsed) yamlHandle.click();
function leaveYamlHandle() {
  yamlHandle.dispatchEvent(new MouseEvent('mouseleave', {relatedTarget:yamlHandle.parentElement}));
}
yamlHandle.dispatchEvent(new MouseEvent('mouseenter'));
ok(!yamlPreview.hidden, '悬停细线显示 YAML');
leaveYamlHandle();
ok(yamlPreview.hidden && yamlHandle.getAttribute('aria-expanded') === 'false', '指针移到同一行的空白处即收起预览');
yamlHandle.dispatchEvent(new MouseEvent('mouseenter'));
yamlHandle.click();
leaveYamlHandle();
ok(!yamlPreview.hidden && !editor.getState().yamlCollapsed, '点击固定后移出细线仍显示 YAML');
if (initiallyCollapsed) yamlHandle.click();

const typingAt = editor.getText().indexOf('正文输入位置');
editor.locate(typingAt, 0);
editor.focus();
await wait(() => host()?.querySelector('.sima-block-input'), '正文活动块 textarea 未出现');
let input = host().querySelector('.sima-block-input');
const composingStart = input.selectionStart;
input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
input.setRangeText('zhongwen', input.selectionStart, input.selectionEnd, 'end');
input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'zhongwen' }));
input.dispatchEvent(new InputEvent('input', {
  bubbles: true, inputType: 'insertCompositionText', data: 'zhongwen', isComposing: true,
}));
const yamlBefore = editor.getState().yamlCollapsed;
await SimaShell.run('theme.dark');
await SimaShell.run('view.yaml');
ok(input.isConnected && host().contains(input), '合成输入期间切主题与 YAML 保留活动输入节点');
input.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true,
}));
input.setRangeText('中文', composingStart, composingStart + 'zhongwen'.length, 'end');
input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '中文' }));
input.dispatchEvent(new InputEvent('input', {
  bubbles: true, inputType: 'insertCompositionText', data: '中文', isComposing: true,
}));
input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromComposition', data: '中文' }));
const composed = initial.text.slice(0, typingAt) + '中文' + initial.text.slice(typingAt);
await wait(() => editor.getText() === composed, '中文合成提交丢失、重复或改变了段落');
await wait(() => editor.getState().yamlCollapsed !== yamlBefore, '合成完成后 YAML 操作未生效');
ok(true, '中文合成提交一次，主题与 YAML 操作未改变正文');
await SimaShell.run('file.save');
ok((await rpc('read', { path: fixturePath })).text === composed, '合成提交通过真实保存链路写回');
await SimaShell.run('edit.undo');
ok(editor.getText() === initial.text, '一次撤销还原整次中文合成');
await SimaShell.run('file.save');
ok((await rpc('read', { path: fixturePath })).version === initial.version, '撤销合成后保存恢复初始字节');

await SimaShell.run('view.source');
await wait(() => host()?.querySelector('.sima-source-input'), '源码 textarea 未出现');
input = host().querySelector('.sima-source-input');
ok(input.value === initial.text, '切源码保留全文与管道表格');
const sourceStart = input.value.indexOf('末尾守卫');
input.setSelectionRange(sourceStart, sourceStart + '末尾守卫'.length);
input.setRangeText('末尾已校验', input.selectionStart, input.selectionEnd, 'end');
input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '末尾已校验' }));
const sourceEdited = initial.text.replace('末尾守卫', '末尾已校验');
await wait(() => editor.getText() === sourceEdited, '源码输入未更新文档');
await SimaShell.run('view.source');
await wait(() => !host()?.querySelector('.sima-source-input'), '未退出源码模式');
ok(editor.getText() === sourceEdited && !!host().querySelector('table'), '源码编辑返回可视模式并保留表格');
await SimaShell.run('file.save');
ok((await rpc('read', { path: fixturePath })).text === sourceEdited, '源码编辑通过真实保存链路写回');
await SimaShell.run('edit.undo');
await SimaShell.run('file.save');
ok(editor.getText() === initial.text && (await rpc('read', { path: fixturePath })).version === initial.version,
  '源码编辑一次撤销后恢复原始字节');

const selected = '研究片段';
editor.locate(initial.text.indexOf(selected), selected.length);
const linkTask = SimaShell.run('edit.link');
await wait(() => document.querySelector('[role="dialog"][aria-label="插入文档链接"]'), '插入链接对话框未打开');
const dialog = document.querySelector('[role="dialog"][aria-label="插入文档链接"]');
ok(dialog.querySelector('[name="label"]').value === selected, '链接对话框保留编辑器已选文字');
dialog.querySelector('[name="label"]').value = '财务附注';
dialog.querySelector('[name="fragment"]').value = '业务';
const query = dialog.querySelector('[name="query"]');
query.value = '公司/富瀚微.md';
query.dispatchEvent(new Event('input', { bubbles: true }));
await wait(() => dialog.querySelectorAll('.dialog-list button').length === 1, '链接文件筛选未定位唯一公司文档');
dialog.querySelector('.dialog-list button').click();
await linkTask;
const linked = initial.text.replace(selected, '[财务附注](公司/富瀚微.md#%E4%B8%9A%E5%8A%A1)');
ok(editor.getText() === linked, '文件选择对话框将文字替换成含标题锚点的相对链接');
await SimaShell.run('file.save');
ok((await rpc('read', { path: fixturePath })).text === linked, '链接选择结果通过真实保存链路写回');
await SimaShell.run('edit.undo');
await SimaShell.run('file.save');
ok(editor.getText() === initial.text && (await rpc('read', { path: fixturePath })).version === initial.version,
  '链接插入一次撤销后恢复原始字节');

const cell = (row, column) => host().querySelector(
  '.sima-table-block [data-row="' + row + '"][data-column="' + column + '"]',
);
await wait(() => cell(1, 0) && cell(2, 1), '可视表格单元格未出现');
ok(host().querySelectorAll('.sima-table-block').length === 1, '代码围栏内的管道文本不生成编辑表格');
const columnWidths = () => [0, 1, 2].map(column => cell(0, column).getBoundingClientRect().width);
const readingWidths = columnWidths();
ok(readingWidths[2] > readingWidths[0] && readingWidths[2] > readingWidths[1],
  '备注按正文内容取得比名称、数量更宽的列');
cell(3, 2).focus();
ok(columnWidths().every((width, i) => Math.abs(width - readingWidths[i]) <= 1),
  '编辑最长的单元格时保留内容列宽');
cell(1, 0).dispatchEvent(new PointerEvent('pointerdown', {
  bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
}));
cell(2, 1).dispatchEvent(new PointerEvent('pointerdown', {
  bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, shiftKey: true,
}));
const transfer = new DataTransfer();
transfer.setData('text/plain', '新甲\t101\n新乙\t202');
const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
cell(2, 1).dispatchEvent(paste);
const tableEdited = initial.text.replace('| 甲 | 10 |', '| 新甲 | 101 |')
  .replace('| 乙 | 20 |', '| 新乙 | 202 |');
await wait(() => editor.getText() === tableEdited, '矩形选区 TSV 粘贴未准确覆盖目标四格');
ok(paste.defaultPrevented, '矩形粘贴由表格编辑器接管');
ok(editor.getText().includes('| 丙 | 30 | 保留\\|竖线与 `代码` |'),
  '矩形粘贴保留未编辑行、转义竖线与行内代码');
await SimaShell.run('file.save');
const savedTable = await rpc('read', { path: fixturePath });
ok(savedTable.text === tableEdited, '矩形粘贴通过真实保存链路写回四格');
// Independently computed from raw with precisely the four cell values replaced.
ok(savedTable.version === '87f4e92308051d5dcf4b2ed5145e524ca4cc104c73e3184a9f526ad35676adc8',
  '矩形粘贴仅改四格字节，保留外部正文、表格空白和混合换行');
await SimaShell.run('edit.undo');
ok(editor.getText() === initial.text, '一次撤销完整还原矩形粘贴');
await SimaShell.run('file.save');
ok((await rpc('read', { path: fixturePath })).version === initial.version,
  '矩形粘贴撤销后恢复整份文件原始字节');

// A hit in frontmatter remains selected while reading further down the document.
const searchText = '---\nid: physical-ai-report\n---\n\n' +
  Array.from({length:140}, (_,i) => '第 ' + i + ' 段：physical ai 研究。').join('\n\n');
editor.setText(searchText);
const hit = {start:searchText.indexOf('physical-ai'),length:11};
editor.showSearchResult([hit],hit);
const viewport = host().querySelector('.sima-editor');
viewport.scrollTop = Math.round(viewport.scrollHeight/2);
await sleep(45);
const scrollBefore = viewport.scrollTop;
const thumb = viewport.querySelector('.sima-scroll-layer > div');
const thumbRect = thumb.getBoundingClientRect();
ok(getComputedStyle(thumb).visibility === 'visible' && thumbRect.height >= 30 &&
  document.elementFromPoint(thumbRect.left + thumbRect.width / 2, thumbRect.top + thumbRect.height / 2) === thumb,
  '正文滚动时滑块在可见区域显示并能接收拖动');
await wait(() => getComputedStyle(thumb).visibility === 'hidden', '滚动停止后滑块未隐藏');
const paragraph = [...viewport.querySelectorAll('.sima-block p')].find(p => {
  const rect=p.getBoundingClientRect(), top=viewport.getBoundingClientRect().top;
  return rect.top>top+10 && rect.bottom<top+viewport.clientHeight;
});
const rect = paragraph.getBoundingClientRect();
for (const type of ['mousedown','mouseup','click']) {
  const event = new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:rect.right-2,clientY:rect.top+8});
  paragraph.dispatchEvent(event);
  if (type==='mousedown') ok(event.defaultPrevented,'搜索结果段落行尾的空白不接管编辑焦点');
}
await sleep(45);
const stateAfter = editor.getState();
ok(scrollBefore>0 && stateAfter.scrollTop===scrollBefore &&
  stateAfter.selection.anchor===hit.start && stateAfter.selection.head===hit.start+hit.length,
  '中段点击空白后保留滚动位置和原搜索命中');
const list = '- **关键数字。** [SEC 招股书](https://example.com/sec)\n- **既有判断。** 物理 AI 行业研究';
editor.setText(list);
const listHit = {start:list.indexOf('物理 AI'),length:5};
editor.showSearchResult([listHit],listHit);
const match = host().querySelector('li mark.md-search-select');
const sec = host().querySelector('li a');
ok(match?.textContent==='物理 AI' && sec?.textContent==='SEC 招股书' &&
  sec.getAttribute('href')==='https://example.com/sec' && !!host().querySelector('li strong'),
  '搜索命中列表时保留链接、粗体和列表渲染');
editor.setState(editor.getState());
ok(!!host().querySelector('li a') && !host().querySelector('.sima-block-input'),
  '恢复搜索阅读位置时链接仍可点击');
const outlineBody = '阅读段落。\n\n'.repeat(60);
editor.setText('# 第一节\n\n'+outlineBody+'## 第二节\n\n'+outlineBody);
const outlineList=document.querySelector('#outlineList');
await wait(()=>outlineList.children.length===2,'右栏大纲未更新');
const nextHeading=host().querySelector('h2');
const atCenter=()=>nextHeading.getBoundingClientRect().top-viewport.getBoundingClientRect().top-viewport.clientHeight/2;
const currentSection=()=>outlineList.querySelector('[aria-current="location"]')?.textContent;
viewport.scrollTop+=atCenter()-10;
await wait(()=>currentSection()==='第一节','标题还在中线下方时应保留上一节');
viewport.scrollTop+=atCenter()+10;
await wait(()=>currentSection()==='第二节','标题经过中线时应切换到下一节');
ok(!document.querySelector('#sidebar [data-mode="outline"]') &&
  outlineList.getBoundingClientRect().left>=viewport.getBoundingClientRect().right-1,
  '大纲位于正文右侧，左栏保留目录和搜索');
outlineList.children[1].click();
const jumpInset = Math.min(parseFloat(getComputedStyle(host().querySelector('.sima-document')).lineHeight)*2.5,viewport.clientHeight*0.22);
await wait(()=>Math.abs(nextHeading.getBoundingClientRect().top-viewport.getBoundingClientRect().top-jumpInset)<2,
  '点击大纲后标题上方留出约两到三行');
editor.setText('# 首节\n\n'+outlineBody+'## 末节');
await wait(()=>outlineList.lastChild?.textContent==='末节','末节大纲未更新');
outlineList.lastChild.click();
await wait(()=>Math.abs(host().querySelector('h2').getBoundingClientRect().top-viewport.getBoundingClientRect().top-jumpInset)<2,
  '文末标题也能定位到正文上部');
const imageRef='![图](images/a b.png)';
editor.setText(imageRef+' '+imageRef+'{width=240}');
const realRpc=window.rpc;
let additions, imageTransfer;
window.rpc=(method,args)=>{
  if (method==='prepareImageMenu') { additions=args; return Promise.resolve(true); }
  if (method==='exportImage' || method==='copyImage') { imageTransfer={method,...args}; return Promise.resolve(true); }
  return realRpc(method,args);
};
async function chooseImageAction(label) {
  additions=null;
  const image=host().querySelectorAll('.sima-sized-image img')[1];
  const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});
  image.dispatchEvent(event);
  ok(!event.defaultPrevented,'保留 WebKit 图片菜单');
  await wait(()=>additions,'缺少图片菜单扩展');
  const index=additions.items.findIndex(item=>item.title===SimaSettings.menuText(label));
  ok(index>=0,'图片菜单提供 '+label);
  await SimaShell.event('imageMenuAction',{token:additions.token,index});
}
try {
  for (const [label,align] of [['图片居中','center'],['图片居右','right'],['图片居左','left']]) {
    await chooseImageAction(label);
    await wait(()=>editor.getText()===imageRef+' '+imageRef+'{width=240}{align='+align+'}',
      '对齐所点图片并保留宽度');
  }
  for (const [label,method] of [['复制图片','copyImage'],['导出图片…','exportImage']]) {
    await chooseImageAction(label);
    await wait(()=>imageTransfer?.method===method && imageTransfer.url.includes('images/a%20b.png'),
      '操作使用原图地址');
  }
} finally {window.rpc=realRpc;}
editor.setText(initial.text);

return {
  checks,
  fixture: fixturePath,
  compositionEvents: { environment: 'real WKWebView', events: 'synthetic', passed: true },
  systemIME: { status: 'not-run', reason: '未观察系统中文输入源候选窗；合成事件不计作系统输入法实测' },
};
