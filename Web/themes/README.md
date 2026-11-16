# SimaQ CSS 主题接口

在“设置 → 外观”导入 CSS，或打开主题目录后直接修改文件。已选择的主题由文件系统监听器跟踪修改。浅色和深色主题分别绑定，外观选“跟随系统”时自动切换。主题作用于应用外框及 Markdown 正文；HTML/PDF 阅读内容保持自身样式。macOS 菜单、窗口按钮及系统文件对话框由系统绘制。

`originals/tana.css`（10,488 字节）与 `originals/tanadark.css`（13,779 字节）保留收到的原文件。`tana.css` 与 `tanadark.css` 是可选适配版，正文、标题、表格和配色来自原文件，尾部适配规则连接 SimaQ 的状态及变量。

## 稳定变量

| 范围 | CSS 变量 |
| --- | --- |
| 应用颜色 | `--bg`、`--surface`、`--sidebar-bg`、`--text`、`--muted`、`--border`、`--accent` |
| 交互 | `--link`、`--selection`、`--focus`、`--count-color` |
| 搜索 | `--search-hit`、`--search-hit-text`、`--search-current`、`--search-current-text`、`--search-row` |
| 正文 | `--body-font`、`--font-size`、`--body-color`、`--body-weight`、`--line-height`、`--content-width`、`--paragraph-before`、`--paragraph-after` |
| 标题 H1–H6 | 每级有 `--h1-font`、`--h1-size`、`--h1-weight`、`--h1-color`、`--h1-before`、`--h1-after`，将 `h1` 换为 `h2` 至 `h6` |
| 表体 | `--table-font`、`--table-font-size`、`--table-color`、`--table-background`、`--table-border`、`--table-padding` |
| 表头 | `--table-header-font`、`--table-header-size`、`--table-header-weight`、`--table-header-color`、`--table-header-background` |
| YAML | `--yaml-key`、`--yaml-value`、`--yaml-comment` |
| 外框字体 | `--sidebar-font`、`--sidebar-font-size`、`--tab-font-size` |

字号和宽度填写合法 CSS 长度，如 `16px`、`56rem`；行距可填 `1.75`；内边距可填 `.48em .8em`。设置界面修改的变量在主题之后应用，“用户 CSS 覆盖”最后应用。

## 选择器与原主题映射

| 原 Typora 接口 | SimaQ 接口与效果 |
| --- | --- |
| `#write` | 保留，指向 Markdown 阅读／编辑正文根节点 |
| `#typora-source`、`.CodeMirror` | `.sima-source-input`；全文源码使用原生文本框 |
| `#typora-sidebar` | `#sidebar`、`.sidebar`，适配版通过 `--sidebar-bg` 映射 |
| `.md-meta-block` | 保留；`.yaml-key` / `.yaml-value` / `.yaml-comment` 为分色接口 |
| `pre.md-meta-block:not(:hover)` | 适配版覆盖隐藏高度、透明文字、背景与溢出规则。折叠按钮通过显式文档状态控制，展开后保持可编辑 |
| `.md-search-hit` / `.cm-search-hit` | 保留；另支持 `.search-hit` 和 `::highlight(search-hit)` |
| `.md-search-select` | 保留；另支持 `.search-current`、`.search-hit.current`、`::highlight(search-select)` |
| `.ty-search-item-line.active` | `.hit-row.selected` / `[aria-selected="true"]`；选中行与当前命中分别使用独立颜色 |
| `--tana-*` 与 Typora 颜色变量 | 原变量保留；适配规则显式连接上表的应用变量 |

`.sq-*` 为设置、模板预览及命令面板组件类。用户自定义样式可以覆盖它们，但不应隐藏可交互控件。

示例：

```css
:root {
  --table-font-size: 12px;
  --sidebar-font-size: 13px;
  --h2-color: #426b59;
  --search-hit: #ffe0a0;
  --search-current: #725293;
  --search-row: #e0eee5;
}
```

## 本地模板

模板目录中的普通 `.md` 文件由原生端读写；随附“公司跟踪”“阅读摘录”。模板支持 `{{title}}`、`{{date}}`、`{{date:YYYY-MM-DD}}`、`{{date:YYYY-MM-DD HH:mm}}`、`{{cursor}}` 与任意自定义变量。替换使用本地日期，第一处 `{{cursor}}` 决定插入后的光标位置，后续标记移除。预览与实际插入使用同一替换逻辑。新建时显示目标目录及文件名，已有同名文件由原生端拒绝覆盖，用户可以在原对话框修改名称。

## 命令与键位

`SimaSettings.commands` 是统一命令表；每项有 `id`、`label`、`menu`、默认 `key` 与 `enabled`。当前键位通过 `SimaSettings.binding(id)` 读取。原生菜单、右键与工具条调用 `SimaSettings.execute(id, arg)`；编辑动作继续传给 shell 的 `run`。`refreshCommands()` 将最新可用状态和键位同步到系统菜单。

`handleKey(event)` 跳过输入法组合输入。搜索、模板及设置对话框保留自己的键盘操作；文本输入框的原生撤销和剪贴板快捷键不被外层拦截。快捷键录制拒绝与现有命令冲突的绑定；删除原绑定后可重新分配。导入文件是 `{ "version": 1, "bindings": { "file.save": "Cmd+S" } }`，空字符串表示清除绑定。未知命令被忽略，有冲突的导入整体拒绝。

## 桥接契约

初始化：`await SimaSettings.init({run, rpc, editor, context, toast})`。`context()` 返回 `{path, root}`。API 另有 `open(section)`、`palette()`、`template('create' | 'insert')`、`reloadThemes()`、`close()` 及 `settings`。

RPC：`getPrefs` → 偏好对象；`setPrefs({prefs})`；`menus({commands})`；`themeList` → `[{name,css}]`；`themeImport` → 可选 `{name}`；`themeFolder`；`templateList` → `[{name,text}]`；`templateFolder`；`chooseJSON` → 对象或 JSON 字符串；`saveJSON({json})`。偏好改变派发 `sima:preferences`，`detail` 为当前偏好对象。每篇文档的 YAML 折叠记忆由编辑器维护。

模板确认调用 `run('template.create', {path,text,cursor})` 或 `run('template.insert', {text,cursor})`。`cursor` 为 JavaScript UTF-16 偏移，与浏览器文本选区一致。RPC 或模板创建失败时保留输入并显示错误。
