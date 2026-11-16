const test=require('node:test');
const assert=require('node:assert/strict');
const tables=require('./tables.js');

test('parse maps exact UTF-16 cell source ranges, including escaped and code-span pipes',()=>{
  const raw='  | 公司😀 | A\\|B | `x|y` |\r\n  | :--- | ---: | :---: |\n  | 上海 | 12 | ``a|b`` |\r\n';
  const model=tables.parse(raw);
  assert.equal(model.columns,3);assert.equal(model.rows.length,2);
  assert.deepEqual(model.align,['left','right','center']);
  assert.equal(model.rows[0][1].text,'A\\|B');assert.equal(model.rows[0][2].text,'`x|y`');
  model.rows.flat().forEach(cell=>assert.equal(raw.slice(cell.start,cell.end),cell.text));
});
test('pipe-less outer borders and missing trailing cells are accepted',()=>{
  const model=tables.parse('a | b\n--- | ---\nlast |\n');
  assert.equal(model.rows[0][0].text,'a');assert.equal(model.rows[1][1].text,'');
  assert.equal(tables.parse('| a |\n| -- |'),null);
  assert.equal(tables.parse('paragraph'),null);
  assert.equal(tables.parse('setext heading\n---'),null);
  assert.equal(tables.parse('| unmatched ` | normal |\n| --- | --- |').columns,2);
});
test('single-cell edit preserves all non-cell source bytes',()=>{
  const raw='| 公司  | 数字 |\r\n| :---- | ---: |\n| 上海  | 12 |\r\n';
  const expected=raw.replace('上海','北京\\|上海');
  assert.equal(tables.setCell(raw,1,0,'北京|上海'),expected);
  const blank=tables.create(2,2);
  assert.equal(tables.parse(tables.setCell(blank,1,0,'a||b')).rows[1][0].text,'a\\|\\|b');
  assert.equal(tables.parse(tables.setCell(blank,1,0,'`a|b`')).rows[1][0].text,'`a|b`');
});
test('structural row and column operations retain alignment and header identity',()=>{
  const raw='| A | B |\n| :--- | ---: |\n| a | b |\n| c | d |';
  const added=tables.parse(tables.operate(raw,'table.columnLeft',1,1));
  assert.deepEqual(added.rows[0].map(c=>c.text),['A','','B']);assert.deepEqual(added.align,['left',null,'right']);
  const moved=tables.parse(tables.operate(raw,'moveColumnRight',1,0));
  assert.deepEqual(moved.rows[0].map(c=>c.text),['B','A']);assert.deepEqual(moved.align,['right','left']);
  assert.equal(tables.operate(raw,'moveRowUp',1,0),raw);
  const down=tables.parse(tables.operate(raw,'moveRowDown',1,0));
  assert.deepEqual(down.rows.map(r=>r[0].text),['A','c','a']);
  assert.equal(tables.parse(tables.operate(raw,'rowAbove',0,0)).rows.length,4);
  assert.deepEqual(tables.parse(tables.operate(raw,'deleteRow',0,0)).rows[0].map(c=>c.text),['a','b']);
});
test('alignment and deleting final column produce valid Markdown',()=>{
  const raw=tables.create(2,2);
  assert.equal(tables.parse(tables.operate(raw,'alignCenter',1,1)).align[1],'center');
  const one=tables.operate(raw,'deleteColumn',0,0);assert.equal(tables.parse(one).columns,1);
  assert.equal(tables.operate(one,'deleteColumn',0,0),one);
});
test('TSV round trips quoted tabs, multiline values and escaped quotes',()=>{
  assert.deepEqual(tables.parseTSV('a\t"b\tc"\r\n"d\ne"\t"say ""hi"""\r\n'),[['a','b\tc'],['d\ne','say "hi"']]);
  const raw='| A | B |\n| --- | --- |\n| x\\|y | first<br>second |';
  assert.equal(tables.copyRectangle(raw,{top:1,bottom:1,left:0,right:1}),'x|y\t"first\nsecond"');
});
test('rectangular paste preserves mixed EOLs and spacing outside changed cells',()=>{
  const raw='  | A  | B |\r\n  | :--- | ---: |\n  | a  | b |\r\n  | c | d  |\n';
  const pasted=tables.pasteRectangle(raw,1,0,'上海\t4\n北京\t5');
  assert.equal(pasted,'  | A  | B |\r\n  | :--- | ---: |\n  | 上海  | 4 |\r\n  | 北京 | 5  |\n');
});
test('paste expands table and selected rectangle fill applies one value to every cell',()=>{
  const raw=tables.create(2,2);
  const expanded=tables.parse(tables.pasteRectangle(raw,1,1,'x\ty\nz\tw'));
  assert.equal(expanded.rows.length,3);assert.equal(expanded.columns,3);assert.equal(expanded.rows[2][2].text,'w');
  const filled=tables.parse(tables.pasteRectangle(raw,1,1,'v',{top:0,left:0,bottom:1,right:1}));
  assert.deepEqual(filled.rows.map(r=>r.map(c=>c.text)),[['v','v'],['v','v']]);
  const selected=tables.parse(tables.pasteRectangle(raw,1,1,'a\tb',{top:0,left:0,bottom:1,right:1}));
  assert.deepEqual(selected.rows[0].map(c=>c.text),['a','b']);
});
test('persisted column widths validate and follow column insertion, deletion and movement',()=>{
  assert.deepEqual(tables.normalizeWidths([80,'120',63,null,NaN,Infinity]),[80,120,null,null,null,null]);
  assert.deepEqual(tables.normalizeWidths(undefined),[]);
  const persisted=[90,180,270];
  assert.deepEqual(tables.changeWidths(persisted,'columnLeft',1),[90,null,180,270]);
  assert.deepEqual(tables.changeWidths(persisted,'columnRight',1),[90,180,null,270]);
  assert.deepEqual(tables.changeWidths(persisted,'deleteColumn',1),[90,270]);
  assert.deepEqual(tables.changeWidths(persisted,'moveColumnLeft',1),[180,90,270]);
  assert.deepEqual(tables.changeWidths(persisted,'moveColumnRight',1),[90,270,180]);
  assert.deepEqual(persisted,[90,180,270]);
});
