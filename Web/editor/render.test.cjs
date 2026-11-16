const assert=require('node:assert/strict');
require('./render.js');
const r=global.SimaRender;
const s='---\ntitle: 示例\n---\n\n# Heading\n\n[链接][ref] [[目录/文档|标签]] [^a]\n\n[ref]: https://example.com\n\n[^a]: 注释\n\n- [x] 完成\n\n| 一 | 二 |\n| --- | --- |\n| 1 | 2 |\n\n```js\n<script>\n```\n\n$$\nx^2\n$$';
const blocks=r.parse(s); for(const b of blocks) assert.equal(s.slice(b.start,b.end),b.source);
assert.deepEqual(blocks.filter(b=>['yaml','heading','table','fence','sima_math_block'].includes(b.type)).map(b=>b.type),['yaml','heading','table','fence','sima_math_block']);
const html=blocks.map(b=>r.renderBlock(b)).join('');
assert.match(html,/<a href="https:\/\/example.com">链接<\/a>/);
assert.match(html,/data-link="目录\/文档"/);
assert.match(html,/class="footnote-ref" title="注释"/);
assert.match(html,/<input type="checkbox" checked>/);
assert.match(html,/<table>/);assert.match(html,/&lt;script&gt;/);
assert.doesNotMatch(r.render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>'),/<(?:script|img)\b/i);
assert.doesNotMatch(r.render('[bad](javascript:alert(1))'),/href="javascript:/i);
assert.match(r.render('<b>safe</b> ~~gone~~'),/<b>safe<\/b> <s>gone<\/s>/);
const other=r.parse('[ref]: https://other.example\n\n[x][ref]');
assert.match(r.renderBlock(blocks.find(b=>b.source.startsWith('[链接]'))),/example\.com/);
assert.match(r.renderBlock(other.find(b=>b.source==='[x][ref]')),/other\.example/);
global.assetURL=x=>'asset:'+x;
assert.match(r.render('![图](图片%20一.png)',{path:'目录/文档.md'}),/asset:目录\/图片 一\.png/);
require('node:test')('HTML export',async()=>assert.match(await r.exportHTML('# test'),/^<!doctype html>/));
console.log('render tests passed');
const extra=r.render('[toc]\n\n# 第一节\n\n## 第二节\n\n==重点== H~2~O x^2^');
assert.match(extra,/<nav class="sima-toc">/);assert.match(extra,/<h1 id="第一节">/);
assert.match(extra,/<mark>重点<\/mark>/);assert.match(extra,/H<sub>2<\/sub>O/);assert.match(extra,/x<sup>2<\/sup>/);

require('node:test')('dollar prices and numeric TeX in the same paragraph',()=>{
  const formulas=s=>r.parse(s).flatMap(b=>b.formulas || []).map(f=>f.tex);
  for (const [source,expected] of [
    ['目标价$120，估值用$V_0$。',['V_0']],
    ['$2$+$3$',['2','3']],
    ['目标价$120$x$。',['x']],
    ['从$10涨到$12，估值$2x+1$。',['2x+1']],
    ['Price $15.50, EPS is $E_1$.',['E_1']],
    ['Cost $10 and EPS=$x$.',['x']],
    ['$2$和$x$，$2xy$，$2 + x$。',['2','x','2xy','2 + x']],
    ['USD $10–$20，现金$1,200.50，盈利$E$。',['E']],
    [String.raw`\$5，代码 `+'\u0060$x$\u0060'+String.raw` 和 \(2+2\)。`,['2+2']],
  ]) assert.deepEqual(formulas(source),expected,source);
});

require('node:test')('local image paths with spaces, titles and per-occurrence widths', async () => {
  const note = {path:'LifeOS/articles/笔记.md'};
  const link = '![ IQ 钟形曲线 meme](images/Pasted image 20260524222819.png)';
  assert.match(r.render(link,note), /<img src="asset:LifeOS\/articles\/images\/Pasted image 20260524222819.png"/);
  const source = '> - `' + link + '`\n>   ' + link + ' ' + link + '{width=240}';
  const html = r.render(source,{...note,editableImages:true});
  const offsets = [...html.matchAll(/data-offset="(\d+)"/g)].map(m=>Number(m[1]));
  assert.deepEqual(offsets,[source.lastIndexOf(' '+link),source.indexOf('{width')]);
  const exported = await r.exportHTML(source,note);
  assert.equal((exported.match(/<img /g)||[]).length,2);
  assert.match(exported,/width="240"/);
  assert.doesNotMatch(exported,/sima-image-grip|\{width=/);
  for(const dest of ['<images/a b.png>', 'images/a%20b.png', 'images/a b.png'])
    assert.match(r.render('![a]('+dest+' "caption"){width=100}',note),/title="caption" width="100"/);
  assert.match(r.render('![a](images/a (2).png)',note),/a \(2\)\.png/);
  assert.match(r.render('![a][ref]{width=88}\n\n[ref]: images/a.png',note),/width="88"/);
  assert.doesNotMatch(r.render('![a](file:local bad.png)\n\n`'+link+'`\n\n[a](local bad.png)',note),/<img |<a /);
});

require('node:test')('image alignment is per occurrence and exported with its width', async () => {
  const image='![图](images/示例 图.png)';
  for (const [align,justify] of Object.entries({left:'flex-start',center:'center',right:'flex-end'})) {
    for (const width of ['', '{width=240}']) {
      const source=image+' '+image+width+'{align='+align+'}';
      const html=await r.exportHTML(source);
      assert.equal((html.match(/data-image-align=/g)||[]).length,1);
      assert.ok(html.includes('justify-content:'+justify));
      assert.equal(html.includes('width="240"'),!!width);
      assert.doesNotMatch(html,/sima-image-grip|\{align=/);
    }
  }
  assert.doesNotMatch(r.render(image+'{align=unknown}'),/data-image-align/);
});
