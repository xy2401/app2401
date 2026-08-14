import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "../catalog-context";
import type { SourcePackageRecord, SourceSoftwareRecord } from "../catalog-types";
import { Link } from "../navigation";
import { EmptyState, LoadingBlock, ManagerBadge, PlatformBadges } from "../ui";

type Row = { package: SourcePackageRecord; software: SourceSoftwareRecord };

export function SourcePage({ sourceId }: { sourceId: string }) {
  const { status, meta, browseSource } = useCatalog();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const source = useMemo(() => meta?.sources.find((item) => item.id === sourceId), [meta, sourceId]);
  useEffect(() => { if (status !== "ready") return; let active = true; const timer = window.setTimeout(() => { setLoading(true); void browseSource(sourceId, query).then((result) => { if (active) { setRows(result.items); setTotal(result.total); } }).finally(() => { if (active) setLoading(false); }); }, 120); return () => { active = false; window.clearTimeout(timer); }; }, [status, sourceId, query, browseSource]);
  if (status === "loading" || !meta) return <div className="page-shell"><LoadingBlock /></div>;
  if (!source) return <div className="page-shell"><EmptyState title="没有这个数据源" body="当前 catalog 中没有找到对应来源。" /></div>;
  return <div className="page-shell source-page">
    <Link className="back-link" href="/sources">← 返回数据源</Link>
    <header className="source-hero"><div><ManagerBadge manager={source.manager} /><h1>{source.label}</h1><p>{source.id}</p></div><div><strong>{source.itemCount.toLocaleString()}</strong><span>快照记录</span></div></header>
    <label className="source-search"><span>筛选这个来源</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入包名或简介" /></label>
    <div className="source-table-heading"><span>{loading ? "正在查找…" : `${total.toLocaleString()} 条匹配，显示前 ${rows.length} 条`}</span><a href={source.sourceUrl} target="_blank" rel="noreferrer">打开上游来源 ↗</a></div>
    <div className="package-directory">{rows.map(({ package: item, software }) => <Link href={`/software/${encodeURIComponent(software.id)}`} className="directory-row" key={item.id}><div><strong>{software.name}</strong><code>{item.name}</code></div><p>{item.description || "暂无简介"}</p><PlatformBadges platforms={item.platforms} /><span className={`status status-${item.status}`}>{item.status}</span></Link>)}</div>
  </div>;
}
