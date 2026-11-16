// Exercise notebook entry points against fixture notes; capture the handoff before the network.
const checks = [];
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
const note = '微信排版验收.md';
await rpc('newFile', {path: note, text: '---\ninternal: 仅供测试\n---\n# 文章标题\n\n## 小节\n\n**重点**\n\n|名称|值|\n|---|---|\n|甲|1|\n\n![图一](missing.png)'});
await SimaShell.event('openPath', {path: note, newTab: true});
await SimaSettings.refreshCommands();
const cmd = SimaSettings.commands.find(item => item.id === 'file.wechatDraft');
assert(cmd?.enabled && cmd.group === '文件', '当前 Markdown 页面启用文件菜单命令');
const nativeRPC = window.rpc;
let payload;
window.rpc = (method, args) => {
  if (method === 'wechatDraft') { payload = args; return Promise.resolve(true); }
  return nativeRPC(method, args);
};
await SimaSettings.execute('file.wechatDraft');
assert(payload?.title === '文章标题' && !payload.html.includes('仅供测试'), '提取标题并移除笔记元数据');
assert(payload.html.includes('<h2') && payload.html.includes('<strong') && payload.html.includes('<table'), '标题、强调、表格保留富文本');
assert(payload.plainText.includes('重点') && payload.plainText.includes('甲') && !payload.plainText.includes('<table'), '正文具有可直接粘贴的纯文本版本');
assert(payload.missingImageCount === 1 && payload.html.includes('请插入图片：图一'), '未托管图片保留标记');
SimaSettings.palette();
assert([...document.querySelectorAll('[role=option]')].some(el => el.textContent.includes(cmd.label)), '命令面板提供同一入口');
SimaSettings.close();
document.querySelector('#documentMenu').click();
assert([...document.querySelectorAll('button')].some(el => el.textContent.includes(cmd.label)), '当前页面菜单提供同一入口');
await SimaShell.event('openPath', {path:'报告/访谈纪要.pdf',newTab:true});
await SimaSettings.refreshCommands();
assert(cmd.enabled === false, 'PDF 页面禁用发布命令');
window.rpc = nativeRPC;
// Use the same WebKit engine as the publisher and give the adapter a local fixture editor.
const fixture = document.createElement('section');
fixture.innerHTML = '<textarea id="title" style="height:0;padding:0;border:0" max-length="64"></textarea>' +
  '<div class="title-editor__input"><div class="ProseMirror" contenteditable="true" data-placeholder="请在这里输入标题"><br></div></div>' +
  '<div class="rich_media_content"><div contenteditable="true" class="ProseMirror"><div class="editor_content_placeholder ProseMirror-widget" contenteditable="false">从这里开始写正文</div><section><span>\u200b</span></section></div></div>';
document.body.append(fixture);
try {
  const adapter = document.createElement('script');
  adapter.src = 'wechat-editor.js';
  await new Promise((resolve, reject) => {
    adapter.onload = resolve;
    adapter.onerror = () => reject(Error('公众号编辑器适配文件未载入'));
    document.head.append(adapter);
  });
  const location = new URL('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2');
  assert(await fillWeChatEditor(payload.title, payload.html, location) === 'filled', 'WebKit 文章编辑器能完整写入标题和富文本正文');
  const title = fixture.querySelector('.title-editor__input .ProseMirror');
  const body = fixture.querySelector('.rich_media_content .ProseMirror');
  assert(title.textContent === payload.title && body.querySelector('table') && body.querySelector('strong'), '填入可见标题框并保留表格和强调');
  assert(await fillWeChatEditor(payload.title, payload.html, location) === 'occupied', '已有草稿不能重复写入');
  body.textContent = '从这里开始写正文';
  assert(await fillWeChatEditor(payload.title, payload.html, location, 'body') === 'occupied', '用户键入与占位提示相同的文字仍受保护');
  title.replaceChildren();
  assert(await fillWeChatEditor(payload.title, payload.html, location, 'title') === 'filled' && body.textContent === '从这里开始写正文', '单独填标题不改动已有正文');
  body.innerHTML = '<section><img alt="已有图片"></section>';
  assert(await fillWeChatEditor(payload.title, payload.html, location, 'body') === 'occupied', '纯图片草稿不会被覆盖');
  body.innerHTML = '<section><br></section>';
  assert(await fillWeChatEditor(payload.title, payload.html, location, 'body') === 'filled' && title.textContent === payload.title, '单独填正文不改动已有标题');
} finally { fixture.remove(); }
return checks;
