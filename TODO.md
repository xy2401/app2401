# 软件源地图 TODO

这份清单记录下一阶段建议。排序原则不是“来源越多越好”，而是优先增加能解释软件是什么、如何使用、由什么提供的公开元数据。

## 边界与原则

- [ ] 只同步清单、索引、文档和描述，不镜像安装包、容器镜像、源码压缩包或二进制文件。
- [ ] 每个来源都记录许可证、维护主体、来源 URL、快照标识、采集时间、记录数和原始记录链接。
- [ ] 来源允许精选和不完整，但必须准确说明覆盖边界，不能把精选仓库描述为完整生态。
- [ ] 所有脚本、安装声明和命令示例只作为文本解析，永不在构建器中执行。
- [ ] 新来源先做体量与字段分析，通过后再加入正式快照；优先浅克隆、稀疏检出或官方 JSON API。
- [ ] 元数据保持普通 UTF-8 JSON，并继续使用不可变快照、哈希校验和按需分片。
- [ ] v1 只增加可选字段；任何破坏性协议变化进入 `/metadata/v2/`。

## P0：让现有数据真正可独立使用

### PowerShell 本机清单工具

- [ ] 实现独立下载即可运行的 `software-atlas.ps1`，不要求检出项目。
- [ ] 识别 Scoop 和 Chocolatey 已安装包，生成符合 `inventory-v1.schema.json` 的 JSON。
- [ ] 支持 `--json`、`--catalog <URL|PATH>`、`--refresh`、`--offline` 和缓存目录选项。
- [ ] 根据 `current.json`、manifest 和 SHA-256 只下载所需索引与详情分片。
- [ ] 终端显示软件名称、用途、版本、包管理器和未识别项目。
- [ ] 默认不收集用户名、主机名、序列号、IP 或其他机器身份信息。

验收：在没有 Node.js、没有项目源码的 Windows 环境中，单个 PS1 能完成同步、识别和离线复用缓存。

### Bash 本机清单工具

- [ ] 实现独立下载即可运行的 `software-atlas.sh`，第一版识别 Homebrew Formula 与 Cask。
- [ ] 与 PowerShell 使用同一份 catalog、同一缓存规则和同一 inventory v1 输出。
- [ ] 终端输出、`--json`、本地 catalog、离线模式和隐私约束与 PowerShell 对齐。

验收：macOS 上单个 Bash 文件可以运行；网页能够无差别导入 PS1 与 Bash 生成的清单。

### 元数据同步与缓存协议

- [ ] 写明脚本端缓存目录结构、条件请求、哈希验证、失败回滚和旧快照清理策略。
- [ ] 增加“给脚本用的最小引导文件”，仅包含当前快照位置、协议版本和完整性信息。
- [ ] 为远程 catalog、本地 catalog、损坏分片、断网和快照切换增加集成测试。
- [ ] 生成 `checksums.txt` 或等价机器可读校验清单，方便非 JavaScript 客户端实现。

## P1：优先增加的元数据源

### AppStream：Linux 桌面软件资料

- [ ] 先接入 Freedesktop AppStream XML/YAML 元数据规范和一个官方发行版的 AppStream 索引。
- [ ] 提取软件名称、摘要、长描述、官网、开发者、许可证、图标引用、截图引用、分类、桌面文件 ID 和包名映射。
- [ ] 图标与截图第一版只保留 URL/引用，不批量下载媒体文件。
- [ ] 用包名、桌面文件 ID、官网和源码地址保守关联现有软件实体。

价值：这是下一项最推荐的数据源，能显著改善“软件是什么”的描述，并帮助未来 Linux 包名关联。

验收：至少一个发行版的 AppStream 元数据可复现构建；网页详情能展示中文界面下的原文描述和来源归属。

### Winget 官方清单

- [ ] 接入 Microsoft `winget-pkgs` 官方社区清单，优先使用仓库索引或稀疏检出 manifests。
- [ ] 提取 PackageIdentifier、名称、发布者、描述、标签、协议、安装器类型、架构、范围、命令、依赖、官网和许可证。
- [ ] 不下载 installer URL 指向的文件，不执行安装器或 manifest 命令。
- [ ] 增加 `winget` manager、安装命令和 Windows inventory 匹配。

价值：补齐 Windows 官方默认包管理器，与 Scoop、Chocolatey 形成很有用的交叉对照。

验收：可按 PackageIdentifier 稳定寻址；PS1 能识别 `winget list` 输出并关联软件。

### Debian/Ubuntu APT 官方包索引

- [ ] 不使用 Docker 拉取发行版镜像；直接下载官方仓库的 `InRelease/Release` 与压缩 `Packages` 索引。
- [ ] 验证 Release 哈希；记录发行版、版本、组件、架构和仓库快照。
- [ ] 提取 Package、Version、Architecture、Description、Homepage、Depends、Provides、Section、Priority 和 Source。
- [ ] 按 suite/component/architecture 独立分片，避免把重复架构记录全部塞进搜索索引。

验收：先完成一个 Ubuntu LTS 或 Debian stable 的 amd64 主仓库；不下载任何 `.deb`。

### Fedora/RHEL 系 DNF 官方仓库元数据

- [ ] 直接读取官方 `repomd.xml`、primary/filelists/comps 元数据，不拉取容器镜像和 RPM。
- [ ] 校验 repomd 中的 checksum，记录仓库、发行版、架构与 revision。
- [ ] 提取名称、摘要、描述、URL、许可证、依赖、provides、文件/命令映射和软件组。

