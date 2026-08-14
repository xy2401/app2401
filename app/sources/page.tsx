"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCatalog } from "../catalog-context";
import { LoadingBlock, ManagerBadge } from "../ui";

const tierCopy = {
  "known-bucket": "Scoop 已知桶",
  "curated-community": "社区维护团队精选",
  "official-index": "官方完整索引",
};

const knowledgeCopy = {
  "command-completions": { badge: "Fish", className: "manager-fish", description: "官方命令补全仓库", unit: "命令" },
  "command-examples": { badge: "TLDR", className: "manager-tldr", description: "社区精选完整命令页", unit: "命令页" },
};

type PlatformSummary = { label: string; count: number; detail: string };

function PlatformSources() {
  const [items, setItems] = useState<PlatformSummary[]>([]);
  useEffect(() => {
    let active = true;
    const json = async (url: string) => { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error(url); return response.json(); };
    void Promise.allSettled([
      json("/metadata/environments/v1/github-actions/windows.json"),
      json("/metadata/environments/v1/github-actions/linux.json"),
      json("/metadata/distributions/v1/index.json"),
    ]).then((results) => {
      if (!active) return;
      const next: PlatformSummary[] = [];
      const windows = results[0].status === "fulfilled" ? results[0].value : null;
      const linux = results[1].status === "fulfilled" ? results[1].value : null;
      const distros = results[2].status === "fulfilled" ? results[2].value : null;
      if (windows) next.push({ label: "GitHub Runner · Windows", count: windows.runners.reduce((sum: number, runner: { softwareCount: number }) => sum + runner.softwareCount, 0), detail: `${windows.runners.length} 个稳定镜像环境` });
      if (linux) next.push({ label: "GitHub Runner · Linux", count: linux.runners.reduce((sum: number, runner: { softwareCount: number }) => sum + runner.softwareCount, 0), detail: `${linux.runners.length} 个稳定镜像环境` });
      if (distros) next.push({ label: "Linux 发行版精选与仓库", count: distros.distributions.reduce((sum: number, distro: { curatedPackageCount: number }) => sum + distro.curatedPackageCount, 0), detail: `${distros.distributions.reduce((sum: number, distro: { collectionCount: number }) => sum + distro.collectionCount, 0).toLocaleString()} 个发行版维护集合 · 完整仓库按需加载` });
      setItems(next);
    });
    return () => { active = false; };
  }, []);
  return <section className="platform-sources"><div className="section-heading"><div><span className="section-kicker">ENVIRONMENTS & DISTRIBUTIONS</span><h2>运行环境与 Linux 仓库</h2></div><Link href="/distributions">浏览发行版 →</Link></div>{items.length ? <div className="platform-source-grid">{items.map((item) => <article key={item.label}><strong>{item.label}</strong><span>{item.count.toLocaleString()} 条软件记录</span><small>{item.detail}</small></article>)}</div> : <div className="empty-state compact"><strong>等待第一次自动同步</strong><p>工作流运行后，这里会显示 Runner 环境和七个 Linux 发行版的覆盖数量。</p></div>}</section>;
}

export default function SourcesPage() {
  const { status, meta } = useCatalog();
  return (
    <div className="page-shell sources-page">
      <header className="inner-hero"><span className="section-kicker">SOURCES</span><h1>清楚知道每条数据从哪里来</h1><p>数量不是唯一目标。我们保留每个来源的维护边界、快照标识和原始地址，方便判断一条信息值得怎样信任。</p></header>
      {status === "loading" || !meta ? <LoadingBlock /> : <>
        <div className="snapshot-strip"><span>Catalog v{meta.schemaVersion}</span><span>{meta.softwareCount.toLocaleString()} 个软件</span><span>{meta.packageCount.toLocaleString()} 个来源包</span><span>{meta.commandCount.toLocaleString()} 个 Fish 命令</span><span>{meta.tldrPageCount.toLocaleString()} 个 TLDR 页面</span><span>{meta.tldrTranslationCount.toLocaleString()} 个翻译 · {meta.tldrLocaleCount} 种语言</span><span>快照 {new Date(meta.generatedAt).toLocaleString("zh-CN")}</span></div>
        <div className="source-list">{meta.sources.map((source) => <article className="source-row" key={source.id}>
          <div className="source-index">{String(meta.sources.indexOf(source) + 1).padStart(2, "0")}</div>
          <div className="source-main"><ManagerBadge manager={source.manager} /><h2>{source.label}</h2><p>{tierCopy[source.tier]}</p></div>
          <div className="source-count"><strong>{source.itemCount.toLocaleString()}</strong><span>条记录</span></div>
          <div className="source-snapshot"><span>snapshot</span><code>{source.snapshot.slice(0, 16)}</code></div>
          <div className="source-actions"><Link href={`/sources/${encodeURIComponent(source.id)}`}>浏览数据 →</Link>{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">来源 ↗</a>}</div>
        </article>)}{meta.knowledgeSources.map((source) => { const copy = knowledgeCopy[source.type]; return <article className="source-row" key={source.id}>
          <div className="source-index">K{String(meta.knowledgeSources.indexOf(source) + 1).padStart(2, "0")}</div>
          <div className="source-main"><span className={`manager-badge ${copy.className}`}>{copy.badge}</span><h2>{source.label}</h2><p>{copy.description}</p></div>
          <div className="source-count"><strong>{source.recordCount.toLocaleString()}</strong><span>{source.type === "command-examples" ? `${source.translationCount?.toLocaleString() || 0} 个翻译 · ${source.localeCount || 1} 种语言` : `个${copy.unit} · ${source.itemCount.toLocaleString()} 个文件`}</span></div>
          <div className="source-snapshot"><span>snapshot</span><code>{source.snapshot.slice(0, 16)}</code></div>
          <div className="source-actions">{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">来源 ↗</a>}</div>
        </article>; })}</div>
      </>}
      <PlatformSources />
      <section className="source-notes"><article><h3>Scoop</h3><p>同步 Scoop 当前公布的已知桶。桶由不同社区维护者维护，因此每条包记录保留具体桶名。</p></article><article><h3>Chocolatey</h3><p>只收录 Chocolatey Community Maintainers 团队集中维护的 Git 仓库，不声称覆盖完整社区源。</p></article><article><h3>Homebrew</h3><p>直接读取 Homebrew 官方 Formula 与 Cask JSON API，是当前官方索引的月度快照。</p></article><article><h3>Fish</h3><p>静态解析 Fish 官方补全，提取能够确定的完整命令路径与原文解释；动态表达式只计数，绝不执行。</p></article><article><h3>TLDR</h3><p>英文页作为稳定身份，同时保存全部官方翻译。中文界面按需加载简中分片，缺译时整页回退英文；任何示例都不会执行。</p></article></section>
    </div>
  );
}
