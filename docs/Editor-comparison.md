# 编辑方案比较

2026-11-13，在本机 Node v24.14.1 使用同一份中文 Markdown 样例比较两个可运行的本地方案。样例包含 YAML、中文与 emoji、加粗、相对链接、三列表格、转义管道符、任务清单、嵌套清单、代码块和脚注定义；共 228 个 UTF-16 代码单元、336 字节、21 个 CRLF 换行。

本次选择源文权威块编辑方案。两者都可保留原始 Markdown；块编辑把阅读表面、活动块原生 textarea 和 UTF-16 源范围连接起来，并复用表格的定点修改接口，较符合单栏连续阅读与表格编辑需求。全文 textarea 加独立预览保留为实现较简单的基线。

| 项目 | 全文 textarea + markdown-it 独立预览 | 源文权威块编辑 + SimaRender + SimaTables |
| --- | --- | --- |
| 实际取得与执行 | 本机 markdown-it 构建，本地 Node 执行 | 本机 render.js 与项目 tables.js，本地 Node 执行 |
| 无编辑源文保真 | 原字符串保持不变，通过 | 按块范围与间隙重组，逐字相等，通过 |
| 中文与 emoji 源范围 | 本次直接字符串定点替换，通过 | 6 个块的 UTF-16 范围与原文切片全部相等 |
| 表格 HTML | 生成 table 元素 | 生成 table 元素 |
| 修改单元格 | 需用户编辑管道源码；定点替换模拟结果通过 | setCell 将“上海”改为“北京\|上海”，仅目标单元格变化，通过 |
| 表格结构与换行 | 本次定点替换保留 CRLF | 保持三列、21 个 CRLF 和全部非目标源文，通过 |
| YAML | 普通 Markdown 预览会把元数据解释为标题 | 识别独立 yaml 块 |
| 真实 IME、跨块选区、撤销、光标 | 本次未运行浏览器输入测试 | 本次未运行浏览器输入测试 |

这次测试验证了源模型和渲染接口；textarea 的无编辑保真以字符串保持原样为基线，没有创建浏览器 DOM。没有运行第二个成熟富文本编辑器，也没有获得 CodeMirror、Milkdown 的可用依赖，因此不把本表解释为与其实际性能或兼容性的比较。网络依赖下载未完成。

复现：`node benchmarks/editor-comparison.cjs`。默认使用本机 `/tmp/simaq-render-stage`，可通过 `SIMAQ_RENDER_STAGE` 指定包含 markdown-it.min.js 与 render.js 的目录。原始输出为 `benchmarks/editor-comparison-results.json`。表格行为另外由 `node --test Web/editor/tables.test.cjs` 检验。

全链路性能脚本位于 `tests/app-search-timing.js`。它等待当前工作区索引就绪，用桥接请求与查询词绑定结果完成状态，避免旧结果或部分索引的首次命中被误记为完成；每个查询预热后测 20 次，保留全部样本及 p50/p95/min/max。计时终点是结果 DOM 更新后的两次 requestAnimationFrame，为绘制代理值。另记录首次建索引、首次完整索引查询、保存至增量可检索及增量输入至绘制，并在首次建库时运行合成 composition 事件。系统输入法候选窗、真实拼音转换和操作系统合成器呈现时间仍需人工验证。
