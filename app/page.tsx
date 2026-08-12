"use client";

import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "./catalog-context";
import type { Manager, SoftwareSummary } from "./catalog-types";
import { EmptyState, LoadingBlock, managerLabels, ResultCard } from "./ui";

const managers: Manager[] = ["scoop", "chocolatey", "homebrew"];

export default function Home() {
  const { status, meta, search } = useCatalog();
  const [query, setQuery] = useState("");
  const [activeManagers, setActiveManagers] = useState<Manager[]>([]);
  const [results, setResults] = useState<SoftwareSummary[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (status !== "ready") return;
    let current = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void search(query, activeManagers).then((items) => { if (current) setResults(items); }).finally(() => { if (current) setSearching(false); });
    }, 120);
    return () => { current = false; window.clearTimeout(timer); };
  }, [status, query, activeManagers, search]);

  const sourceCounts = useMemo(() => managers.map((manager) => ({ manager, count: meta?.sources.filter((source) => source.manager === manager).reduce((sum, source) => sum + source.itemCount, 0) || 0 })), [meta]);

  return (
    <>
      <section className="hero page-shell">
        <div className="eyebrow"><span />开放 JSON · 本地分析 · 无后台</div>
        <h1>一份元数据，<br />看懂软件从哪里来。</h1>
        <p className="hero-copy">搜索 Scoop、Chocolatey 与 Homebrew，查看软件用途、官网、下载来源、命令和安装细节。元数据也可以独立下载，交给 PowerShell、Bash 或你自己的工具。</p>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索软件、命令或用途，例如 ffmpeg、git、video…" aria-label="搜索软件" />
          {query && <button onClick={() => setQuery("")} aria-label="清空搜索">×</button>}
        </label>
        <div className="filter-row">
          <span>来源</span>
          {managers.map((manager) => <button key={manager} className={activeManagers.includes(manager) ? `filter active manager-${manager}` : "filter"} onClick={() => setActiveManagers((current) => current.includes(manager) ? current.filter((item) => item !== manager) : [...current, manager])}>{managerLabels[manager]}</button>)}
        </div>
        <div className="hero-stats">
          <div><strong>{meta?.softwareCount.toLocaleString() || "—"}</strong><span>软件实体</span></div>
          <div><strong>{meta?.packageCount.toLocaleString() || "—"}</strong><span>来源包记录</span></div>
          {sourceCounts.map(({ manager, count }) => <div key={manager}><strong>{count.toLocaleString()}</strong><span>{managerLabels[manager]}</span></div>)}
        </div>
      </section>

      <section className="results-section page-shell">
        <div className="section-heading">
          <div><span className="section-kicker">CATALOG</span><h2>{query ? `“${query}” 的结果` : "从软件目录开始探索"}</h2></div>
          <span>{searching ? "正在搜索…" : status === "ready" ? `显示 ${results.length} 项` : "等待元数据"}</span>
        </div>
        {status === "loading" ? <LoadingBlock label="正在读取独立 catalog.json…" /> : results.length ? <div className="result-grid">{results.map((item) => <ResultCard item={item} key={item.id} />)}</div> : status === "ready" ? <EmptyState title="没有找到匹配的软件" body="换一个软件名称、命令或描述关键词试试。" /> : null}
      </section>

      <section className="principles page-shell">
        <article><span>01</span><h3>数据独立</h3><p>网站在运行时读取 catalog.json；同一份文件也能被终端脚本和其他程序使用。</p></article>
        <article><span>02</span><h3>来源透明</h3><p>每条记录保留集合、快照与原始清单链接，不把不同维护边界混成一个“完整生态”。</p></article>
        <article><span>03</span><h3>分析留在本机</h3><p>inventory.json 只在浏览器内匹配。没有上传接口，也没有后台保存你的软件清单。</p></article>
      </section>
    </>
  );
}
