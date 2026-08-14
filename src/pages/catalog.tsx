import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "../catalog-context";
import type { Manager, SoftwareSummary } from "../catalog-types";
import { useSearchParams } from "../navigation";
import { EmptyState, LoadingBlock, managerLabels, ResultCard } from "../ui";

const managers: Manager[] = ["scoop", "chocolatey", "homebrew"];

export default function CatalogPage() {
  const params = useSearchParams();
  const { status, meta, search } = useCatalog();
  const [query, setQuery] = useState(() => params.get("query") || "");
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

  return <>
    <section className="catalog-hero page-shell">
      <div className="catalog-title"><div><span className="section-kicker">SOFTWARE CATALOG</span><h1>查软件</h1></div><p>搜索名称、命令或用途，详情按需从当前元数据快照加载。</p></div>
      <label className="search-box catalog-search">
        <span aria-hidden="true">⌕</span>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索软件、命令或用途，例如 ffmpeg、git、video…" aria-label="搜索软件" />
        {query && <button onClick={() => setQuery("")} aria-label="清空搜索">×</button>}
      </label>
      <div className="catalog-toolbar">
        <div className="filter-row"><span>来源</span>{managers.map((manager) => <button key={manager} className={activeManagers.includes(manager) ? `filter active manager-${manager}` : "filter"} onClick={() => setActiveManagers((current) => current.includes(manager) ? current.filter((item) => item !== manager) : [...current, manager])}>{managerLabels[manager]}</button>)}</div>
        <div className="catalog-counts"><span>{meta?.softwareCount.toLocaleString() || "—"} 软件</span><span>{meta?.packageCount.toLocaleString() || "—"} 包记录</span><span>{meta?.commandCount.toLocaleString() || "—"} Fish 命令</span><span>{meta?.tldrPageCount.toLocaleString() || "—"} TLDR 页面</span><span>{meta?.tldrTranslationCount.toLocaleString() || "—"} 翻译</span></div>
      </div>
      <div className="manager-counts">{sourceCounts.map(({ manager, count }) => <span key={manager}>{managerLabels[manager]} {count.toLocaleString()}</span>)}</div>
    </section>

    <section className="catalog-results page-shell">
      <div className="section-heading"><div><span className="section-kicker">RESULTS</span><h2>{query ? `“${query}” 的结果` : "软件目录"}</h2></div><span>{searching ? "正在搜索…" : status === "ready" ? `显示 ${results.length} 项` : "等待元数据"}</span></div>
      {status === "loading" ? <LoadingBlock label="正在读取当前快照与搜索索引…" /> : results.length ? <div className="result-grid">{results.map((item) => <ResultCard item={item} key={item.id} />)}</div> : status === "ready" ? <EmptyState title="没有找到匹配的软件" body="换一个软件名称、命令或描述关键词试试。" /> : null}
    </section>
  </>;
}
