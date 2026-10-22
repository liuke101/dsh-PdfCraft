# dsh-PdfCraft

![dsh-pdfcraft 横幅：一头狮子抱着鲸鱼穿过丛林的油画](docs/assets/banner.png)

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

一个 DeepSeek Harness 插件包：把 [PdfCraft](https://github.com/storytold/pdfcraft) 放进 DSH 的右侧栏，并把上游的 PdfCraft MCP 工具交给对话中的 agent——默认只允许它访问该对话自己的工作区。

工作区里的文件是人与 agent 交汇的地方。面板编辑的是磁盘上真实的 PDF；agent 通过 `pdfcraft-cli` 编辑同一个文件；在面板里执行的保存会经过版本守卫回写，因此 agent 期间做出的改动不会被悄悄覆盖。

插件包只安装一次，激活后是两个组件：**Web 组件**提供面板，**CLI 组件**为每个存活 agent 运行一个 PdfCraft 引擎。两者不共享运行时状态，配置也各自独立。

内嵌应用就是上游 PdfCraft Web 构建的原样产物。它从 profile 自己的源提供，既不是独立服务器，也不是本仓库里随代码提交的一份拷贝。

## 你会得到什么

- **一个真正的 PdfCraft 面板。** 右侧栏那一页是上游 Web 应用的 iframe，带有 PdfCraft 自己的菜单、工具栏与偏好设置。本插件不添加任何自己的原生工具栏。
- **给 agent 的 PdfCraft 工具。** 每个存活的 agent 都会在自己作用域的上下文上挂载上游 `pdfcraft-cli mcp` 服务，根目录就是它所在对话的工作区。默认是精简工具面；完整目录只差一个开关。
- **一个工作区文档。** 面板从对话的工作区读取一个工作区文档，保存时回写给它。默认情况下，agent 的工具读写同一个目录。
- **围栏。** 面板的工作区文档路由会把每个请求路径解析成真实路径，凡是落在对话工作区之外的一律拒绝。默认情况下，agent 的引擎以同一个目录作为 `--root`。
- **不需要额外服务。** 插件不占用端口，不发起任何出站网络请求，也没有需要手工配置的 MCP 行。面板的静态资源、工作区文档路由与打开通道都位于 DSH profile 自己的源上。

### 组件与行

插件 patch 插入两个 Loader 行，两者同时激活：

| 行 | 模块 | 负责什么 |
|---|---|---|
| `pdfcraft-web` | `dsh-pdfcraft`（裸包名） | 内嵌应用的静态资源与就绪报告、工作区文档的读取与回写路由、绑定注册表与推送通道服务、`/pdfcraft` 命令，以及 `pdfcraft_open` 工具。 |
| `pdfcraft-cli` | `dsh-pdfcraft/cli` | 每个 agent 的 PdfCraft 引擎及其生命周期。 |

包同时暴露两个入口：`exports["."]`（`exports["./web"]` 是它的别名）解析到 Web 组件（`dist/web/index.js`）；`exports["./cli"]` 解析到 CLI 组件（`dist/cli/index.js`）。展示文案按 specifier 解析：`locale/*.json` 同时给插件包和 `pdfcraft-web` 行定标题 `dsh-pdfcraft`；`locale/cli/*.json` 通过 `./cli/locale/*.json` 导出，给 `pdfcraft-cli` 行定标题 `dsh-pdfcraft-cli`，两者各自带自己的描述。面板页面保持自己的标题 `PdfCraft`。

Web 行保留裸包名，是因为 shell 的 `dsh-client-modules` 只从裸 Loader 行读取包的 `dsh.client` 声明。面板的浏览器半边属于这个包，因此随 Web 行一起激活：禁用 `pdfcraft-web` 会同时收回面板页面及其路由、命令与打开工具；禁用 `pdfcraft-cli` 只收回 agent 的引擎，面板照常打开、读取和回写；禁用 `pdfcraft-web` 时 MCP 工具仍可用，因为它们位于 CLI 组件。

```text
Person ── right-sidebar Panel ── iframe ──▶ PdfCraft web build (/pdfcraft/)
                  │                                │
                  │ Host Bridge (postMessage)      │ Save / Open
                  ▼                                ▼
             DSH host  ── /pdfcraft/document ──▶ Workspace Document
                  ▲                                ▲
Agent ── MCP client ── stdio ──▶ pdfcraft-cli mcp ──┘
                                --root <workspace>
```

## 已验证环境

本仓库在 **Linux x86_64** + **DSH `0.2.1-rc.1`** + **PdfCraft `0.9.0`** 上开发和验证。其它平台不在本次验证范围内。

你需要：

- 一个 DSH web profile（`dsh web`）。
- `PATH` 上有 `pnpm`，因为 `dsh plugin` 会调用它。下面的安装步骤还会用到 `git`、`curl`、`tar`，以及 `python3` 或 `unzip` 之一。
- 你的 DSH 安装所要求的 Node.js。本插件不需要构建步骤，也不需要 Rust 工具链。
- 约 150 MB 磁盘空间，用于两个上游产物。
- 一个支持 WebGPU 或 WebGL2 的浏览器——这是 PdfCraft Web 应用自身的要求。

## 1. 下载两个固定版本的上游产物

插件不附带任何 PdfCraft 代码或二进制。两个产物都来自 **PdfCraft v0.9.0** 发布，而不是本仓库：

<https://github.com/storytold/pdfcraft/releases/tag/v0.9.0>

| 产物 | 发布资产 | SHA-256 |
|---|---|---|
| 命令行引擎，Linux x86_64 | `pdfcraft-cli-0.9.0-linux-x86_64.tar.gz` | `cdba2bec4d502d016dd78101a402d07845b708c49d77bc85e0ab640aca65372b` |
| 命令行引擎，Linux aarch64 | `pdfcraft-cli-0.9.0-linux-aarch64.tar.gz` | `6a5316da69300fc30cd7355cba1c5a9c307ceb741bcce91ba0c5c835350ca0a2` |
| 命令行引擎，macOS universal | `pdfcraft-cli-0.9.0-macos-universal.zip` | `c20b8ced630417d47042ee37282fdb8362a29ebbc0b0bec3f4f635d0e28545f0` |
| Web 构建，全平台通用 | `pdfcraft-web-0.9.0.zip` | `eb465508b0623be27b07ef5145c0670c71ddd7791b4541721358b59c7e0a722e` |

这里只验证了 Linux x86_64 的命令行引擎；其它行只是为了列出同一发布中对应的资产。Web 构建与平台无关。

把适用于你平台的资产以及该发布的校验文件下载到同一个目录：

```sh
mkdir -p "$HOME/pdfcraft-download"
cd "$HOME/pdfcraft-download"

BASE=https://github.com/storytold/pdfcraft/releases/download/v0.9.0
curl -fLO "$BASE/pdfcraft-cli-0.9.0-linux-x86_64.tar.gz"
curl -fLO "$BASE/pdfcraft-web-0.9.0.zip"
curl -fLO "$BASE/SHA256SUMS.txt"
```

### 校验下载内容

`SHA256SUMS.txt` 是该发布自带的校验文件，从上面同一个 `BASE` 地址下载；它不是本仓库里的文件。只校验你实际下载的那两个产物，这样缺失的文件会直接失败，而不是被跳过：

```sh
cd "$HOME/pdfcraft-download"
CLI=pdfcraft-cli-0.9.0-linux-x86_64.tar.gz
WEB=pdfcraft-web-0.9.0.zip

grep -E "  (${CLI}|${WEB})\$" SHA256SUMS.txt | sha256sum --check
```

如果你下载的是另一个命令行资产，把 `CLI` 改成上表里的对应文件名。在 macOS 上，校验这一步用系统工具：

```sh
grep -E "  (${CLI}|${WEB})\$" SHA256SUMS.txt | shasum -a 256 -c
```

两个下载的产物都应显示为 `OK`：

```text
pdfcraft-cli-0.9.0-linux-x86_64.tar.gz: OK
pdfcraft-web-0.9.0.zip: OK
```

文件缺失会显示 `FAILED open or read`；文件损坏会显示 `FAILED`。两者都会让命令以非零状态退出。删掉坏文件重新下载，不要安装它。

上表里的 SHA-256 就是 v0.9.0 的 `SHA256SUMS.txt` 里的同一组值，这里重复列出，是为了不联网也能看到钉住的版本。

## 2. 安装命令行引擎与 Web 构建

如果你已经有一个可信的 `pdfcraft-cli`，可以跳过下面的解包，直接把 `cliPath` 指向它；Web 构建没有替代品。否则把 `pdfcraft-cli` 放到 `PATH` 上：

```sh
cd "$HOME/pdfcraft-download"
tar xzf pdfcraft-cli-0.9.0-linux-x86_64.tar.gz
mkdir -p "$HOME/.local/bin"
install -m 755 pdfcraft-cli-0.9.0-linux-x86_64/pdfcraft-cli "$HOME/.local/bin/pdfcraft-cli"
"$HOME/.local/bin/pdfcraft-cli" --version
```

最后一条命令的输出以 `pdfcraft-cli 0.9.0` 开头。如果 `$HOME/.local/bin` 不在 `PATH` 上，记下这个绝对路径，稍后在配置里赋给 `cliPath`。

把 Web 构建放到插件包默认期望的位置：

```sh
cd "$HOME/pdfcraft-download"
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$DSH_HOME/pdfcraft"
python3 -m zipfile -e pdfcraft-web-0.9.0.zip "$DSH_HOME/pdfcraft/"
mv "$DSH_HOME/pdfcraft/pdfcraft-web-0.9.0" "$DSH_HOME/pdfcraft/web"
test -f "$DSH_HOME/pdfcraft/web/index.html" && echo "web build in place"
```

这里用 `python3 -m zipfile` 是为了不依赖 `unzip`；如果你有 `unzip`，`unzip pdfcraft-web-0.9.0.zip -d "$DSH_HOME/pdfcraft/"` 同样可行。插件 patch 把 `webBuildDir` 默认设为 `$DSH_HOME/pdfcraft/web`（未设置 `DSH_HOME` 时即 `~/.dsh/pdfcraft/web`），因此这个位置无需额外配置。

如果你希望解压目录保留发布名，跳过 `mv`，在配置步骤里把 `webBuildDir` 设为 `$DSH_HOME/pdfcraft/pdfcraft-web-0.9.0` 即可。

## 3. 安装插件包

把本包装进 `web` profile：

```sh
git clone https://github.com/liuke101/dsh-PdfCraft.git
cd dsh-PdfCraft
dsh plugin --profile web add "$PWD"
```

请在 DSH 未运行时执行，或执行后重启 `dsh web`。`dsh plugin` 会在 profile 尚不存在时初始化它，加入本包，并选中该插件包。

这个命令把包装成 profile 依赖。仓库本身就是发行方式；本包不发布到 npm。

启动 DSH 并检查结果：

```sh
dsh web
```

- 插件列表里，插件包与 `pdfcraft-web` 行显示为 `dsh-pdfcraft`，`pdfcraft-cli` 行显示为 `dsh-pdfcraft-cli`。面板与 agent 工具要同时可用，两行必须都处于激活状态；但两者各自都能单独工作。
- 右侧栏只有一个 **PdfCraft** 入口：DSH-better-sidebar 插件激活时走它，否则走 DSH 自带的右侧栏。插件绝不会同时注册两者。
- 在对话里输入 `/pdfcraft` 会在独立模式下打开面板。
- agent 的工具列表里有形如 `mcp__pdfcraft-<hash>__<tool>` 的工具；`hash` 由工作区推导，对同一工作区保持不变。
- 如果 Web 构建缺失，面板会说明需要获取哪个文件，以及当前配置的目录。详见[当缺少组件时](#当缺少组件时)。

## 4. 配置

当 Web 构建位于 `$DSH_HOME/pdfcraft/web`、且 `pdfcraft-cli` 在 `PATH` 上时，默认值即可工作。需要改动时，在 profile patch 里给你要改的那一行加重写：

`$DSH_HOME/profiles/web/cordis.patch.yml`

```yaml
- id: pdfcraft-web
  name: dsh-pdfcraft
  config:
    webBuildDir: !!js dshHomePath('pdfcraft', 'web')
    openTool: true
    maxDocumentBytes: 33554432
- id: pdfcraft-cli
  name: dsh-pdfcraft/cli
  config:
    cliPath: /home/me/.local/bin/pdfcraft-cli
    staticRoot: ''
    compactSurface: true
```

profile patch **会整体替换该行的 `config` 对象**，所以要把想保留的字段都写上。上面的例子列出了两行的全部字段。除 `cliPath` 外都是出厂默认值；`cliPath` 指向上一步安装的路径。只改你需要的值，但请保留 Web 行的 `webBuildDir`（或显式设置它），不要不小心漏掉。配置改动会在 profile 重新加载时生效；若你的 profile 未启用 HMR，请重启 DSH。

### 从旧的单行迁移

0.2.0 之前，插件包只插入一行 `pdfcraft`，六个字段全在其中。拆分后，每个字段归到拥有它的组件：

| 旧行 `pdfcraft` 的字段 | 新行 | 新字段 |
|---|---|---|
| `webBuildDir` | `pdfcraft-web` | `webBuildDir` |
| `openTool` | `pdfcraft-web` | `openTool` |
| `maxDocumentBytes` | `pdfcraft-web` | `maxDocumentBytes` |
| `cliPath` | `pdfcraft-cli` | `cliPath` |
| `staticRoot` | `pdfcraft-cli` | `staticRoot` |
| `compactSurface` | `pdfcraft-cli` | `compactSurface` |

升级后，仍然指向 `- id: pdfcraft` 的 profile patch 匹配不到任何行。Loader 会警告 `patch: entry "pdfcraft" not found` 并跳过该 patch，于是插件包以默认值运行，直到你把重写挪到上面两行。旧行的值不会自动迁移过来。

### 全部配置字段

每一行只校验自己的字段；写在另一行上的字段不会被它读取。

**Web 组件（`pdfcraft-web`）**

| 字段 | 类型 | 默认值 | 作用 |
|---|---|---|---|
| `webBuildDir` | string | 由插件 patch 设为 `$DSH_HOME/pdfcraft/web`；schema 默认是空字符串 | 存放解压后 Web 构建 `index.html` 的目录。为空或写错时组件仍然挂载，但面板会显示「缺少 Web 构建」卡片，说明需要获取什么。插件永远不会自行下载 Web 构建。 |
| `openTool` | boolean | `true` | 注册人的 `/pdfcraft` 命令与 agent 的 `pdfcraft_open` 工具。设为 `false` 会同时撤销两者，并丢弃尚未送达浏览器的打开请求；已经打开的面板不受影响。 |
| `maxDocumentBytes` | integer | `33554432`（32 MiB） | 面板允许打开或保存的工作区文档上限，单位为字节。超过上限的读取或回写会被拒绝，并在消息里点明这个限制。**它不限制 agent 的工具**，那些工具直接使用上游引擎。 |

**CLI 组件（`pdfcraft-cli`）**

| 字段 | 类型 | 默认值 | 作用 |
|---|---|---|---|
| `cliPath` | string | `pdfcraft-cli`，通过 `PATH` 解析 | agent 引擎运行的 `pdfcraft-cli` 可执行文件。用绝对路径可以钉住具体版本。空值会回退到 `pdfcraft-cli`。 |
| `staticRoot` | string | `""`，即每个对话自己的工作区 | 把每个 agent 的引擎钉在这个绝对目录，而不是它所在对话的工作区。目录必须存在，否则不会启动引擎，警告里会点明该根目录。这会放弃按对话隔离；但无论哪种方式，面板都仍然被限制在对话工作区内。 |
| `compactSurface` | boolean | `true` | 提供精简的 agent 工具面：一小套核心工具，加上 `tool_search` 与 `tool_call`，由它们触达其余全部工具。设为 `false` 会暴露完整目录，上下文开销高得多。 |

每行的三个字段就是该行全部的配置面。插件 patch 把 Web 行的 `webBuildDir` 指向 Harness home；如果你通过其它方式安装本包，请显式设置它。

## 5. 使用

### 人

从对话里打开面板：

```text
/pdfcraft                          在独立模式下打开
/pdfcraft reports/quarterly.pdf    打开一个工作区文档
```

这条命令不经过模型，因此不消耗模型往返。路径可以相对于对话工作区，也可以是工作区内的绝对路径。路径解析会跟随符号链接，若真实文件落在工作区之外则拒绝。

面板始终是**一页**，标题为 **PdfCraft**，而不是每个工作区文档一页。对同一对话再次打开，会替换该对话所绑定的工作区文档，而不会新增第二页。打开面板会把右侧栏提到前面，因为 DSH 不提供静默打开。

绑定了工作区文档的面板使用宿主桥，因此 **PdfCraft 自己的 Save 会回写到工作区文档**。宿主会原子地替换文件。这包括「另存为」：当绑定了工作区文档时，面板里的保存是对该已绑定文件的回写，而不是新建工作区文件。写入之前，版本守卫会把面板加载时的版本、读取路由记录的版本，以及文件当前的 SHA-256 三者比较。如果文件在面板打开后被改动，保存会被拒绝，面板给出两个明确选项：

- **重新加载（Reload）**：显示当前文件，丢弃面板中待保存的改动。
- **仍然覆盖（Overwrite anyway）**：用面板中的字节覆盖当前文件。

不存在静默的「后写者胜」。不过 agent 并没有被锁在外面：它的工具直接写文件，因此版本守卫只保护面板的保存，并不能阻止 agent 在面板加载之后改动文件。面板在加载工作区文档时读取一次；此后 agent 做出的改动不会被推入已打开的框架，只有当面板重新加载该文档（例如重新打开）或某次保存报告冲突时才可见。

**独立模式**是没有绑定工作区文档时的面板。此时宿主桥关闭，插件从内嵌应用收不到任何东西。该状态下的保存走浏览器正常的下载路径，永远不会到达工作区。详见下面的已知限制。

### agent

agent 用 `pdfcraft_open` 工具打开面板：

```json
{ "path": "reports/quarterly.pdf" }
```

路径可选；省略即以独立模式打开。对同一对话再次打开，会替换已绑定的工作区文档。如果该对话不在屏幕上，打开请求会等待，等它出现在屏幕上时再送达；结果中，浏览器立即收取时显示 `Opened …`，需要等待对话出现时显示 `Queued …`。

agent 的 PDF 工具就是工作区对应命名空间下的上游 PdfCraft MCP 工具。它们属于 CLI 组件：禁用 `pdfcraft-cli` 会收回它们，而面板照常工作。

```text
mcp__pdfcraft-<hash>__doc_open
mcp__pdfcraft-<hash>__doc_inspect
mcp__pdfcraft-<hash>__text_extract
mcp__pdfcraft-<hash>__tool_search
```

`hash` 由 Agent MCP 根目录推导，对同一工作区保持稳定；若它是 `1a2b3c4d5e`，第一个工具就是 `mcp__pdfcraft-1a2b3c4d5e__doc_open`。一句好的提示词就足够了：

> 在 PdfCraft 面板里打开 `reports/quarterly.pdf`，然后总结第 3 页，并添加一个名为 "Summary" 的书签。

引擎生命周期：agent 出现或开始运行时启动；CLI 组件激活时若对话已经打开，也会启动。空闲五分钟后释放，下一次活动时再次启动。销毁 agent 或卸载 CLI 组件会收回引擎。没有工作区的对话不会得到引擎，只会得到一条警告。

## 当缺少组件时

两个产物各自独立地失败，插件会绕过各自的缺失继续工作。

### Web 构建缺失或位置不对

面板会把框架替换成一张标题为 **未找到 PdfCraft Web 构建**（PdfCraft web build not found）的卡片。卡片会点名需要获取的文件与发布版本、链接到该发布，并在有配置目录时显示它，还提供 **重新检查**。agent 的工具不受影响。

不打开面板也能拿到同样的信息：

```sh
# 把 3080 换成你的 DSH Web 源实际端口
curl -s http://127.0.0.1:3080/pdfcraft/status
```

该路由总是以 `200` 返回 JSON：

```json
{
  "ready": false,
  "reason": "missing-build",
  "directory": "/home/me/.dsh/pdfcraft/web",
  "file": "pdfcraft-web-0.9.0.zip",
  "release": "0.9.0",
  "releaseUrl": "https://github.com/storytold/pdfcraft/releases/tag/v0.9.0",
  "appPath": "/pdfcraft/"
}
```

`reason` 取以下之一：`not-configured`（`webBuildDir` 为空）、`missing-build`（目录不存在）、`not-a-directory`（路径存在但不是目录）、`missing-index`（目录里没有 `index.html`）、`ready`。构建缺失时直接访问 `/pdfcraft/` 会以纯文本返回同样的指引，状态码 `503`。

修复方法：把 `webBuildDir` 指向包含 `index.html` 的那个文件夹——不是发布 zip，也不是解压时多套了一层后的父目录。重启 DSH 或重新加载 profile，然后点 **重新检查**。

如果 `index.html` 存在但应用起不来，检查带哈希的 `.js` 和 `_bg.wasm` 文件是否与它同级。宿主桥打开时，面板会显示内嵌应用自己的启动错误。

### `pdfcraft-cli` 缺失

面板仍然可用，只是 agent 失去了 PDF 工具。Harness 日志会点名为该工作区启动失败的引擎；由于 MCP 桥配置为不因启动失败而中断 agent 创建，对话会照常继续。

可以直接检查：

```sh
command -v pdfcraft-cli
pdfcraft-cli --version
```

如果它不在 `PATH` 上，在 profile patch 的 `pdfcraft-cli` 行设置 `cliPath` 并重启。如果二进制存在但没有工具，检查插件列表里 `pdfcraft-cli` 是否处于激活状态；禁用该行会收回工具，但不影响面板。面板的工作区文档路由从不需要命令行工具；需要它的是 agent 的 MCP 工具。

### 打开请求被排队而不是送达

浏览器只为当前屏幕上的对话保持推送通道流。针对其它对话的请求会在宿主侧等待，等该对话下次出现在屏幕上时再送达。命令输出的文本与工具结果里的 `delivered` 字段会说明属于哪种情况。排队的请求只存在于内存中，DSH 重启即丢失。

### 路径被拒绝

- **在工作区之外**：面板会说明该路径不在本对话的工作区内。检查之前会先解析符号链接，因此放在工作区里的链接无法指向外部。
- **文件过大**：消息会点明 `maxDocumentBytes`。调高上限，或换一个更小的 PDF。
- **没有工作区**：该对话没有 `cwd`，没有可读取或保存的位置。

## 已知限制

以下都是这套设计的固有属性，不是需要报告的缺陷：

- **内嵌应用既不继承 DSH 的主题，也不继承它的语言。** PdfCraft 是一个有自己外观与偏好设置的应用。只有插件自己的文案（等待、缺失、独立模式与冲突状态）跟随 DSH 的 locale，目前提供英文与中文。
- **人与 agent 不共享同一份实时文档。** 面板里的操作与 agent 的操作只在文件被读取或写入时交汇。没有共享的内存文档，没有同时编辑，也没有对已打开框架的自动刷新。
- **独立模式会静默丢弃未保存的改动。** 宿主桥关闭时，插件从内嵌应用收不到任何东西，也无法得知存在未保存的改动。之后打开工作区文档会直接替换独立模式的框架，不会有提示。该模式下的保存通过浏览器下载，永远不会到达工作区。
- **Web 构建是体积很大的手工下载。** zip 压缩后约 14 MB，解压后约 38 MB，需要从上游发布手工获取。在它就位之前面板不可用；插件不会下载或更新它。
- **打开面板总会展开右侧栏。** DSH 的侧栏没有静默打开，因此命令与 `pdfcraft_open` 都会把该栏提到前面。
- **stdio 探测让按工作区挂载变得较重。** 每个引擎的 stdio 传输在服务进程之前都会先起一个临时探测进程。每个存活 agent 一个引擎，明显比单个静态服务器更重。`staticRoot` 可以把它降为一个共享根目录，代价是失去按对话隔离。

## 升级

- **Web 构建**：用更新的已解压发布替换 `webBuildDir` 的内容，并把 `webBuildDir` 指向它。本插件针对 `0.9.0` 测试；更新的构建仍须遵循上游的宿主桥协议（`pdfcraft:ready`、`pdfcraft:open`、`pdfcraft:save`、`pdfcraft:dirty`、`pdfcraft:failed`）。如果上游改了协议，插件也要跟着升级。
- **命令行引擎**：把 `pdfcraft-cli` 行的 `cliPath` 指向更新的 `pdfcraft-cli`。agent 工具面取决于该发布 `mcp` 模式提供什么；`compactSurface` 仍然控制是否传入 `--compact`。
- **插件本身**：在更新后的检出目录执行 `dsh plugin --profile web remove dsh-pdfcraft`，再执行 `dsh plugin --profile web add "$PWD"`，然后重启 DSH。
- **从 0.1.x 到 0.2.0**：原来的单行 `pdfcraft` 变为 `pdfcraft-web` 与 `pdfcraft-cli`。按[迁移表](#从旧的单行迁移)逐个搬移重写；旧行的 patch 会被警告并跳过，因此不会出错，但它的值不会生效。

上游版本的钉点位于 `src/shared/paths.ts`，它会被编译进 Host 构建和浏览器 bundle 两部分；更新它属于插件改动，而不是配置改动。

## 卸载

```sh
dsh plugin --profile web remove dsh-pdfcraft
rm -rf "${DSH_HOME:-$HOME/.dsh}/pdfcraft"
```

同时从 `$DSH_HOME/profiles/web/cordis.patch.yml` 中删除任何 `pdfcraft-web` 或 `pdfcraft-cli` 重写（以及 0.2.0 之前遗留的 `pdfcraft` 重写）。下载的上游产物只存在于上述目录与你的 `PATH` 中；插件不保留其它状态。你编辑过的 PDF 仍留在各自的工作区里。

## 开发

两个 Host 入口与浏览器半边都是 TypeScript。`npm run build` 会清空 `dist/`，用 `tsc` 编译 Host，再用 `tsdown` 把浏览器半边打包进 shell 的 module-loader 信封，因此克隆后无需工具链即可安装，已经删除的源码也不会留下陈旧产物。改 `src/`，永远不要改 `dist/`，并且两者都要提交。

Web 行保留裸包说明符（`dsh-pdfcraft`）。shell 的 `dsh-client-modules` 只从裸 Loader 行读取包的 `dsh.client` 声明，因此 `exports["."]` 指向 Web 组件入口，`exports["./web"]` 为直接导入命名同一个模块。名为 `dsh-pdfcraft/web` 的行会加载 Host 半边，却不会贡献浏览器 bundle，而且悄无声息。CLI 行使用 `dsh-pdfcraft/cli` 子路径，因为它没有浏览器半边。

```sh
npm run build                     # 清空 dist/，tsc 编译 Host，再用 tsdown 打包浏览器 bundle
npm test                          # 全部测试，node:test
npm run typecheck                 # 对 Host 和浏览器半边分别执行 tsc --noEmit
node --test test/document-routes.test.ts   # 单个测试套件
```

测试只用 Node 内置的测试运行器与断言库。Node 24 会剥离测试文件与 TypeScript 源码中的类型，因此测试套件直接跑 `src/`，无需转译步骤。浏览器 bundle 通过伪造的 `__ModuleLoader__` 做一次形状测试；宿主桥、推送通道与拒绝判定都是 `src/web/client/protocol.ts` 里的纯函数，直接驱动。TypeScript 编译器、`tsdown` 与 `@types/node` 与其它开发依赖一起精确钉版。`.github/workflows/check.yml` 会在每次推送和拉取请求时构建、在提交的 `dist/` 过期时失败、对两份配置做类型检查并运行测试套件。

把保存变成回写的胶水逻辑靠手工验证，流程见 [docs/agents/e2e-verification.md](docs/agents/e2e-verification.md)。

```text
src/
  web/index.ts        Web 组件入口：配置、HTTP 路由、路由接线
  web/client/         浏览器半边：页面注册、宿主桥、推送通道流
  web/client/protocol.ts  纯桥接、推送与拒绝判定
  web/web-build.ts    静态资源与就绪路由
  web/workspace-document.ts  围栏、大小限制、版本守卫、绑定注册表
  web/document-routes.ts  工作区文档的 HTTP 面
  web/panel-opens.ts  推送通道判定、/pdfcraft 命令、pdfcraft_open 工具
  web/open-routes.ts  推送通道的 SSE 适配
  web/http.ts         共享的查询解析与响应写入
  cli/index.ts        CLI 组件入口：配置与引擎生命周期接线
  cli/agent-tools.ts  按 agent 的 MCP 引擎生命周期
  cli/host.ts         CLI 组件用到的那部分宿主上下文
  shared/host.ts      两个组件入口共享的宿主上下文类型
  shared/paths.ts     公开路由、响应头与版本钉点（编译进两半）
  shared/protocol.ts  绑定、打开请求与拒绝码类型
dist/
  web/index.js        已提交的 Web 组件构建；裸 Loader 行导入的就是它
  web/client.js       已提交的浏览器 bundle；shell 加载的就是它
  cli/index.js        已提交的 CLI 组件构建；子路径 Loader 行导入的就是它
locale/               插件列表文案：locale/*.json 给 Web 行和插件包定标题，locale/cli/*.json 给 CLI 行定标题；面板文案在 src/web/client/copy.ts
cordis.patch.yml      插件 patch：两个组件行
test/                 node:test 测试套件，每个接缝一个
docs/adr/             架构决策记录
docs/assets/          文档配图，例如 README 横幅
GLOSSARY.md           领域词汇表
```

四篇 ADR 解释了：为什么面板提供原样的应用、为什么打开走推送通道、为什么引擎按工作区挂载、为什么两个组件共用一个可安装的包：

- [ADR-0001：提供未经修改的 Web 构建，并以工作区文件为唯一事实来源](docs/adr/0001-unmodified-web-build.md)
- [ADR-0002：用自建推送通道打开面板](docs/adr/0002-push-channel.md)
- [ADR-0003：在工作区根围栏下按工作区挂载引擎](docs/adr/0003-per-workspace-engine.md)
- [ADR-0004：把面板与引擎作为一个可安装包里的两个组件激活](docs/adr/0004-two-components-one-package.md)

这些文档使用的领域词汇见 [GLOSSARY.md](GLOSSARY.md)。

## 许可证

本插件以 [MIT 许可](LICENSE) 发布。PdfCraft 是另一个独立项目，采用其自身的 MIT/Apache-2.0 许可；本仓库不包含它的任何代码或二进制。
