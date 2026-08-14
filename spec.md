# PowerShell / Bash 客户端下一阶段规格

状态：Draft 1  
范围：`clients/software-atlas.ps1`、`clients/software-atlas.sh` 及其使用的公开静态元数据  
目标：两个单文件客户端无需检出项目，即可同步网站 catalog、在终端查询软件，并生成同一协议的本机清单交给网页展示。

## 1. 产品边界

客户端只读取本机包管理器状态和公开静态 JSON。它们不安装、卸载或升级软件，不执行 catalog
中的安装声明，不上传 inventory，不启动后台服务，也不依赖 Cloudflare Worker、Pages Functions、
数据库或账号系统。

PowerShell 与 Bash 的命令、缓存语义、错误分类和 JSON 输出必须一致；平台差异只允许出现在本机
采集器中：PowerShell 采集 Scoop 与 Chocolatey，Bash 采集 Homebrew Formula 与 Cask。Winget
在其官方 catalog 接入后加入 PowerShell，不在本阶段伪造匹配。

## 2. 命令行接口

逻辑命令固定为：

```text
software-atlas sync
software-atlas search <query>
software-atlas info <software-id|name>
software-atlas inventory
software-atlas help
```

PowerShell 使用 PowerShell 风格参数，Bash 使用 GNU 长参数，但语义必须一一对应：

| 语义 | PowerShell | Bash |
| --- | --- | --- |
| 网站根地址 | `-SiteUrl` | `--site-url` |
| 本地 catalog 根目录 | `-CatalogPath` | `--catalog-path` |
| 缓存目录 | `-CacheDir` | `--cache-dir` |
| 强制重新验证 | `-Refresh` | `--refresh` |
| 禁止网络 | `-Offline` | `--offline` |
| JSON 标准输出 | `-Json` | `--json` |
| inventory 输出 | `-Output` | `--output` |
| 不打开浏览器 | `-NoOpen` | `--no-open` |
| URL 字符上限 | `-MaxUrlLength` | `--max-url-length` |

地址优先级为：命令行参数、`SOFTWARE_ATLAS_URL`、脚本内发布默认值。正式发布默认值确定前继续使用
`http://127.0.0.1:4173`。`-CatalogPath`/`--catalog-path` 与远程网站互斥；本地模式不得产生网络请求。

## 3. 命令行为

### `sync`

1. 获取 `/metadata/v1/current.json`。
2. 校验协议版本、manifest 字节数和 SHA-256。
3. 获取当前 manifest，随后同步 `search.json` 和本平台需要的 inventory 索引。
4. 文件先写入同目录临时文件，解析、字节数和 SHA-256 全部通过后原子替换。
5. 完整成功后切换本地 `current.json`，再删除旧 catalog 数据；失败时继续保留旧缓存。
6. 相同 snapshot 已完整缓存时不重复下载；`--refresh` 重新验证入口和必需文件。
7. 服务端在两次请求之间更新导致旧路径返回 404 时，允许重新读取 `current.json` 并完整重试一次。

`--offline` 与 `sync` 同时使用应返回参数错误，不得假装同步成功。

### `search <query>`

- 缓存不存在时自动执行一次 `sync`；`--offline` 时改为明确报错。
- 搜索名称、别名、包名、命令和简介，规则与网页保持接近但不要求评分完全相同。
- 默认显示前 20 条：软件名称、简介、平台、包管理器和稳定软件 ID。
- `--json` 输出稳定字段的 JSON 数组，不输出进度文字到 stdout。
- 空查询属于参数错误；无结果属于成功，退出码为 0。

### `info <software-id|name>`

- 优先按稳定软件 ID 精确匹配，再按规范化名称精确匹配。
- 名称匹配到多个实体时列出候选并要求使用 ID，不自动选择。
- 根据搜索项的 `shard` 只下载一个 `details/<hh>.json`。
- 显示软件用途、官网、源码、许可证、平台，以及每个包管理器的包名、版本、来源集合、安装命令和状态。
- `--json` 输出该详情分片中的单个逻辑详情对象。

### `inventory`

- 始终先采集本机状态并写入格式化的 inventory v1 文件；默认文件名为 `inventory.json`。
- 文件必须为 UTF-8 无 BOM、2 空格缩进、末尾换行、稳定包排序。
- 尝试使用本地 catalog inventory 索引匹配软件；缓存不存在时允许自动同步，失败不能阻止 JSON 文件生成。
- 终端显示已识别软件的名称、用途、已安装版本和来源，并单独列出未识别项目。
- 始终构造 `#inventory=v1.base64.<base64url>`。完整 URL 不超过阈值时打开该地址；超限时打开普通 `/inventory`。
- 无论是否自动打开，都打印 JSON 绝对路径，并提示用户可以在网站中选择或拖入文件。
- `--no-open` 只禁止打开浏览器，不影响文件生成、匹配或终端结果。
- 网页读取 Fragment 后立即用 `history.replaceState` 清除地址栏数据；解析失败仍显示文件导入入口。

