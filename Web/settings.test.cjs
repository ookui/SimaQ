const test = require('node:test');
const assert = require('node:assert/strict');
require('./settings.js');
const api = globalThis.SimaSettings;

test('command IDs are unique and default shortcuts have no conflict', () => {
  assert.equal(new Set(api.commands.map(c => c.id)).size, api.commands.length);
  assert.deepEqual(api.bindingConflicts(), []);
  assert.equal(api.binding('view.graph'), 'Cmd+G');
  assert.equal(api.settings.graphJournals, false);
  assert.equal(api.binding('search.workspace'), 'Cmd+Shift+F');
  assert.ok(['应用','文件','编辑','段落','格式','表格','视图','导航','主题','窗口','帮助'].every(menu => api.commands.some(c => c.menu === menu)));
});

test('key normalization compares native and recorded modifier order', () => {
  assert.equal(api.normalizeBinding('Cmd+Shift+Alt+K'), 'Cmd+Alt+Shift+K');
  assert.equal(api.normalizeBinding('⌘⇧k'), 'Cmd+Shift+K');
  assert.equal(api.normalizeBinding('Command+Option+K'), 'Cmd+Alt+K');
  assert.equal(api.normalizeBinding(''), '');
  assert.equal(api.normalizeBinding('Cmd+\\'), 'Cmd+\\');
});

test('custom bindings detect collisions against unchanged defaults', () => {
  const found = api.bindingConflicts({'file.new':'Cmd+S'});
  assert.deepEqual(found, [['file.new','file.save','Cmd+S']]);
  assert.deepEqual(api.bindingConflicts({'file.new':'Cmd+S','file.save':''}), []);
});

test('binding supports explicit removal and default restoration', () => {
  api.settings.bindings['file.save']='';
  assert.equal(api.binding('file.save'), '');
  delete api.settings.bindings['file.save'];
  assert.equal(api.binding('file.save'), 'Cmd+S');
});

test('templates preserve YAML, Chinese and newline bytes outside tokens', () => {
  const text='---\r\n# 注释\r\ntitle: "{{title}}"\r\ndate: {{date:YYYY-MM-DD HH:mm}}\r\n---\r\n{{公司}}\r\n{{cursor}}保留';
  const actual=api.expandTemplate(text,{title:'富瀚微',公司:'上海'},new Date(2026,10,13,9,5));
  assert.equal(actual.text,'---\r\n# 注释\r\ntitle: "富瀚微"\r\ndate: 2026-11-13 09:05\r\n---\r\n上海\r\n保留');
  assert.equal(actual.text.slice(actual.cursor),'保留');
});

test('first cursor is used with UTF-16 editor offsets and unknown variables stay visible', () => {
  const actual=api.expandTemplate('😀{{cursor}}a{{cursor}} {{未知}}');
  assert.equal(actual.cursor,2);
  assert.equal(actual.text,'😀a {{未知}}');
  assert.equal(api.expandTemplate('{{title}}',{title:'test'}).cursor,4);
});

test('input method composition is never handled as a command', () => {
  assert.equal(api.handleKey({isComposing:true}),false);
  assert.equal(api.handleKey({keyCode:229}),false);
});

test('English menu translations cover every command and all menu groups', () => {
  const {translate} = require('./menu-language.js');
  for (const {label,menu} of api.commands) {
    assert.doesNotMatch(translate(label,'en'),/\p{Script=Han}/u,label);
    assert.doesNotMatch(translate(menu,'en'),/\p{Script=Han}/u,menu);
    assert.equal(translate(label,'zh-Hans'),label);
  }
  assert.equal(translate('打开资料库…','zh-Hant'),'開啟資料庫…');
  assert.equal(translate('在右侧插入列','zh-Hant'),'在右側插入直欄');
});
