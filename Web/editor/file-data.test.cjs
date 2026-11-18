const test = require('node:test');
const assert = require('node:assert/strict');
const {json, formatJSON, csv} = require('./file-data.js');

test('JSON formatting preserves exact numbers, duplicate keys, escapes and BOM', () => {
  const source = '\uFEFF{"id":9007199254740993123,"n":1.2300e+19,"x":-0,"key":"a\\n\\\"b","key":false,"list":[null,{},[]]}\r\n';
  const formatted = formatJSON(source);
  assert.deepEqual(json(formatted).tokens.map(t => t[0]), json(source).tokens.map(t => t[0]));
  assert.ok(formatted.startsWith('\uFEFF{\r\n'));
  assert.ok(formatted.endsWith('\r\n'));
  const id = json(source).root.children[0].node;
  assert.equal(source.slice(id.start, id.end), '9007199254740993123');
});
test('JSON primitives and invalid input', () => {
  for (const value of ['null','false','0','"你好"','[]','{}']) assert.equal(formatJSON(value), value);
  assert.throws(() => json('{"a":}'));
  assert.throws(() => formatJSON('{"a":1,}'));
});
test('CSV preserves quotes, embedded CRLF, Unicode, empty cells and offsets', () => {
  const source = '\uFEFF名字,说明,金额\r\n甲,"换行\r\n含逗号,和""引号""",001.00\r\n乙,,\r\n';
  const rows = csv(source);
  assert.deepEqual(rows.map(r => r.map(c => c.value)), [
    ['名字','说明','金额'], ['甲','换行\r\n含逗号,和"引号"','001.00'], ['乙','','']
  ]);
  const cell = rows[1][1];
  assert.equal(source.slice(cell.start, cell.end), '"换行\r\n含逗号,和""引号"""');
  assert.deepEqual(csv('a,').map(r => r.map(c => c.value)), [['a','']]);
  assert.deepEqual(csv(''), []);
  assert.throws(() => csv('"broken'));
  assert.throws(() => csv('"a"x,b'));
});