验收：先完成一个当前 Fedora 版本的 x86_64 官方仓库，并能回答“哪个包提供某个命令”。

## P2：Linux 覆盖扩展

- [ ] Arch Linux：读取官方仓库数据库，提取 desc/depends/provides/files；不下载包文件。
- [ ] Alpine Linux：读取官方 `APKINDEX.tar.gz`，提取包描述、依赖、provides、origin 和架构。
- [ ] openSUSE：读取官方 repository metadata，与 RPM 通用解析器复用。
- [ ] Nixpkgs：优先评估官方/社区已有 JSON 索引或一次性 evaluation 导出，避免完整构建与下载 store paths。
- [ ] Snap：先确认可持续的官方公开索引与使用条款；没有稳定批量接口前不抓取网页。
- [ ] Flatpak/Flathub：读取 AppStream 与 summary 元数据，不下载 runtimes 或应用 bundles。

每新增一个发行版都需要：来源许可说明、快照验证、平台/架构分片、重复包策略、命令提供关系和体量报告。

## P2：命令与文档知识

### man 页面

- [ ] 先选一个许可清晰的发行版 manpages 源，不扫描用户本机 `/usr/share/man` 作为公共数据。
- [ ] 保留 section、名称、简述、SEE ALSO、来源包和原始页面引用。
- [ ] 第一版优先构建命令到 man page 的映射和摘要；正文按命令分片，避免进入搜索主索引。
- [ ] 处理同名不同 section，例如 `printf(1)` 与 `printf(3)`，不可错误合并。

### shell 补全扩展

- [ ] 评估 zsh 官方/常用补全仓库，提取静态可确认的完整命令和解释。
- [ ] 评估 PowerShell 模块中的静态 argument completer 元数据；不导入、不执行模块。
- [ ] 只有在能静态、安全、可复现解析时才接入 Bash completion。
- [ ] Fish、TLDR、man 与其他补全来源保持独立记录，不把不同来源的解释相互覆盖。

## P2：网站与多语言体验

- [ ] 增加 TLDR 语言选择器，默认根据界面语言选择 `zh`，允许切换英文、繁中和其他已同步语言。
- [ ] 记住语言偏好到浏览器本地存储；不得上传。
- [ ] 搜索索引可选加入简中 TLDR 摘要，使中文用途词也能找到软件，同时控制索引体积。
- [ ] 软件详情把“软件包元数据”“命令示例”“补全推导”“未来 man 文档”分成清晰知识层级。
- [ ] 显示页面实际语言及“缺少翻译，已回退英文”，避免用户误以为英文就是中文版本。
- [ ] 来源页增加各语言覆盖率与记录数，而不是只显示总翻译数。
- [ ] 本地 catalog 选择器支持大型目录的缺失文件报告，并明确列出需要补选的分片。

## P2：软件身份和质量

- [ ] 为软件实体建立可审查的 `identity-evidence`：同名、官网、源码、命令、桌面文件 ID、CPE 等证据分别计分。
- [ ] 自动合并仍保持保守；低置信度只生成候选关系，不直接修改软件身份。
- [ ] 建立人工覆盖文件的冲突检测、过期检测和变更报告。
- [ ] 生成每月差异报告：新增/删除包、来源数量变化、身份合并变化、解析失败和体量变化。
- [ ] 为同名不同软件、别名包、虚拟包、提供关系、重命名和弃用迁移增加回归样本。
- [ ] 把当前固定数量基线改为“已批准快照基线 + 明确更新流程”，避免合法上游更新直接让构建失败。

## P3：发布与维护（需要时再做）

- [ ] 月度同步命令统一为一个只读采集入口，再依次构建、验证并原子切换 `current.json`。
- [ ] 保留最近若干快照和变更摘要；制定旧快照清理策略，避免静态站点无限膨胀。
- [ ] 增加压缩传输配置建议：Brotli/Gzip 由 HTTP 层负责，磁盘文件继续保持普通 JSON。
- [ ] 为每个分片记录 ETag/哈希，PS1、Bash 和网页共享缓存命中逻辑。
- [ ] 真正准备发布时再设计私有预览、CDN 缓存和月度自动化；当前阶段不部署。

## 暂缓或默认不做

- [ ] 不镜像软件安装包、Bottle、Cask 下载、`.deb`、`.rpm`、APK、Flatpak、Snap、容器层或源码归档。
- [ ] 不为了读取包索引而长期保存 Docker 镜像；只有无法直接取得官方索引时，才把临时容器作为解析工具并在完成后清理。
- [ ] 不直接镜像整个 Linux 发行版仓库。
- [ ] 不优先接入来源边界不清楚、许可证不清楚、需要抓取网页或必须执行第三方代码的数据源。
- [ ] 不把 Repology 等聚合站当作唯一事实来源；如以后使用，只用于候选映射和交叉检查，并单独标注其来源层级。
- [ ] 不实现账号、云端清单上传、用户追踪、后台数据库或常驻本机服务。

## 建议执行顺序

1. PowerShell 清单工具与共享缓存协议。
2. Bash/Homebrew 清单工具。
3. AppStream 元数据。
4. Winget 官方清单。
5. 一个 APT 官方仓库索引。
6. 一个 DNF 官方仓库索引。
7. TLDR 语言选择器与中文搜索。
8. man 页面摘要和命令映射。
9. Arch、Alpine、Flatpak 等其他 Linux 来源。
