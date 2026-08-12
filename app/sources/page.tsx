"use client";

import Link from "next/link";
import { useCatalog } from "../catalog-context";
import { LoadingBlock, ManagerBadge } from "../ui";

const tierCopy = {
  "known-bucket": "Scoop 已知桶",
  "curated-community": "社区维护团队精选",
  "official-index": "官方完整索引",
};

export default function SourcesPage() {
  const { status, meta } = useCatalog();
  return (
    <div className="page-shell sources-page">
      <header className="inner-hero"><span className="section-kicker">SOURCES</span><h1>清楚知道每条数据从哪里来</h1><p>数量不是唯一目标。我们保留每个来源的维护边界、快照标识和原始地址，方便判断一条信息值得怎样信任。</p></header>
      {status === "loading" || !meta ? <LoadingBlock /> : <>
        <div className="snapshot-strip"><span>Catalog v{meta.schemaVersion}</span><span>{meta.softwareCount.toLocaleString()} 个软件</span><span>{meta.packageCount.toLocaleString()} 个来源包</span><span>快照 {new Date(meta.generatedAt).toLocaleString("zh-CN")}</span></div>
        <div className="source-list">{meta.sources.map((source) => <article className="source-row" key={source.id}>
          <div className="source-index">{String(meta.sources.indexOf(source) + 1).padStart(2, "0")}</div>
          <div className="source-main"><ManagerBadge manager={source.manager} /><h2>{source.label}</h2><p>{tierCopy[source.tier]}</p></div>
          <div className="source-count"><strong>{source.itemCount.toLocaleString()}</strong><span>条记录</span></div>
          <div className="source-snapshot"><span>snapshot</span><code>{source.snapshot.slice(0, 16)}</code></div>
          <div className="source-actions"><Link href={`/sources/${encodeURIComponent(source.id)}`}>浏览数据 →</Link>{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">来源 ↗</a>}</div>
        </article>)}</div>
      </>}
      <section className="source-notes"><article><h3>Scoop</h3><p>同步 Scoop 当前公布的已知桶。桶由不同社区维护者维护，因此每条包记录保留具体桶名。</p></article><article><h3>Chocolatey</h3><p>只收录 Chocolatey Community Maintainers 团队集中维护的 Git 仓库，不声称覆盖完整社区源。</p></article><article><h3>Homebrew</h3><p>直接读取 Homebrew 官方 Formula 与 Cask JSON API，是当前官方索引的月度快照。</p></article></section>
    </div>
  );
}
