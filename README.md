# 软件源地图

软件源地图是一个无后台的静态软件元数据平台：

```text
Scoop / Chocolatey / Homebrew → catalog.json → 网站 / PowerShell / Bash
```

网站不会把软件记录编译进 JavaScript。它在运行时读取独立的
`public/metadata/v1/catalog.json`，并在 Web Worker 中完成搜索、详情查询和本机清单匹配。

## 数据源

- `sources/scoop/`：Scoop 当前已知桶，使用浅层 Git 子模块固定快照。
- `sources/chocolatey/community-packages/`：Chocolatey Community Maintainers 团队维护的精选包仓库。
- `sources/homebrew/api/`：Homebrew 官方 Formula 与 Cask JSON API 的本地缓存；缓存不进入 Git 历史。

数据源的维护范围会保留在生成后的 `sources` 元数据中，不把精选仓库描述为完整生态。

## 常用命令

```powershell
# 同步 Homebrew 官方 JSON
./scripts/sync-homebrew.ps1

# 生成并校验独立元数据文件
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

- `schemas/catalog-v1.schema.json`：统一软件和来源包数据协议。
- `schemas/inventory-v1.schema.json`：PS1/Bash 将来输出的本机清单协议。
- `public/examples/inventory.example.json`：可直接导入网页的示例清单。
- `data/identity-overrides.json`：人工合并和拆分不同来源的软件身份。

catalog v1 允许增加可选字段；破坏性变化必须发布到新的 `/metadata/v2/` 路径。

## 隐私

本机清单只在浏览器标签页内读取和匹配。项目没有上传接口、数据库、账号或用户追踪，清单协议也不允许用户名、主机名、序列号和 IP 等机器身份字段。
