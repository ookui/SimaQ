# 搜索测试

```sh
swiftc -module-cache-path /tmp/simaq-swift-cache -swift-version 5 -I Native/CSQLite Native/MarkdownLinks.swift Native/Search.swift tests/search_tests.swift -o /tmp/simaq-search-test -lsqlite3
SIMAQ_SEARCH_INDEX_DIR=/tmp/simaq-search-index /tmp/simaq-search-test
```

覆盖默认分隔符、中文、精确短语、整词、正则、归档、目录、扩展名、UTF-8/BOM UTF-16 和 UTF-32 文档的显示文本 UTF-16 偏移、文件名与标题优先级、HTML 基本文本提取、PDF 文本页和纯图像页、增量修改、删除及过期查询回调。HTML 复杂页面的实际阅读定位、PDF 阅读器高亮、系统输入法和界面交互尚未在本测试中验证。
