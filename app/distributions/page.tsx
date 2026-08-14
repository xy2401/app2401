"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingBlock } from "../ui";

type Current = { snapshotId: string; generatedAt: string; manifest: string };
type DistributionEntry = {
  id: string;
  label: string;
  packageCount: number;
  groupCount: number;
  environmentCount: number;
  distribution: { name: string; versionId: string; arch: string };
  image: { reference: string; digest: string };
  files: { search: { path: string }; groups: { path: string } };
};
type Manifest = { generatedAt: string; distributions: DistributionEntry[] };
type PackageSummary = { id: string; name: string; version: string; architecture: string; summary: string; category: string; repository: string; shard: string };
type Group = { id: string; names: Record<string, string>; descriptions: Record<string, string>; packages: Array<{ name: string; type: string }> };

const base = "/metadata/distributions/v1/";

export default function DistributionsPage() {
  const [current, setCurrent] = useState<Current | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [selected, setSelected] = useState("");
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"packages" | "groups">("packages");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch(`${base}current.json`, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("发行版元数据还没有完成第一次同步。");
      return response.json() as Promise<Current>;
    }).then(async (nextCurrent) => {
      const response = await fetch(`${base}${nextCurrent.manifest}`);
      if (!response.ok) throw new Error("发行版快照清单不可用。");
      return [nextCurrent, await response.json() as Manifest] as const;
    }).then(([nextCurrent, nextManifest]) => {
      if (!active) return;
      setCurrent(nextCurrent);
      setManifest(nextManifest);
      setSelected(nextManifest.distributions[0]?.id || "");
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const entry = manifest?.distributions.find((item) => item.id === selected);
  useEffect(() => {
    if (!current || !entry) return;
    let active = true;
    void fetch(`${base}snapshots/${current.snapshotId}/${entry.files.search.path}`).then((response) => {
      if (!response.ok) throw new Error("无法读取发行版搜索索引。");
      return response.json() as Promise<{ packages: PackageSummary[] }>;
    }).then((document) => { if (active) setPackages(document.packages); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [current, entry]);

  useEffect(() => {
    if (tab !== "groups" || groups || !current || !entry) return;
    let active = true;
    void fetch(`${base}snapshots/${current.snapshotId}/${entry.files.groups.path}`).then((response) => response.json() as Promise<{ groups: Group[] }>).then((document) => { if (active) setGroups(document.groups); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [tab, groups, current, entry]);

  const normalizedQuery = query.trim().toLowerCase();
  const shownPackages = useMemo(() => packages.filter((item) => !normalizedQuery || `${item.name} ${item.summary} ${item.category}`.toLowerCase().includes(normalizedQuery)).slice(0, 300), [packages, normalizedQuery]);
  const shownGroups = useMemo(() => (groups || []).filter((item) => !normalizedQuery || `${item.id} ${Object.values(item.names).join(" ")} ${Object.values(item.descriptions).join(" ")}`.toLowerCase().includes(normalizedQuery)), [groups, normalizedQuery]);

  return <div className="page-shell distro-page">
    <header className="inner-hero"><span className="section-kicker">LINUX REPOSITORIES</span><h1>浏览发行版官方软件仓库</h1><p>只读取官方仓库索引，不下载软件包。名称与简介用于搜索，完整描述和依赖在打开详情时按哈希分片加载。</p></header>
    {error && !manifest ? <EmptyState title="发行版数据尚不可用" body={error} /> : <>
      <section className="distro-toolbar">
        <label><span>发行版</span><select value={selected} onChange={(event) => { setLoading(true); setGroups(null); setSelected(event.target.value); }}>{manifest?.distributions.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.packageCount.toLocaleString()} 包</option>)}</select></label>
        <label className="distro-query"><span>搜索当前发行版</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、简介或分类" /></label>
      </section>
      {entry && <div className="distro-stats"><span>{entry.distribution.name} {entry.distribution.versionId}</span><span>{entry.packageCount.toLocaleString()} 个包</span><span>{entry.groupCount.toLocaleString()} 个软件组</span><span>{entry.image.reference}</span><span>更新于 {new Date(manifest?.generatedAt || "").toLocaleString("zh-CN")}</span></div>}
      <div className="distro-tabs" role="tablist"><button className={tab === "packages" ? "active" : ""} onClick={() => setTab("packages")}>软件包</button><button className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")}>DNF 软件组</button></div>
      {loading ? <LoadingBlock label="正在读取发行版索引…" /> : tab === "packages" ? <section className="distro-list">{shownPackages.map((item) => <Link href={`/distributions/${entry?.id}/${item.id}?shard=${item.shard}`} className="distro-row" key={item.id}><div><strong>{item.name}</strong><code>{item.version}</code></div><p>{item.summary || "仓库未提供简介"}</p><span>{item.repository}</span></Link>)}</section> : groups === null ? <LoadingBlock label="正在读取软件组…" /> : shownGroups.length ? <section className="distro-group-grid">{shownGroups.map((group) => <article key={group.id}><span>{group.id}</span><h2>{group.names.zh || group.names.en || group.id}</h2><p>{group.descriptions.zh || group.descriptions.en || "仓库未提供说明"}</p><small>{group.packages.length.toLocaleString()} 个成员包</small></article>)}</section> : <EmptyState title="当前发行版没有软件组数据" body="DNF comps 软件组目前只适用于提供该元数据的 Fedora/Rocky 仓库。" />}
      {!loading && tab === "packages" && packages.length > shownPackages.length && <p className="distro-limit">当前显示前 {shownPackages.length.toLocaleString()} 项，请输入关键词缩小范围。</p>}
    </>}
  </div>;
}
