// Exercise the shipping editor and theme in a visible WKWebView.
const checks = [];
function check(condition, label) {
  if (!condition) throw Error(label);
  checks.push(label);
}
await SimaSettings.execute('theme.tana');
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;z-index:1000;background:white';
document.body.append(host);
const title = '# 对自己的几点要求 #lifelog';
const tag = '#lifelog';
const editor = SimaEditor.create(host, {text:title, path:'caret.md'});
try {
  for (const backward of [false, true]) {
    editor.setText(title);
    const heading = host.querySelector('h1'), node = heading.firstChild;
    const start = node.data.indexOf(tag), end = start + tag.length;
    getSelection().setBaseAndExtent(node, backward ? end : start, node, backward ? start : end);
    heading.click();
    let field = host.querySelector('textarea');
    const mirror = host.querySelector('.sima-text-mirror');
    check(getComputedStyle(mirror).fontFamily === getComputedStyle(field).fontFamily,
      '标题显示层与原生选区使用相同字体');
    for (let i = 0; i < 3; i++) {
      field = host.querySelector('textarea');
      check(field.selectionStart === title.indexOf(tag) && field.selectionEnd === title.length &&
        (field.selectionDirection === 'backward') === backward, '切换模式保留标签选区及方向');
      if (i < 2) editor.action('view.source');
    }
    field.setRangeText('新标签', field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:'新标签'}));
    check(editor.getText() === title.replace(tag, '新标签'), '替换整个标签，不遗漏末尾字母');
  }
  for (const after of [false, true]) {
    editor.setText(title);
    const heading = host.querySelector('h1'), node = heading.firstChild;
    const glyph = document.createRange();
    glyph.setStart(node, node.length - 1);
    glyph.setEnd(node, node.length);
    const rect = glyph.getBoundingClientRect();
    getSelection().removeAllRanges();
    heading.dispatchEvent(new MouseEvent('click', {bubbles:true,
      clientX:rect.left + rect.width * (after ? .85 : .15), clientY:rect.top + rect.height / 2}));
    const field = host.querySelector('textarea'), at = after ? title.length : title.length - 1;
    check(field.selectionStart === at && field.selectionEnd === at, '点击末字母两侧定位到对应插入点');
    field.setRangeText('|', field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:'|'}));
    check(editor.getText() === title.slice(0, at) + '|' + title.slice(at), '文字插入到点击的字符边界');
  }
  editor.setText('前文😀 **标签** 后文');
  const strong = host.querySelector('strong');
  getSelection().setBaseAndExtent(strong, 0, strong, strong.childNodes.length);
  strong.click();
  const field = host.querySelector('textarea');
  check(field.value.slice(field.selectionStart, field.selectionEnd) === '标签',
    '行内格式元素边界排除 Markdown 标记和后文');
  return {checks};
} finally {
  editor.destroy();
  host.remove();
}
