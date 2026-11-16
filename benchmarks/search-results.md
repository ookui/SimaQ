# 搜索测试记录

2026-11-13，Apple Silicon MacBook Pro，arm64，Darwin 27.2.0；Swift 6.2.1、Swift 5 语言模式，编译优化 `-O`。系统限制了 CPU 型号与内存查询。语料为 10,000 个 Markdown 文件、约 208 MB；HTML、PDF 均为 0。工作区默认返回首批 60 个文件、每个文件前 4 条上下文及实际命中总数。正文高度重复，仅一篇包含稀有词，10% 包含中等频率词，全部包含广泛词；`quarterly revenue` 每篇出现 315 次。每项暖查询执行 20 次，列出第 19 个排序值作为 p95。查询计时包含 75 ms 防抖和主线程回调，不含左栏绘制。

| 指标 | 实测 |
| --- | ---: |
| 首次建索引完成 | 26.56 秒 |
| 建索引完成后首次查询 | 84 ms |
| 稀有词 `physical ai`，p95 | 86 ms |
| 中等词 `moderate marker`，p95 | 113 ms |
| 广泛词 `wide marker`，p95 | 108 ms |
| 中文广泛词 `广泛样本`，p95 | 107 ms |
| 每篇重复 315 次的 `quarterly revenue`，p95 | 129 ms |
| 整词查询，p95 | 84 ms |
| 精确短语，p95 | 129 ms |
| 正则回退查询，p95 | 1,636 ms |
| 两字中文回退查询，p95 | 1,656 ms |
| 单文件更新至查询回调 | 83 ms |
| 左栏绘制完成时间、建索引时中文输入 | 未测 |

可索引查询的服务回调在此语料下低于 200 ms；正则及不足三个 Unicode 标量的短查询须扫描全文，超过目标。实际端到端延迟还包括左栏绘制。语料重复程度很高，PDF 和 HTML 性能尚未测试。

查询按文件名、Markdown 标题、目录、正文分级检索并校验原文；达到文件组数上限后返回该批。初建和重扫分批执行，索引未完成时查询可能返回部分结果，调用方应使用 `whenReady` 在完成后刷新。已有索引在重扫期间可查询。删除文件夹、目录变更和根目录变更触发重新扫描。索引保存在应用数据目录，可删除重建。外部修改须由文件监听器调用 `update`；默认跳过隐藏文件和符号链接。若系统 SQLite 不支持 FTS5 trigram，服务回退扫描。无效正则返回空结果。

生成独立语料：

```sh
python3 benchmarks/generate_corpus.py /tmp/simaq-corpus
```

测试目录必须为空。运行服务基准：

```sh
swiftc -O -module-cache-path /tmp/simaq-swift-cache -swift-version 5 -I Native/CSQLite Native/MarkdownLinks.swift Native/Search.swift benchmarks/search_benchmark.swift -o /tmp/simaq-search-bench -lsqlite3
SIMAQ_SEARCH_INDEX_DIR=/tmp/simaq-search-benchmark-index /tmp/simaq-search-bench
```