## 4. 缓存布局

默认缓存根目录：

- Windows：`%LOCALAPPDATA%/SoftwareAtlas/cache/v1/`
- macOS：`~/Library/Caches/software-atlas/v1/`
- Linux：`${XDG_CACHE_HOME:-~/.cache}/software-atlas/v1/`

目录协议：

```text
v1/
├── current.json
├── state.json
└── catalog/
    ├── manifest.json
    ├── search.json
    ├── inventory/scoop.json
    ├── inventory/chocolatey.json
    ├── inventory/homebrew.json
    └── details/00.json ... 按需出现
```

`state.json` 只记录 schemaVersion、snapshotId、base URL、同步时间和已验证文件的相对路径、字节数、
SHA-256；不得记录本机软件、用户名、主机名或其他身份信息。缓存只保留当前成功版本。并发运行使用
缓存根目录中的互斥锁；锁超时后退出，不并发写同一文件。

## 5. 下载与完整性

- 远程路径只能来自同源 `current.json` 和 manifest；拒绝 `..`、绝对路径、协议切换和跨源 URL。
- 每个文件必须同时校验 HTTP 成功、JSON 可解析、声明字节数和 SHA-256。
- PowerShell 使用平台内置 HTTP、JSON 和 SHA-256 能力。
- Bash 下载使用 `curl`；哈希优先 `sha256sum`，其次 `shasum -a 256`。
- Bash JSON 解析后端依次选择 `jq`、`python3`、macOS 系统自带可用解析能力；均不可用时给出安装建议和非零退出码，不用正则表达式假装完整解析 JSON。
- 进度和诊断写 stderr；结构化 `--json` 结果只写 stdout。

## 6. 本机采集与隐私

允许字段只有 inventory v1 已定义的系统类型、架构、管理器、集合、包名、版本、安装范围和可选路径。
第一版默认不写路径。禁止用户名、主机名、序列号、IP、MAC、完整环境变量、Runner 临时目录以及
包管理器凭据。采集命令只能读取状态：Scoop `export`、Chocolatey 本机列表和 Homebrew
Formula/Cask 列表；任何采集器失败都要显示管理器级诊断，并继续处理其他管理器。

## 7. 退出码

```text
0  成功；search 无结果也属于成功
2  参数或命令错误
3  网络不可用或远程入口不可用
4  JSON、Schema、字节数或哈希验证失败
5  缓存不可用、损坏或被锁定
6  本机采集完全失败
7  查询对象不存在或名称存在歧义
```

inventory 只要成功写出有效 JSON，即使 catalog 同步或匹配失败也返回 0，并把降级原因写到 stderr。

## 8. 测试与验收

- 同一 fixture 在 PowerShell 与 Bash 中产生语义相同、格式化一致的 inventory。
- Fragment 可往返解码；阈值内打开带 Fragment 地址，阈值外回退普通页面，文件始终存在。
- 覆盖首次同步、缓存命中、强制刷新、离线命中、离线缺失、损坏缓存、哈希错误和快照切换。
- 验证 `info` 只读取一个详情分片，inventory 只读取本机涉及的 manager 索引和详情分片。
- 验证网络路径不能逃逸 catalog 根目录，缓存中不存在机器身份信息。
- Windows PowerShell 5.1 与 PowerShell 7 均执行 fixture 和 Scoop/Chocolatey 采集测试。
- macOS Bash 3.2 执行 fixture 和 Homebrew Formula/Cask 采集测试；Linux Bash 执行协议与错误测试。
- 网页自动导入、地址清理、文件导入、未知软件和 catalog 不可用降级均有浏览器测试。
- 完整验收不需要 Node.js、项目源码、Git 或常驻进程；除系统自带命令和本节明确列出的 Bash JSON
  解析后端外，只需要单个客户端脚本和可访问的静态网站。

## 9. 非目标

- 本阶段不接入 Winget、APT、DNF、pacman、APK、Zypper 的本机采集。
- 不实现软件安装、升级、卸载、后台自动同步或定时任务。
- 不通过 URL 查询参数、表单 POST、日志或第三方服务上传 inventory。
- 不把完整 catalog 嵌入脚本，也不要求用户克隆仓库。
- 不为两个脚本设计不同的功能子集；无法在某平台支持的仅限包管理器采集器。
