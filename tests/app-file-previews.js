const checks = [];
function check(value, message) { if (!value) throw Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 240));
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;background:white;z-index:10000';
document.body.append(host);
let editor;
try {
  const source = '{"id":9007199254740993123,"items":[{"name":"甲"},{"name":"乙"}],"ok":true}';
  editor = SimaEditor.create(host, {text:source, path:'data.json', literal:true});
  check(host.querySelectorAll('.sima-json-branch').length >= 4, 'JSON nested structure');
  check(editor.getText() === source, 'Opening JSON preserves its original bytes');
  check(host.querySelector('.sima-token-json-key'), 'Editable JSON has key highlighting');
  [...host.querySelectorAll('.sima-file-tools button')].find(b => /JSON/.test(b.textContent)).click();
  check(editor.getText().includes('\n  "id": 9007199254740993123'), 'Formatting retains long integer exactly');
  editor.action('edit.undo');
  check(editor.getText() === source, 'Formatting is undoable');
  await pause();
  host.querySelector('.sima-json-number').click();
  const input = host.querySelector('textarea');
  check(input.value.slice(input.selectionStart, input.selectionEnd) === '9007199254740993123', 'Click JSON value locates exact editable source');
  input.setRangeText('42', input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText',data:'42'}));
  await pause();
  check(host.querySelector('.sima-json-number').textContent.includes('42'), 'JSON preview follows edits');
  editor.setText('{broken');
  await pause();
  check(host.querySelector('.sima-file-status').textContent && host.querySelector('textarea').value === '{broken', 'Invalid JSON remains editable');
  editor.destroy();

  const csv = '名称,说明\n甲,"多行\n文本,和""引号"""\n乙,001\n';
  editor = SimaEditor.create(host, {text:csv, path:'data.CSV', literal:true});
  check(host.querySelectorAll('.sima-csv-table tr').length === 3, 'CSV quoted newlines do not split rows');
  const cell = host.querySelectorAll('.sima-csv-table tr')[1].querySelectorAll('td button')[1];
  check(cell.textContent === '多行\n文本,和"引号"', 'CSV preview decodes quotes and commas');
  cell.click();
  const csvInput = host.querySelector('textarea');
  check(csvInput.value.slice(csvInput.selectionStart, csvInput.selectionEnd) === '"多行\n文本,和""引号"""', 'CSV cell locates exact source field');
  check(editor.getText() === csv, 'CSV navigation preserves source');
  editor.destroy();

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="red"/></svg>';
  editor = SimaEditor.create(host, {text:svg, path:'diagram.SVG', literal:true});
  await pause();
  const image = host.querySelector('.sima-graphic-image');
  check(image.naturalWidth === 1200 && image.naturalHeight === 800, 'SVG preview loads actual dimensions');
  const width = parseFloat(image.style.width);
  const buttons = host.querySelectorAll('.sima-file-tools button');
  buttons[1].click();
  check(parseFloat(image.style.width) > width, 'SVG zoom in');
  buttons[3].click();
  check(parseFloat(image.style.width) === 1200, 'SVG actual size');
  editor.setText(svg.replace('red', 'blue'));
  await pause();
  check(parseFloat(image.style.width) === 1200, 'Editing SVG preserves selected zoom');
  buttons[2].click();
  check(parseFloat(image.style.width) <= image.parentElement.clientWidth, 'SVG fit window');
  editor.setText('<svg broken');
  await pause();
  check(image.hidden && host.querySelector('.sima-file-status').textContent, 'Invalid SVG shows an error');
  editor.setText(svg);
  await pause();
  check(!image.hidden && image.naturalWidth === 1200, 'SVG recovers after source is fixed');
  buttons[3].click();
  const canvas = image.parentElement;
  canvas.scrollTop = 70;
  const originalTop = canvas.scrollTop, originalWidth = image.style.width;
  canvas.dispatchEvent(new MouseEvent('dblclick', {bubbles:true,cancelable:true}));
  const dialog = host.querySelector('.sima-graphic-dialog');
  check(dialog.open && dialog.contains(image), 'Double-click opens SVG in a modal foreground preview');
  check(canvas.clientHeight > 400, 'Foreground preview uses the available window height');
  const zoomBefore = parseFloat(image.style.width);
  canvas.dispatchEvent(new WheelEvent('wheel', {bubbles:true,cancelable:true,deltaY:-100,metaKey:true}));
  check(parseFloat(image.style.width) > zoomBefore, 'Modified wheel zooms foreground SVG');
  const wheel = new WheelEvent('wheel', {bubbles:true,cancelable:true,deltaY:100});
  canvas.dispatchEvent(wheel);
  check(!wheel.defaultPrevented, 'Unmodified wheel retains native scrolling');
  buttons[3].click();
  canvas.scrollTop = 100;
  check(canvas.scrollTop > 0, 'Enlarged foreground SVG can scroll');
  editor.setText(svg.replace('red', 'green'));
  await pause();
  check(dialog.open && !image.hidden && image.style.width === '1200px', 'Foreground preview follows edits and keeps its zoom');
  dialog.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
  check(!dialog.open && image.closest('.sima-file-preview') && !image.closest('dialog'), 'Escape returns SVG to the inline preview');
  check(image.style.width === originalWidth && canvas.scrollTop === originalTop, 'Returning restores inline zoom and scroll position');
  canvas.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
  dialog.querySelector('.sima-graphic-heading button').click();
  check(!dialog.open, 'Foreground close button returns to inline preview');
  canvas.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
  editor.destroy(); editor = null;
  check(!document.querySelector('.sima-graphic-dialog[open]'), 'Destroying editor removes its modal preview');
  for (const [attributes, referenceWidth, referenceHeight] of [
    ['viewBox="0 0 1000 560"',1000,560],
    ['width="100%" viewBox="0 0 1000 560"',1000,560],
    ['width="100" height="56"',100,56],
    ['width="500" viewBox="0 0 1000 560"',500,280]
  ]) {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" '+attributes+'><rect width="100%" height="100%" fill="red"/></svg>';
    editor = SimaEditor.create(host,{text:source,path:'fit.svg',literal:true});
    await pause();
    const img = host.querySelector('.sima-graphic-image'), frame = img.parentElement;
    const fitted = () => {
      const expected = Math.min((frame.clientWidth-24)/referenceWidth,(frame.clientHeight-24)/referenceHeight);
      return Math.abs(parseFloat(img.style.width)-referenceWidth*expected)<1 && Math.abs(parseFloat(img.style.height)-referenceHeight*expected)<1;
    };
    check(fitted(),'SVG fits preview by default: '+attributes);
    const controls=host.querySelectorAll('.sima-file-tools button');
    controls[3].click();
    check(parseFloat(img.style.width)===referenceWidth,'SVG 100% uses source dimensions: '+attributes);
    controls[2].click();
    check(fitted(),'Fit button expands or shrinks SVG to the frame: '+attributes);
    frame.style.height='220px';await pause();
    check(fitted(),'SVG refits after preview frame resize: '+attributes);
    frame.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    check(fitted(),'Foreground preview also fits SVG: '+attributes);
    check(editor.getText()===source,'Auto fitting preserves SVG source: '+attributes);
    editor.destroy();editor=null;
  }
  return {checks};
} finally { editor?.destroy(); host.remove(); }
