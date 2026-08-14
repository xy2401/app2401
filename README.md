# 软件源地图

软件源地图是一个无后台的静态软件元数据平台：

```text
Scoop / Chocolatey / Homebrew / Fish / TLDR → 版本化 JSON 快照 → 网站 / PowerShell / Bash
```

## 目录结构

```text
app/                 网站页面与浏览器端逻辑
catalog/             元数据配置、Schema、文档和构建脚本
public/metadata/     网站和终端客户端读取的公开 JSON
sources/             Scoop、Chocolatey、Fish、TLDR 等外部数据源
runtime/             本地网站运行入口
tests/               数据解析与网站验收测试
```

`catalog/` 是构建输入和工具，`public/metadata/` 是可直接发布、下载和缓存的构建输出。

网站不会把软件记录编译进 JavaScript。它先读取
`public/metadata/v1/current.json`，再按需读取搜索索引、包管理器索引和详情分片，
并在 Web Worker 中完成搜索、详情查询和本机清单匹配。

```text
metadata/v1/
├── current.json
└── snapshots/<snapshot-id>/
    ├── manifest.json
    ├── search.json
    ├── inventory/{scoop,chocolatey,homebrew}.json
    ├── details/00.json ... ff.json
    ├── commands/index.json
    ├── commands/details/00.json ... ff.json
    ├── tldr/index.json
    ├── tldr/details/00.json ... ff.json
    ├── tldr/locales.json
    ├── tldr/locales/<locale>/details/00.json ... ff.json
    └── sources/<source>/<page>.json
```

`current.json` 只是当前快照指针。快照清单记录每个文件的路径、字节数和
SHA-256；网页、PowerShell 与 Bash 因而可以校验并缓存完全相同的数据，只同步变化的文件。

## 数据源

- `sources/scoop/`：Scoop 当前已知桶，使用浅层 Git 子模块固定快照。
- `sources/chocolatey/community-packages/`：Chocolatey Community Maintainers 团队维护的精选包仓库。
- `sources/homebrew/api/`：Homebrew 官方 Formula 与 Cask JSON API 的本地缓存；缓存不进入 Git 历史。
- `sources/fish/fish-shell/`：Fish 官方仓库快照，静态解析其命令补全和注释。
- `sources/tldr/tldr/`：TLDR Pages 浅层稀疏快照，签出英文页和全部官方翻译页。

Fish 解析器不会运行补全脚本、函数、命令替换或外部程序。它只把可静态确认的命令路径
（例如 `git remote add`）及其原始解释写入命令分片；参数和选项留给后续 man 等来源。
命令只通过包记录声明的可执行文件保守关联到软件；仅包名匹配且存在多个候选时不会自动确认。

TLDR 解析器保留每种语言完整的命令模板、占位符、平台与原文解释，不执行任何示例。英文页提供
稳定身份，各语言使用独立分片；中文界面只按需读取简中分片，缺译时整页回退英文。新检出项目后可运行
`git -C sources/tldr/tldr sparse-checkout set --no-cone /pages/ /pages.*/`，避免把项目资产展开到工作区。

数据源的维护范围会保留在生成后的 `sources` 元数据中，不把精选仓库描述为完整生态。

## 常用命令

```powershell
# 同步 Homebrew 官方 JSON
./catalog/scripts/sources/sync-homebrew.ps1

# 生成并校验分片元数据快照
npm run metadata:build
npm run metadata:verify

# 启动网站
npm run dev

# 完整生产验收
npm test
```

Git 数据源每月可通过以下命令更新：

```powershell
git submodule update --init --recursive --depth 1
git submodule update --remote --depth 1
```

## 开放协议

- `catalog/schemas/catalog-v1.schema.json`：统一软件和来源包数据协议。
- `catalog/schemas/catalog-index-v1.schema.json`：当前快照指针与分片 manifest 协议。
- `catalog/schemas/command-v1.schema.json`：Fish 完整命令路径与解释协议。
- `catalog/schemas/tldr-v1.schema.json`：TLDR 完整命令模板、解释和平台协议。
- `catalog/schemas/inventory-v1.schema.json`：PS1/Bash 将来输出的本机清单协议。
- `public/examples/inventory.example.json`：可直接导入网页的示例清单。
- `catalog/config/identity-overrides.json`：人工合并和拆分不同来源的软件身份。

catalog v1 允许增加可选字段；破坏性变化必须发布到新的 `/metadata/v2/` 路径。
`catalog-v1.schema.json` 描述分片组合后的逻辑数据集，传输层由快照 manifest 组织。

## 隐私

本机清单只在浏览器标签页内读取和匹配。项目没有上传接口、数据库、账号或用户追踪，清单协议也不允许用户名、主机名、序列号和 IP 等机器身份字段。
