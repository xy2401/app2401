"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LoadingBlock } from "../../../ui";

type Package = {
  id: string; name: string; version: string; release?: string; architecture: string; summary: string; description: string;
  homepage?: string; license?: string; maintainer?: string; sourcePackage?: string; category?: string; repository: string;
  installedSize?: number; downloadSize?: number; dependencies: Record<string, string[]>;
};

function Fact({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === "") return null;
  return <div className="detail-value"><dt>{label}</dt><dd>{typeof value === "number" ? value.toLocaleString() : value}</dd></div>;
}

export function DistributionPackagePage({ distro, id }: { distro: string; id: string }) {
  const params = useSearchParams();
  const [item, setItem] = useState<Package | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const shard = params.get("shard") || id.slice(0, 2);
    void fetch("/metadata/distributions/v1/current.json", { cache: "no-store" }).then((response) => response.json() as Promise<{ snapshotId: string }>).then(async (current) => {
      const response = await fetch(`/metadata/distributions/v1/snapshots/${current.snapshotId}/${distro}/packages/details/${shard}.json`);
      if (!response.ok) throw new Error("无法读取软件详情分片。");
      return response.json() as Promise<{ items: Package[] }>;
    }).then((document) => {
      const found = document.items.find((entry) => entry.id === id);
      if (!found) throw new Error("这个软件不在当前发行版快照中。");
      if (active) setItem(found);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [distro, id, params]);
  if (!item && !error) return <div className="page-shell detail-loading"><LoadingBlock label="正在读取软件详情分片…" /></div>;
  if (!item) return <div className="page-shell"><div className="empty-state"><strong>无法打开软件详情</strong><p>{error}</p><Link href="/distributions">返回发行版目录</Link></div></div>;
  return <div className="page-shell software-page">
    <Link className="back-link" href={`/distributions`}>← 返回发行版目录</Link>
    <header className="software-hero"><div><span className="section-kicker">{distro}</span><h1>{item.name}</h1><p>{item.summary || "仓库未提供简介"}</p></div><div className="software-facts"><span>{item.version}{item.release ? `-${item.release}` : ""}</span><span>{item.architecture}</span><span>{item.repository}</span></div></header>
    {item.homepage && <div className="identity-links"><a href={item.homepage} target="_blank" rel="noreferrer">项目主页 ↗</a></div>}
    <article className="package-panel distro-detail"><p>{item.description || item.summary}</p><dl className="fact-grid"><Fact label="许可证" value={item.license} /><Fact label="维护者" value={item.maintainer} /><Fact label="源码包" value={item.sourcePackage} /><Fact label="分类" value={item.category} /><Fact label="安装大小（字节）" value={item.installedSize} /><Fact label="下载大小（字节）" value={item.downloadSize} /></dl></article>
    <section className="dependency-grid">{Object.entries(item.dependencies).filter(([, values]) => values.length).map(([kind, values]) => <article key={kind}><h2>{kind}</h2><div>{values.map((value) => <code key={value}>{value}</code>)}</div></article>)}</section>
  </div>;
}
