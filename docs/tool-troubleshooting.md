# 工具使用问题排查记录

- 记录日期：2026-10-25
- 环境：Windows、DSH `workspace-write` 沙箱、Node.js v24.19.0
- 场景：把 `lvl-converter.html` 拆分为 HTML / CSS / JS 后，验证行为没有变化
- 结论：浏览器和 npm 的两次失败都是**运行环境限制**，不是页面代码问题；最终用 Node + 轻量 DOM shim 完成回归测试

## 1. 问题概览

| # | 现象 | 根本原因 | 处理方式 |
|---|---|---|---|
| 1 | PowerShell 报 `Read-Content` 不是命令 | 命令名拼错 | 改用 `Get-Content` / `read` 工具 |
| 2 | 无头 Edge 启动失败，`--dump-dom` 输出 0 字节 | Crashpad 在 DSH 沙箱内 `OpenProcess` 被拒绝 | 不继续堆参数，改用 Node 测试 |
| 3 | `npm view jsdom` 报 `EPERM` | npm 缓存目录在工作区外，被沙箱拒绝写入 | 不安装第三方依赖，改用内置 API |
| 4 | 无法做真实浏览器 E2E | 未找到可调用的 Chrome / Playwright 浏览器 | 用 DOM shim 覆盖真实脚本的 DOM 契约 |

## 2. 问题一：PowerShell 命令拼写错误

### 现象

在一条组合命令里误写了：

```powershell
Read-Content .\index.html
```

PowerShell 返回：

```text
Read-Content : The term 'Read-Content' is not recognized as a name of a cmdlet ...
```

前面的 `Get-ChildItem` 已经正常输出，错误只影响组合命令的后半段。

### 处理

改用正确的 `Get-Content`；后续需要完整查看文件时，改用 `read` 工具，避免用 shell 输出代替文件读取。

### 经验

- 工具报“命令不存在”时，先检查拼写和命令所属模块，不要怀疑目标文件。
- 组合命令里一处拼写错误会让整条命令返回非零，但不代表前面的步骤失败；要看具体报错行。

## 3. 问题二：无头 Edge 无法启动

### 现象

尝试用无头 Edge 做真实浏览器验证：

```powershell
& $edge --headless=new --disable-gpu `
  --allow-file-access-from-files `
  --user-data-dir=$profile `
  --virtual-time-budget=6000 `
  --dump-dom $uri
```

第一次执行时 `--dump-dom` 输出为空，DOM 长度为 0。取消 stderr 重定向后看到：

```text
crashpad_client_win.cc:457] OpenProcess: 拒绝访问。 (0x5)
```

退出码为 `-2147483645`。

### 已尝试但无效的参数

```text
--headless
--no-sandbox
--single-process
--disable-gpu
--disable-crash-reporter
--disable-breakpad
--disable-dev-shm-usage
```

### 判断

错误发生在 **Crashpad 启动阶段**，不是页面加载阶段：

- `OpenProcess: 拒绝访问` 说明 Edge 的崩溃上报组件无法打开进程句柄。
- 这通常是外层沙箱 / 受限作业对象的限制。
- 浏览器未能正常完成启动，所以 `--dump-dom` 没有输出。

因此这不是 `lvl-converter.html` 的 JS 错误，继续增加 Chromium 参数也不会解决外层限制。

### 处理

没有为了测试去提升沙箱权限，而是放弃真实浏览器路径，改用 Node 执行页面脚本。

### 经验

- 先看错误发生的**阶段**：浏览器启动失败 ≠ 页面脚本失败。
- 看到 `crashpad`、`OpenProcess`、`EPERM` 这类关键词时，优先怀疑宿主环境。
- 不要用“扩大权限”解决一个本来可以用更轻量方式绕过的测试问题。

## 4. 问题三：npm 缓存写入被沙箱拒绝

### 现象

曾考虑用 jsdom 做 DOM 测试：

```powershell
npm view jsdom version --fetch-timeout=15000 --fetch-retries=0
```

返回：

```text
npm error code EPERM
npm error syscall open
npm error path C:\Users\...\AppData\Local\npm-cache\_cacache\tmp\***
[sandbox: file access denied under workspace-write mode]
```

### 判断

这不是 npm registry 网络失败，而是 npm 试图写入工作区外的缓存目录，被 `workspace-write` 沙箱拒绝。

可选方案有两种：

1. 把 npm 缓存和安装目录都放到工作区内；
2. 提升沙箱权限。

### 处理

两个都没有采用。为了验证一个纯前端页面，引入 jsdom 及其依赖树不值当，而且会污染项目。最终只用 Node 内置模块完成测试。

### 经验

- `EPERM` 要先看**具体路径**，它经常是“没有写权限”，不是“没有网络”。
- 测试依赖应该尽量为零；能用内置 API 解决，就不新增 `node_modules`。

## 5. 最终方案：Node + 轻量 DOM shim

### 思路

页面逻辑是普通 classic script，不依赖打包器。可以把真实的 `js/lvl-converter.js` 放进 Node 的当前上下文执行，同时伪造它用到的那部分浏览器 API：

- `document.getElementById`
- `document.createElement` / `createTextNode` / `createDocumentFragment`
- `element.appendChild` / `textContent` / `classList` / `dataset`
- `addEventListener` / `dispatchEvent`
- `window.innerWidth`
- `getComputedStyle`
- `window.showSaveFilePicker`（保存路径打桩）

不需要模拟真实布局和渲染，只需要保证脚本访问的 DOM 接口行为正确。

