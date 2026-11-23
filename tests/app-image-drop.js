// Exercise the Markdown tab, including the local WKURLSchemeHandler.
const checks = [];
function check(value, message) { if (!value) throw Error(message); checks.push(message); }
async function waitFor(predicate, message) {
  for (let i = 0; i < 160; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  throw Error(message);
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320"><rect width="720" height="320" fill="teal"/></svg>';
const canvas = document.createElement('canvas');
canvas.width = 100; canvas.height = 60;
const png = canvas.toDataURL().split(',')[1];
const dropNote = '专题/2026-11-23.md';
const original = '第一段原文。\n\n第二段原文。';
await rpc('newFile',{path:dropNote,text:original});
await SimaShell.event('openPath',{path:dropNote,newTab:true});
const dropHost = document.querySelector('#hosts .doc-host:not([hidden])');
const paragraph = dropHost.querySelectorAll('.sima-block p')[1];
function pointInText(node,offset) {
  const range = document.createRange();
  range.setStart(node,offset);
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  return {clientX:rect.left+.1,clientY:rect.top+rect.height/2};
}
function dropFiles(target,point,files) {
  const transfer = new DataTransfer();
  transfer.setData('text/plain','/original/Finder/path');
  for (const file of files) transfer.items.add(file);
  for (const type of ['dragover','drop']) {
    const event = new DragEvent(type,{dataTransfer:transfer,bubbles:true,cancelable:true,...point});
    target.dispatchEvent(event);
    check(event.defaultPrevented,'接管文件 ' + type);
  }
}
const sameName = '原图 [1] (#).svg';
const pngBytes = Uint8Array.from(atob(png),c=>c.charCodeAt(0));
const imports = [new File([svg],sameName,{type:'image/svg+xml'}),new File([pngBytes],'AI药物研发价值链图.png'),
                 new File([svg],sameName,{type:'application/octet-stream'})];
dropFiles(paragraph,pointInText(paragraph.firstChild,2),imports);
await waitFor(()=>dropHost.querySelectorAll('img[data-markdown-src]').length===3,'多图未在落点显示');
const imported = [...dropHost.querySelectorAll('img[data-markdown-src]')];
await waitFor(()=>imported.every(img=>img.complete && img.naturalWidth>0),'附件未解码');
check(imported[0].src!==imported[2].src,'同名文件独立保存');
for (const i of [0,2]) {
  const path = decodeURIComponent(new URL(imported[i].src).pathname.slice(1));
  check((await rpc('read',{path})).text===svg,'SVG 原始文本保存 '+i);
}
check(imported[1].naturalWidth===100 && imported[1].naturalHeight===60,'PNG 原始尺寸正确');
await SimaShell.run('file.save');
const saved = (await rpc('read',{path:dropNote})).text;
check(saved.startsWith('第一段原文。\n\n第二![') && saved.endsWith('段原文。') &&
  !saved.includes('/original/') && saved.includes(']('+SimaSettings.imageFolder(dropNote)+'/'),'在第二段落点插入相对附件引用');
await SimaShell.run('edit.undo');
await SimaShell.run('file.save');
check((await rpc('read',{path:dropNote})).text===original,'一次撤销整组拖入');
const editField = dropHost.querySelector('textarea.sima-block-input');
const textMirror = editField.parentNode.querySelector('.sima-text-mirror');
editField.setSelectionRange(0,0);
dropFiles(editField,pointInText(textMirror.firstChild,3),[imports[0]]);
await waitFor(()=>dropHost.querySelector('img')?.naturalWidth>0,'编辑段落拖入未显示');
await SimaShell.run('file.save');
const afterFieldDrop = (await rpc('read',{path:dropNote})).text;
check(afterFieldDrop.includes(textMirror.textContent.slice(0,3)+'!['),'编辑段落按鼠标位置插图');
const endEntry = dropHost.querySelector('.sima-end-entry');
endEntry.scrollIntoView({block:'center'});
const endBox = endEntry.getBoundingClientRect();
dropFiles(endEntry,{clientX:endBox.left+2,clientY:endBox.top+2},[imports[1]]);
await waitFor(()=>dropHost.querySelectorAll('img').length===2,'文末插图未显示');
await SimaShell.run('file.save');
check((await rpc('read',{path:dropNote})).text.startsWith(afterFieldDrop+'\n\n!['),'文末空白处拖入图片独占新段落');
const diaryImage = dropHost.querySelector('img[alt="AI药物研发价值链图.png"]');
diaryImage.click();
const caption = dropHost.querySelector('textarea.sima-image-caption');
function checkCaption(label) {
  const style = getComputedStyle(caption);
  check(caption.scrollWidth <= caption.clientWidth + 1 && caption.scrollHeight <= caption.clientHeight + 1 &&
    caption.clientHeight >= parseFloat(style.lineHeight) && caption.scrollLeft===0 && caption.scrollTop===0,label);
}
check(caption.value.includes('AI药物研发价值链图-2.png'),'日记中显示带同名后缀的实际文件名');
checkCaption('完整显示中文图片引用');
const column = dropHost.querySelector('.sima-document');
column.style.maxWidth = '300px';
checkCaption('缩窄正文时引用自动换行且完整可见');
const oldHeight = caption.clientHeight;
const oldValue = caption.value;
caption.value = oldValue.replace('](',']('+'long-folder-name'.repeat(15)+'/');
caption.dispatchEvent(new InputEvent('input',{bubbles:true}));
check(caption.clientHeight>oldHeight,'编辑长路径时源码框随内容增高');
checkCaption('无空格的长路径仍可读');
await SimaShell.run('edit.undo');
check(caption.value===oldValue && caption.clientHeight===oldHeight,'撤销恢复原始图片引用和行高');
column.style.removeProperty('max-width');
checkCaption('恢复窗口宽度后仍完整可见');
return {checks};
