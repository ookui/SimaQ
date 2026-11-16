// Pure Node comparison; deliberately does not claim browser/IME coverage.
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const stage=process.env.SIMAQ_RENDER_STAGE||'/tmp/simaq-render-stage';
const md=require(path.join(stage,'markdown-it.min.js'))({html:false,linkify:false});
const context={markdownit:require(path.join(stage,'markdown-it.min.js'))};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(stage,'render.js'),'utf8'),context);
const tables=require('../Web/editor/tables.js');
const sample='---\r\n公司: 上海😀\r\n标签: [芯片, 研究]\r\n---\r\n\r\n# 公司研究\r\n\r\n收入 **增长10%**，净利率从5%降至4%。[公告](报告/公告.pdf)\r\n\r\n| 公司  | 收入 | 备注 |\r\n| :---- | ---: | :---: |\r\n| 上海  | 110 | A\\|B |\r\n\r\n- [x] 核验库存\r\n  - 增长25%\r\n\r\n```python\r\nprint("中文😀")\r\n```\r\n\r\n[^1]: 注释原文\r\n';
const render=context.SimaRender;
const blocks=render.parse(sample);
let rebuilt='',pos=0;for(const block of blocks){rebuilt+=sample.slice(pos,block.start)+block.source;pos=block.end;}rebuilt+=sample.slice(pos);
const table=blocks.find(b=>b.type==='table');
const edited=tables.setCell(table.source,1,0,'北京|上海');
const changed=sample.slice(0,table.start)+edited+sample.slice(table.end);
const baselineChanged=sample.replace('上海  | 110','北京\\|上海  | 110');
const results={runtime:process.version,scope:'source model and rendering only; no DOM, IME, undo or cursor execution',sample:{utf16:sample.length,bytes:Buffer.byteLength(sample),crlf:(sample.match(/\r\n/g)||[]).length},baseline:{name:'原生全文 textarea + markdown-it 独立预览',noOpExact:sample===String(sample),targetedEditExact:baselineChanged===changed,tableHTML:md.render(sample).includes('<table>'),yamlRenderedAsHeading:md.render(sample).includes('<h2>')},blockEditor:{name:'源文权威块编辑 + SimaRender + SimaTables',noOpExact:sample===rebuilt,blockCount:blocks.length,yamlBlock:blocks[0].type==='yaml',offsetSlicesExact:blocks.every(b=>sample.slice(b.start,b.end)===b.source),cellEditOnly:changed===sample.replace('上海  | 110','北京\\|上海  | 110'),crlfRetained:(changed.match(/\r\n/g)||[]).length===(sample.match(/\r\n/g)||[]).length,tableHTML:render.exportHTML(sample).includes('<table>'),escapedPipeColumns:tables.parse(edited).columns}};
if(!results.blockEditor.noOpExact||!results.blockEditor.cellEditOnly||!results.baseline.targetedEditExact)throw Error('source fidelity failed');
console.log(JSON.stringify(results,null,2));