### 加载真实脚本

`fakeDocument` 是伪 DOM 对象，提供本节列出的接口。`js/extjson.js` 是 UMD 格式，可以直接 `require`：

```js
globalThis.window = globalThis;
globalThis.document = fakeDocument;
globalThis.ExtJson = require('./js/extjson.js');

const code = fs.readFileSync('./js/lvl-converter.js', 'utf8');
vm.runInThisContext(code, { filename: 'js/lvl-converter.js' });
```

### 模拟拖放打开文件

页面监听的是 `drop` 事件，并且只读取 `e.dataTransfer.files[0]`，所以不需要真实的 `File` 和 `DataTransfer`：

```js
const file = {
  name: 'test.json',
  async arrayBuffer() {
    return new TextEncoder().encode(jsonText).buffer;
  },
};

window.dispatchEvent({
  type: 'drop',
  preventDefault() {},
  dataTransfer: { files: [file] },
});
```

### 测试 gzip

用 Node 的 `zlib` 生成真实的 `.lvl` 字节流：

```js
const gz = new Uint8Array(zlib.gzipSync(Buffer.from(text, 'utf8')));
```

页面内部使用浏览器标准的 `DecompressionStream` / `CompressionStream`，Node 24 已内置这些 API，因此可以走真实的解压、压缩路径。

### 测试保存

把文件选择器替换成内存写入：

```js
let saved = null;

globalThis.showSaveFilePicker = async () => ({
  async createWritable() {
    return {
      async write(blob) { saved = blob; },
      async close() {},
    };
  },
});
```

点击“保存文件”后，对拿到的 `Blob` 做 gzip 魔数检查和 `gunzip` 回读。

### 覆盖的 26 项断言（9 组场景）

1. 检查 HTML 中的 id，并确认 JS 里 19 个 `$('...')` 引用都能找到对应元素。
2. `ExtJson` 正确加载。
3. 打开 JSON：状态、编辑器内容、格式、文件名、保存按钮、字段面板。
4. 字段列表行数、计数文本。
5. 选中 `0.a`，新值输入框自动填充为 `1`。
6. 修改为 `42`，编辑器和状态栏同步更新。
7. 删除字段，选中状态清空。
8. 打开 `.lvl` gzip 文件，状态显示“gzip 压缩”，编辑器内容正确。
9. 保存 `.lvl`，输出以 `31 8B` 开头，`gunzip` 后与原文一致。

最终结果：

```text
26/26 passed
```

### 局限性

- 这不是真实浏览器：没有真实 CSS 布局、真实 `File`、真实文件选择器。
- 但它执行的是**生产环境的真实脚本**，走的是真实的 gzip 流和真实的 DOM 调用路径。
- 真实浏览器的视觉/布局问题仍需在普通桌面浏览器里手动确认；本次只验证行为回归。
- 当时的 harness 是临时文件，验证后删除了；后来重做成工作台布局（`js/lvl-shell.js`），这笔账变了——
  分割条拖拽、面板停靠、布局持久化这类状态机最容易静默回归，所以 harness 现在保留为
  `tools/layout-test.mjs`（解析真实 `lvl-converter.html`，按页面顺序执行脚本，可在多个窗口宽度下跑）。
- 完整 harness 约 180 行，核心是伪 DOM 和事件模拟；上面的代码片段只展示关键接口。

## 6. 拆分重构本身的验证

除了交互测试，还做了三层静态校验：

1. **内容比对**：拆分时先做内容比对，CSS / JS 与原文对应块完全一致（`CSS exact: True`、`JS exact: True`）；之后仅去掉 CSS 统一的 2 空格缩进，未改任何选择器或声明。
2. **语法检查**：`node --check js/lvl-converter.js` 通过。
3. **引用检查**：
   - `lvl-converter.html` 只引用 `css/lvl-converter.css`、`js/extjson.js`、`js/lvl-converter.js`；
   - JS 中 19 个 `$('id')` 全部能在 HTML 中找到；
   - 没有遗留 `<style>` 或内联页面脚本。

## 7. 经验总结

1. **先区分环境问题和代码问题。** 浏览器起不来、npm 写不了缓存，都不等于页面有 bug。
2. **读完整错误，不只看退出码。** 本次关键信息是 `crashpad`、`OpenProcess` 和 `EPERM` 的具体路径。
3. **不要盲目重试参数。** 已经确认是外层沙箱限制后，继续加 Chromium flags 只会浪费时间。
4. **测试手段要匹配约束。** 没有浏览器和第三方库时，Node + DOM shim 是足够好的替代方案。
5. **重构先用机械方式证明“内容没变”，再证明“行为没变”。** 前者用内容比对，后者用交互断言。
6. **测试结束要清理，但值得长期保留的回归测试要落到 `tools/`。** 临时测试页、备份文件、一次性脚本都应删除；
   反过来，覆盖真实交互状态机的 harness 留着比每次重写好——判断标准是“这段逻辑以后还会改吗”。

## 8. 可复用检查清单

```text
[ ] 错误信息来自目标程序，还是来自启动器/测试工具？
[ ] 退出码之外，日志里有没有更具体的阶段信息？
[ ] 是否真的需要安装依赖或提升权限？
[ ] 能否用语言/平台内置 API 替代？
[ ] 测试是否加载了真实生产文件，而不是复制品？
[ ] 是否覆盖了成功路径和至少一个失败/边界路径？
[ ] 测试后临时文件是否清理干净？
[ ] 最终工作区状态是否符合预期？
```
