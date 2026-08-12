"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCatalog } from "../../catalog-context";
import type { PackageRecord, SoftwareDetail } from "../../catalog-types";
import { CopyButton, LoadingBlock, ManagerBadge, PlatformBadges, ResultCard } from "../../ui";

function DetailValue({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
  const shown = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <div className="detail-value"><dt>{label}</dt><dd>{typeof value === "object" ? <pre>{shown}</pre> : shown}</dd></div>;
}

function PackagePanel({ item }: { item: PackageRecord }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="package-panel">
      <div className="package-head">
        <div><ManagerBadge manager={item.manager} /><span className={`status status-${item.status}`}>{item.status}</span><h2>{item.title}</h2><p>{item.collection} · {item.version || "版本未知"}</p></div>
        <PlatformBadges platforms={item.platforms} />
      </div>
      <div className="install-line"><code>{item.installCommand}</code><CopyButton value={item.installCommand} /></div>
      <dl className="fact-grid">
        <DetailValue label="包名" value={item.name} />
        <DetailValue label="架构" value={item.architectures.join(", ")} />
        <DetailValue label="命令" value={item.commands.join(", ")} />
        <DetailValue label="依赖" value={item.dependencies.join(", ")} />
      </dl>
      {item.artifacts.length > 0 && <div className="artifact-list"><h3>下载来源</h3>{item.artifacts.slice(0, 8).map((artifact, index) => <div key={`${artifact.url}-${index}`}><a href={artifact.url} target="_blank" rel="noreferrer">{artifact.url}</a>{artifact.architecture && <span>{artifact.architecture}</span>}{artifact.hash && <code>{artifact.hash}</code>}</div>)}</div>}
      <div className="package-links">{item.homepage && <a href={item.homepage} target="_blank" rel="noreferrer">官网 ↗</a>}{item.repository && <a href={item.repository} target="_blank" rel="noreferrer">源码 ↗</a>}<a href={item.sourceRef} target="_blank" rel="noreferrer">原始清单 ↗</a></div>
      <button className="details-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? "收起来源字段" : "展开来源专属字段"}</button>
      {expanded && <pre className="source-details">{JSON.stringify(item.sourceDetails, null, 2)}</pre>}
    </article>
  );
}

export function SoftwarePage({ id }: { id: string }) {
  const { status, detail } = useCatalog();
  const [data, setData] = useState<SoftwareDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (status !== "ready") return; let active = true; void detail(id).then((next) => { if (active) setData(next); }).catch((cause) => { if (active) setError(cause.message); }); return () => { active = false; }; }, [status, id, detail]);
  if (status === "loading" || (!data && !error)) return <div className="page-shell detail-loading"><LoadingBlock /></div>;
  if (error || !data) return <div className="page-shell"><div className="empty-state"><strong>无法打开软件详情</strong><p>{error}</p><Link href="/">返回搜索</Link></div></div>;
  const { software, packages, candidates } = data;
  return (
    <div className="page-shell software-page">
      <Link className="back-link" href="/">← 返回软件目录</Link>
      <header className="software-hero">
        <div><span className="section-kicker">SOFTWARE</span><h1>{software.name}</h1><p>{software.summary || "来源暂未提供软件简介。"}</p></div>
        <div className="software-facts"><PlatformBadges platforms={software.platforms} /><span>{packages.length} 个来源包</span><span>{software.licenses.join(" · ") || "许可证未知"}</span></div>
      </header>
      <div className="identity-links">{software.homepages.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">官网 · {new URL(url).hostname} ↗</a>)}{software.repositories.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">源码 · {new URL(url).hostname} ↗</a>)}</div>
      <section className="package-stack">{packages.map((item) => <PackagePanel key={item.id} item={item} />)}</section>
      {candidates.length > 0 && <section className="candidate-section"><div className="section-heading"><div><span className="section-kicker">POSSIBLE MATCHES</span><h2>同名但未自动合并</h2></div></div><p>这些记录名称相同，但官网或源码不足以确认是同一个软件。</p><div className="result-grid">{candidates.map((item) => <ResultCard item={item} key={item.id} />)}</div></section>}
    </div>
  );
}
