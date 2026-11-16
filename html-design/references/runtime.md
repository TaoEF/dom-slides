# 安装与本地运行环境

## 两个目录，两个用途

安装的 `dom-slides` skill 提供 `SKILL.md`、`references/` 和 `editor.js` 等技能资源；它不等于完整项目。可读取其中 `editor.js` 的原文内嵌到新 HTML，使编辑器逻辑随文件携带。不要在该目录执行项目运行命令，也不要假定它的上级有项目依赖。

本地服务、协作、文字测量和 PDF/PPTX 导出命令需要**完整源码根目录**：其中有根 `package.json`、`package-lock.json`、`html-design/server.mjs`、`html-design/collaborate.mjs` 和安装后的 `node_modules/`。以下命令均从这个根目录执行，命令中的 `html-design/` 是源码子目录，不是任意已安装 skill 的路径。

## 取得源码与依赖

先查找用户工作区内是否已有匹配的 `TaoEF/dom-slides` 源码目录，核对仓库来源和上述文件，优先复用。不要把其他项目的 `package.json` 当作本项目。不要重新克隆覆盖已有目录或用户稿件。

没有可用源码时，在用户工作区选择一个**尚不存在的新目录**，例如：

```sh
git clone https://github.com/TaoEF/dom-slides.git /absolute/workspace/dom-slides
cd /absolute/workspace/dom-slides
npm ci
```

运行项目需要预先安装 Node.js 20+ 和 npm；`npx skills` 不负责安装 Node.js。技能安装 CLI 自身目前要求 Node.js 22.20+，见 [官方安装说明](https://github.com/vercel-labs/skills#install-a-skill)。只安装 skill 不会自动安装本项目的 Node 依赖或浏览器。

macOS 自动使用标准路径已安装的 Google Chrome。没有可用系统 Chrome 时，在源码根目录安装 Playwright 对应浏览器：

```sh
npx playwright install chromium
```

也可通过 `HTML_DESIGN_CHROME` 指定浏览器可执行文件；启动服务和测量命令须继承此设置。需要更新源码或构建时先核对工作区修改；`npm run build` 只更新源码中的 `html-design/editor.js`，不会升级已有设计内嵌脚本。已有稿升级仍走 [协作交接](collaboration.md)。

## 启动或复用服务

先检查该源码根目录是否已有服务。复用它的实际地址，不要同时启动多个服务写同一根目录。没有服务时运行：

```sh
npm start
```

默认地址为 `http://127.0.0.1:8876`，服务根目录是启动时的源码根目录。端口被占用时先辨明现有服务；如需独立端口，可用 `PORT=8878 npm start`。这只改变监听端口，不改变服务根目录。

将新设计写入该根目录内一个新的文件，例如 `designs/proposal.html`，先创建需要的子目录并避免覆盖同名稿件。浏览器打开 `http://127.0.0.1:8878/designs/proposal.html`（以实际端口为准）。只有位于该服务根目录内、经服务打开的文件才能使用自动回写和协作连接；skill 安装目录或其他工作区中的文件不会自动归入服务。

在执行协作或文字测量命令的终端，将 `HTML_DESIGN_ORIGIN` 设为**实际已运行服务的 origin**，不要包含文件路径：

```sh
export HTML_DESIGN_ORIGIN=http://127.0.0.1:8878
node html-design/collaborate.mjs begin designs/proposal.html
```

非默认端口的 `commit` / `cancel` 也须沿用相同 origin；不能拿一个服务的会话提交到另一个服务。先完成研究和构建，再申请短期 AI 接管；只修改返回的工作副本，提交或取消后结束接管。完整参数见 [协作说明](collaboration.md) 和 [文字测量](text-measurement.md)。纯内联 HTML 与系统字体的文字测量不必启动资源服务，但仍需在完整源码根目录安装依赖与浏览器。

## 仅做文件导出

从已保存 HTML 生成文件不必启动常驻预览服务：在完整源码根目录运行 `node html-design/export-cli.mjs pptx input.html --output result.pptx`，或将格式改为 `pdf`。CLI 默认临时服务以输入目录为资源根，输入不必放在源码根内；这是只读导出，不提供协作连接或写回。已有服务提供原资源时可用 `--base-url`。完整参数及文件保护见 [文件导出](export-cli.md)。

## 离线边界

内嵌编辑器无需在线脚本 CDN，可离线普通编辑、撤销和浏览器打印。明确使用「导出 → 下载 HTML」时，编辑器会读取当前引用的图片、CSS、字体和脚本并内联，生成可移出项目目录的单文件；读取失败或遇到暂不支持的媒体嵌入时会停止下载并提示原因。普通保存和源码下载保留源文件引用，不保证单文件可离线还原。

自动回写、跨窗口写权限协调、AI begin/commit 和私有 Undo/Accept，以及编辑器内直接下载 PDF/PPTX 依赖运行中的常驻本地服务；文件 CLI 只需安装好的源码依赖和浏览器，按需启动临时只读资源服务。私有审阅基线留在源码根目录的 `.html-design/reviews/`，不会随下载 HTML 携带；离线下载不能撤回服务端 AI 提交。

保存快照的布局与文字对比度诊断可用 `node html-design/qa.mjs check input.html`；它会临时服务输入目录内的资源，不必启动完整编辑服务。AI 工作副本可用原稿 loopback `--base-url`。对比度引擎 axe-core 为源码运行时的锁定本地依赖，由 `npm ci` 安装，不走 CDN；安装 skill 目录本身不是完整 QA 运行时。见 [QA 契约与覆盖边界](qa.md)。
