# SimaQ

SimaQ 是一款 macOS 本地 Markdown 编辑器与资料阅读器。它沿用 Typora 的单栏编辑体验，并将多标签页、跨文件搜索、双向链接和 PDF、HTML 阅读放进同一个工作区。直接打开已有文件夹即可使用，修改保存在原 Markdown 文件中。

## 能用它做什么

- **写笔记与改表格**　在排版后的正文中点击段落即可编辑，也可切换全文源码模式。表格支持单元格编辑、增删行列，以及从电子表格粘贴矩形区域。公式和 Mermaid 图表在本地渲染。
- **搜索整个资料库**　按 `⌘⇧F` 跨文件搜索，按 `⌘F` 搜当前文档。输入“国产”或“國產”都能找到两种写法，点击结果会跳到原文。输入 `physical ai` 可找到 `physical-ai`，精确短语搜索保留分隔符。
- **在笔记与原始资料间跳转**　按 `⌘K` 查找并插入工作区文件链接。Markdown、HTML 报告和 PDF 可在不同标签页打开，PDF 链接可定位到页。笔记底部的“引用此页”列出引用段落，可点回来源。
- **整理日记与阅读界面**　用日历浏览日记，从模板创建笔记。主题可分别调整正文、表格和 YAML 的样式，也支持自定义 CSS。

首次体验可用 `⌘O` 打开仓库里的 `Samples/`，从“公司/富瀚微.md”出发，试一次表格编辑、全库搜索与跨文档跳转。更多操作见[使用说明](docs/Guide.html)和 [Markdown 支持范围](docs/Markdown-coverage.md)。

## 从源码编译成 Mac App

当前构建脚本生成 **Apple Silicon（arm64）、macOS 13.0 及以上**的应用。编译需要 Apple 的 Swift 编译器、macOS SDK，以及系统自带的 SQLite、rsync 和 codesign。安装 Xcode Command Line Tools 即可。编辑器和渲染库已随源码提供，构建可离线完成，无需 npm 安装步骤。

1. 首次配置开发环境，在终端运行以下命令，按系统提示完成安装。已有开发工具可直接检查 Swift 和 SDK。

   ```sh
   xcode-select --install
   ```

   ```sh
   xcrun swiftc --version
   xcrun --sdk macosx --show-sdk-path
   ```

2. 使用有仓库读取权限的 GitHub 账号克隆源码，然后在项目根目录构建。已有本地源码可直接执行构建脚本。

   ```sh
   git clone https://github.com/ookui/SimaQ.git
   cd SimaQ
   chmod +x scripts/*.sh
   ./scripts/build.sh
   ```

3. 构建完成后运行以下命令，或在 Finder 中将 `build/SimaQ.app` 拖到“应用程序”。

   ```sh
   open build/SimaQ.app
   ```

## 打包与测试

`./scripts/package.sh` 会重新编译并在 `release/` 下生成两项：

- `SimaQ.app` 可直接在 Finder 中双击打开。
- `SimaQ-0.2.3-macOS-arm64.zip` 包含同一份 App、使用说明和源码。

脚本会验证应用签名和 ZIP 完整性。应用采用本地临时签名，通过网络分发时，macOS 可能提示应用未经 Apple 公证。

运行自动化测试另需支持 `node --test` 的 Node.js（例如 Node.js 22）。在仓库根目录运行：

```sh
node --test Web/editor/*.test.cjs
./scripts/test-core.sh
```

在已登录的 Mac 桌面会话中，构建 App 后可运行 `./scripts/test-app.sh`，验证工作区操作、会话恢复、偏好设置和编辑流程。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `Native/` | Swift 原生应用、文件读写、SQLite 搜索索引和阅读器 |
| `Web/` | WebKit 界面、Markdown 编辑器、主题和随应用分发的渲染库 |
| `Samples/`、`Templates/` | 示例资料库与笔记模板 |
| `scripts/`、`tests/`、`benchmarks/` | 编译、打包、功能测试与性能测试 |
| `docs/` | 使用说明与编辑器实现说明 |
