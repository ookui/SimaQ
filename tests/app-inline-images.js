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
const name = '正文 ' + Date.now() + '.svg';
const note = '专题/图片验收.md';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320"><rect width="720" height="320" fill="teal"/></svg>';
await rpc('asset', {path:note, filename:name, folder:'../图像', data:btoa(svg)});
const canvas = document.createElement('canvas');
canvas.width = 100; canvas.height = 60;
const png = canvas.toDataURL().split(',')[1];
await rpc('asset', {path:note, filename:'图.png', folder:'../图像', data:png});
const sources = ['![SVG](../图像/' + name + ')', '![位图](../图像/图.png){width=90}', '![[' + name + ']]'];
const source = ['# 图片', '第一段。\n\n'.repeat(15), ...sources, '末段。\n\n'.repeat(15)].join('\n\n');
await rpc('newFile', {path:note, text:source});
await SimaShell.event('openPath', {path:note, newTab:true});
const host = document.querySelector('#hosts .doc-host:not([hidden])');
const viewport = host.querySelector('.sima-editor');
const frames = [...host.querySelectorAll('.sima-sized-image')];
check(frames.length === 3, '普通 SVG、PNG、Wiki SVG 均在 Markdown 中生成图片');
for (const [index, frame] of frames.entries()) {
  const img = frame.querySelector('img');
  await waitFor(() => img.complete && img.getBoundingClientRect().width > 0 && (img.naturalWidth || img.naturalHeight), '无法解码 ' + sources[index] + ' ' + img.src);
  img.scrollIntoView({block:'center'});
  const rect = img.getBoundingClientRect();
  if (index !== 1) {
    check(rect.width > 250 && Math.abs(rect.width/rect.height - 720/320) < 0.02, 'SVG 按正文宽度完整等比显示');
  }
  const point = {clientX:rect.left+rect.width/2, clientY:rect.top+rect.height/2, bubbles:true, cancelable:true};
  function click(detail) {
    const target = document.elementFromPoint(point.clientX,point.clientY);
    check(target === img, '原点击位置仍命中正文图片');
    target.dispatchEvent(new PointerEvent('pointerdown',point));
    target.dispatchEvent(new MouseEvent('mousedown', {...point,detail}));
    target.dispatchEvent(new MouseEvent('mouseup', {...point,detail}));
    target.dispatchEvent(new MouseEvent('click', {...point,detail}));
  }
  click(1);
  const caption = frame.querySelector('.sima-image-caption');
  check(caption?.value === sources[index] && getComputedStyle(caption).position === 'static' &&
        caption.getBoundingClientRect().bottom <= img.getBoundingClientRect().top + 1, '图片语法是正文里的一行可编辑文本');
  check(document.activeElement===caption && getComputedStyle(img).cursor==='default' && !host.querySelector('dialog[open],.sima-block-input'), '单击选中图片并聚焦源码，正文使用普通指针');
  const top = viewport.scrollTop, inlineRect = img.getBoundingClientRect();
  click(2);
  img.dispatchEvent(new MouseEvent('dblclick',{...point,detail:2}));
  const dialog = host.querySelector('dialog[open]'), large = dialog?.querySelector('img');
  await waitFor(()=>large && parseFloat(large.style.width)>0, '前景预览未显示');
  check(frame.contains(img) && large !== img, '原图保留，前景独立显示');
  const before = parseFloat(large.style.width);
  if (index===1) check(before===100, '预览按原图 100 像素打开，忽略正文的 90 像素宽度');
  const body = large.parentElement;
  const fit = Math.min((body.clientWidth-24)/before, (body.clientHeight-24)/parseFloat(large.style.height));
  const oversized = fit < 1;
  const initialCursor = oversized ? 'zoom-out' : 'zoom-in';
  check(getComputedStyle(large).cursor===initialCursor,'100% 时按预览框大小显示加号或减号');
  large.click();
  check(Math.abs(parseFloat(large.style.width)-before*(oversized ? fit : 2))<0.1 &&
    getComputedStyle(large).cursor!==(initialCursor), '单击大图完整显示，小图放大两倍');
  large.click();
  check(Math.abs(parseFloat(large.style.width)-before)<0.1 && getComputedStyle(large).cursor===initialCursor, '再次单击返回原始尺寸');
  const plain = new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-80});
  large.dispatchEvent(plain);
  check(!plain.defaultPrevented && parseFloat(large.style.width)===before, '普通滚轮保留系统滚动');
  large.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-80,metaKey:true}));
  check(parseFloat(large.style.width)>before && img.getBoundingClientRect().width===rect.width, '滚轮只缩放前景图');
  dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check(!host.querySelector('dialog[open]') && img.isConnected && viewport.scrollTop===top && Math.abs(img.getBoundingClientRect().top-inlineRect.top)<1, 'Esc 返回原图原位置');
}
await SimaShell.run('file.save');
check((await rpc('read',{path:note})).text === source, '浏览图片后保存的 Markdown 完全相同');
const pngFrame=frames[1], bitmap=pngFrame.querySelector('img');
bitmap.click();
const input=pngFrame.querySelector('textarea.sima-image-caption');
const edited=sources[1].replace('位图','新说明').replace('width=90','width=72');
input.value=edited;
input.dispatchEvent(new InputEvent('input',{bubbles:true}));
check(bitmap.alt==='新说明' && bitmap.width===72 && pngFrame.contains(input), '编辑图片语法即时更新原图');
await SimaShell.run('edit.undo');
check(input.isConnected && input.value===sources[1] && bitmap.width===90, '撤销时图片和编辑行保留在正文');
await SimaShell.run('edit.redo');
check(input.isConnected && input.value===edited && bitmap.width===72, '重做恢复该处图片');
await SimaShell.run('file.save');
check((await rpc('read',{path:note})).text === source.replace(sources[1],edited), '编辑中的语法写回所选图片，保留其余原文');
input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
check(!pngFrame.isConnected && host.querySelector('img[alt="新说明"]')?.width===72,'完成编辑保留新图');
return {checks};
