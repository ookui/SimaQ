/* Runs in an isolated WebKit content world on the WeChat editor page. */
async function fillWeChatEditor(title, html, location = window.location, part = 'both') {
  if (location.origin !== 'https://mp.weixin.qq.com') return 'waiting';
  if (location.pathname === '/cgi-bin/home' && part === 'both') {
    const item = [...document.querySelectorAll('.new-creation__menu-item')].find(node =>
      node.querySelector('.new-creation__menu-title')?.textContent.trim() === '文章');
    if (item && !window.simaOpenedArticle) {
      window.simaOpenedArticle = true;
      item.click();
    }
    return 'home';
  }
  if (location.pathname !== '/cgi-bin/appmsg' || !new URLSearchParams(location.search).get('t')?.startsWith('media/appmsg_edit')) return 'waiting';

  const visible = node => node && node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().width > 0;
  const input = document.querySelector('textarea#title,input#title');
  const titleField = [...document.querySelectorAll('.title-editor__input [contenteditable=true],#title [contenteditable=true],#title[contenteditable=true]')].find(visible) ||
    (visible(input) ? input : null);
  const oldFrame = document.querySelector('iframe#ueditor_0');
  const bodyField = [...document.querySelectorAll('.rich_media_content .ProseMirror[contenteditable=true]')].find(visible) ||
    (visible(oldFrame) && oldFrame.contentDocument?.querySelector('body[contenteditable=true]'));
  const writeTitle = part !== 'body';
  const writeBody = part !== 'title';
  if ((writeTitle && !titleField) || (writeBody && !bodyField) || (bodyField && titleField?.contains(bodyField))) return 'loading';

  // WeChat inserts its prompt as a non-editable widget INSIDE the body. Remove only
  // that decoration from a copy, so an author can still write those same words.
  function content(field) {
    const copy = field.cloneNode(true);
    copy.querySelectorAll('.editor_content_placeholder.ProseMirror-widget[contenteditable=false]').forEach(node => node.remove());
    return copy;
  }
  const textOf = field => ('value' in field ? field.value : content(field).textContent).replace(/[\u200b\ufeff]/g, '').trim();
  const hasBody = () => textOf(bodyField) || content(bodyField).querySelector('img,video,audio,table,hr,iframe,svg,canvas,mp-common-mpaudio,mp-common-videosnap,[contenteditable=false]');
  if ((writeTitle && (textOf(titleField) || input?.value.trim())) || (writeBody && hasBody())) return 'occupied';

  function insert(field, command, value) {
    field.focus();
    const doc = field.ownerDocument;
    // Both paths reach here only for an empty field. Put the caret in the
    // editable paragraph instead of selecting the non-editable prompt widget.
    const leaf = field.querySelector('section:not([contenteditable=false]),p:not([contenteditable=false])') || field;
    const range = doc.createRange();
    range.selectNodeContents(leaf);
    range.collapse(false);
    const selection = doc.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (command === 'insertHTML') {
      // ProseMirror handles a rich paste as an editor transaction, preserving
      // block structure and the editor's own undo history.
      const data = new DataTransfer();
      const fragment = doc.createElement('template');
      fragment.innerHTML = value;
      data.setData('text/html', value);
      data.setData('text/plain', fragment.content.textContent);
      const paste = new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data});
      if (!field.dispatchEvent(paste) || hasBody()) return true;
    }
    return doc.execCommand(command, false, value);
  }
  if (writeTitle) {
    const limit = Number(input?.getAttribute('max-length') || input?.getAttribute('maxlength'));
    if (limit > 0 && Array.from(title).length > limit) return 'longTitle';
    if ('value' in titleField) {
      titleField.value = title;
      titleField.dispatchEvent(new Event('input', {bubbles:true}));
      titleField.dispatchEvent(new Event('change', {bubbles:true}));
    } else if (!insert(titleField, 'insertText', title)) return 'partial';
  }
  if (writeBody && !insert(bodyField, 'insertHTML', html)) return 'partial';
  await new Promise(resolve => setTimeout(resolve, 300));
  if (writeTitle && textOf(titleField) !== title) return 'partial';
  if (writeBody) {
    const expected = document.createElement('template');
    expected.innerHTML = html;
    const compact = value => value.replace(/[\s\u200b\ufeff]/g, '');
    if (compact(textOf(bodyField)) !== compact(expected.content.textContent) ||
        bodyField.querySelectorAll('img').length !== expected.content.querySelectorAll('img').length) return 'partial';
  }
  return 'filled';
}
