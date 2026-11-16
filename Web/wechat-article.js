/* Format a snapshot of the active SimaQ Markdown document for the WeChat editor. */
(function (global) {
  'use strict';
  const styles = {
    p: 'margin:0 0 16px;line-height:1.8',
    h1: 'font-size:24px;font-weight:bold;margin:24px 0 12px',
    h2: 'font-size:21px;font-weight:bold;margin:22px 0 10px',
    h3: 'font-size:18px;font-weight:bold;margin:18px 0 8px',
    blockquote: 'margin:16px 0;padding:4px 14px;border-left:3px solid #919e96;color:#536058',
    pre: 'white-space:pre-wrap;overflow-wrap:anywhere;background-color:#f4f5f4;padding:12px;font-size:14px',
    code: 'font-family:Menlo,monospace;font-size:14px',
    table: 'border-collapse:collapse;width:100%;font-size:14px',
    th: 'border:1px solid #ccd2ce;padding:6px;background-color:#f4f5f4',
    td: 'border:1px solid #ccd2ce;padding:6px',
    ul: 'padding-left:24px', ol: 'padding-left:24px', li: 'line-height:1.8',
    img: 'max-width:100%;height:auto', a: 'color:#42624f;text-decoration:underline',
  };
  const allowedTags = new Set(('p section div span br hr h1 h2 h3 h4 h5 h6 strong b em i s del u sub sup ' +
    'mark kbd code pre blockquote ul ol li table thead tbody tr th td img a').split(' '));

  function format(markdown, path) {
    const template = document.createElement('template');
    template.innerHTML = global.SimaRender.render(markdown, {path});
    const body = template.content;
    body.querySelectorAll('.md-meta-block,.sima-toc').forEach(node => node.remove());
    const heading = body.firstElementChild;
    let title = path.split('/').pop().replace(/\.(md|markdown|mdown|mkd)$/i, '');
    if (heading?.localName === 'h1') {
      title = heading.textContent.trim() || title;
      heading.remove();
    }
    body.querySelectorAll('input[type=checkbox]').forEach(node => {
      node.replaceWith(node.hasAttribute('checked') ? '☑ ' : '☐ ');
    });
    body.querySelectorAll('mjx-container').forEach(node => {
      const description = node.querySelector('svg title')?.textContent;
      node.replaceWith(description || '〔公式待补〕');
    });
    body.querySelectorAll('script,style,iframe,object,embed,svg').forEach(node => node.remove());
    const missing = [];
    for (const node of [...body.querySelectorAll('*')]) {
      const tag = node.localName;
      if (!allowedTags.has(tag)) {
        node.replaceWith(...node.childNodes);
        continue;
      }
      const href = node.getAttribute('href') || '';
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      const start = node.getAttribute('start');
      for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
      if (tag === 'a') {
        if (!/^https?:\/\//i.test(href)) {
          node.replaceWith(...node.childNodes);
          continue;
        }
        node.setAttribute('href', href);
      }
      if (tag === 'ol' && start && /^-?\d+$/.test(start)) node.setAttribute('start', start);
      if (tag === 'img') {
        let hosted = false;
        try {
          const url = new URL(src);
          hosted = url.protocol === 'https:' && url.hostname === 'mmbiz.qpic.cn';
        } catch {}
        if (!hosted) {
          const label = alt || '第 ' + (missing.length + 1) + ' 张待补图片';
          missing.push(label);
          node.replaceWith('〔请插入图片：' + label + '〕');
          continue;
        }
        node.setAttribute('src', src);
        node.setAttribute('alt', alt);
      }
      if (styles[tag]) node.setAttribute('style', styles[tag]);
    }
    if (!body.textContent.trim() && !body.querySelector('img')) throw Error('当前页面没有可发送的正文。');
    const text = body.cloneNode(true);
    text.querySelectorAll('img').forEach(node => node.replaceWith(node.alt || '〔图片〕'));
    text.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    text.querySelectorAll('td,th').forEach(node => node.append('\t'));
    text.querySelectorAll('p,section,div,h1,h2,h3,h4,h5,h6,blockquote,pre,li,tr,hr').forEach(node => node.append('\n'));
    return {title, html: template.innerHTML, plainText: text.textContent.trim(), missingImages: missing};
  }
  global.SimaWeChatArticle = {format};
})(globalThis);
