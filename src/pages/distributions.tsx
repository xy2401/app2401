import { useEffect, useMemo, useState } from "react";
import { Link } from "../navigation";
import { EmptyState, LoadingBlock } from "../ui";

type FileRef = { path: string };
type SearchIndex = { packages?: PackageSummary[]; shards?: Record<string, FileRef> };
type DistributionEntry = {
  id: string; label: string; packageCount: number; collectionCount: number; curatedPackageCount: number;
  distribution: { name: string; versionId: string; arch: string };
  image: { reference: string; digest: string };
  files: { search: FileRef; collections: FileRef; curated: FileRef };
};
type Index = { generatedAt: string; revision: string; distributions: DistributionEntry[] };
type PackageSummary = { id: string; name: string; version: string; architecture: string; summary: string; category: string; repository: string; shard: string };
type CuratedPackage = PackageSummary & { reasons: Array<{ type: string; collectionId: string; role: string }> };
type Collection = {
  id: string; sourceId: string; type: "environment" | "task" | "pattern" | "group" | "metapackage";
  names: Record<string, string>; descriptions: Record<string, string>; visible: boolean; default: boolean; installTarget: string;
  members: Array<{ name: string; role: string }>; children: Array<{ id: string; role: string }>;
};

const base = "/metadata/distributions/v1/";
const collectionTypeLabels = { environment: "环境", task: "任务", pattern: "模式", group: "软件组", metapackage: "元包" };
const localized = (values: Record<string, string>, fallback: string) => values.zh || values.zh_CN || values["zh-CN"] || values.en || Object.values(values)[0] || fallback;

export default function DistributionsPage() {
  const [index, setIndex] = useState<Index | null>(null);
  const [selected, setSelected] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [curated, setCurated] = useState<CuratedPackage[]>([]);
  const [curatedFor, setCuratedFor] = useState("");
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [packagesFor, setPackagesFor] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"curated" | "packages">("curated");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`${base}index.json`, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("发行版元数据还没有完成第一次同步。");
      return response.json() as Promise<Index>;
    }).then((nextIndex) => {
      if (!active) return;
      setIndex(nextIndex);
      setSelected(nextIndex.distributions[0]?.id || "");
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, []);

  const entry = index?.distributions.find((item) => item.id === selected);
  useEffect(() => {
    if (!entry) return;
    let active = true;
    void Promise.all([
      fetch(`${base}${entry.files.collections.path}`).then((response) => { if (!response.ok) throw new Error("无法读取发行版精选集合。"); return response.json() as Promise<{ collections: Collection[] }>; }),
      fetch(`${base}${entry.files.curated.path}`).then((response) => { if (!response.ok) throw new Error("无法读取发行版精选软件。"); return response.json() as Promise<{ packages: CuratedPackage[] }>; }),
    ]).then(([collectionDocument, curatedDocument]) => {
      if (!active) return;
      setCollections(collectionDocument.collections);
      setCurated(curatedDocument.packages);
      setCuratedFor(entry.id);
    }).catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setCuratedFor(entry.id); } });
    return () => { active = false; };
  }, [entry]);

  useEffect(() => {
    if (tab !== "packages" || !entry || packagesFor === entry.id) return;
    let active = true;
    void fetch(`${base}${entry.files.search.path}`).then((response) => {
      if (!response.ok) throw new Error("无法读取完整仓库索引。");
      return response.json() as Promise<SearchIndex>;
    }).then(async (document) => {
      if (document.packages) return document.packages;
      const descriptors = Object.values(document.shards || {});
      const documents = await Promise.all(descriptors.map(async (descriptor) => {
        const response = await fetch(`${base}${descriptor.path}`);
        if (!response.ok) throw new Error("无法读取完整仓库搜索分片。");
        return response.json() as Promise<{ packages: PackageSummary[] }>;
      }));
      return documents.flatMap((item) => item.packages);
    }).then((nextPackages) => { if (active) { setPackages(nextPackages); setPackagesFor(entry.id); } }).catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setPackagesFor(entry.id); } });
    return () => { active = false; };
  }, [tab, entry, packagesFor]);

  const normalizedQuery = query.trim().toLowerCase();
  const shownCollections = useMemo(() => collections.filter((item) => item.visible && (!normalizedQuery || `${item.id} ${Object.values(item.names).join(" ")} ${Object.values(item.descriptions).join(" ")} ${item.members.map((member) => member.name).join(" ")}`.toLowerCase().includes(normalizedQuery))), [collections, normalizedQuery]);
  const shownCurated = useMemo(() => curated.filter((item) => !normalizedQuery || `${item.name} ${item.summary} ${item.category}`.toLowerCase().includes(normalizedQuery)).slice(0, 200), [curated, normalizedQuery]);
  const shownPackages = useMemo(() => (packagesFor === entry?.id ? packages : []).filter((item) => !normalizedQuery || `${item.name} ${item.summary} ${item.category}`.toLowerCase().includes(normalizedQuery)).slice(0, 300), [packages, packagesFor, entry, normalizedQuery]);
  const loading = !index || Boolean(entry && (tab === "curated" ? curatedFor !== entry.id : packagesFor !== entry.id));

  return <div className="page-shell distro-page">
    <header className="inner-hero"><span className="section-kicker">DISTRIBUTION PICKS</span><h1>发行版精选的软件与环境</h1><p>默认展示发行版维护者定义的软件组、开发环境、任务、模式和元包。完整仓库仍可精确查询，但不会把库、内核和调试包混入普通浏览。</p></header>
    {error && !index ? <EmptyState title="发行版数据尚不可用" body={error} /> : <>
      <section className="distro-toolbar">
        <label><span>发行版</span><select value={selected} onChange={(event) => { setError(""); setTab("curated"); setSelected(event.target.value); }}>{index?.distributions.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.distribution.versionId}</option>)}</select></label>
        <label className="distro-query"><span>搜索当前视图</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "curated" ? "用途、集合或软件名称" : "包名、简介或分类"} /></label>
      </section>
      {entry && <div className="distro-stats"><span>{entry.distribution.name} {entry.distribution.versionId}</span><span>{entry.collectionCount.toLocaleString()} 个精选集合</span><span>{entry.curatedPackageCount.toLocaleString()} 个集合成员包</span><span>{entry.packageCount.toLocaleString()} 个完整仓库包</span><span>更新于 {new Date(index?.generatedAt || "").toLocaleString("zh-CN")}</span></div>}
      <div className="distro-tabs" role="tablist"><button className={tab === "curated" ? "active" : ""} onClick={() => setTab("curated")}>发行版精选</button><button className={tab === "packages" ? "active" : ""} onClick={() => setTab("packages")}>完整仓库（高级）</button></div>
      {error && <p className="distro-limit">{error}</p>}
      {loading ? <LoadingBlock label={tab === "curated" ? "正在读取发行版精选…" : "正在读取完整仓库索引…"} /> : tab === "curated" ? <>
        {shownCollections.length ? <section className="distro-group-grid">{shownCollections.map((collection) => <article key={collection.id}><span>{collectionTypeLabels[collection.type]}</span><h2>{localized(collection.names, collection.sourceId)}</h2><p>{localized(collection.descriptions, "发行版维护的可安装软件集合")}</p><small>{collection.members.length.toLocaleString()} 个成员包{collection.children.length ? ` · ${collection.children.length.toLocaleString()} 个子集合` : ""}</small>{collection.members.length > 0 && <div className="collection-members">{collection.members.slice(0, 8).map((member) => <code key={`${member.name}-${member.role}`}>{member.name}</code>)}</div>}</article>)}</section> : <EmptyState title="当前数据还没有精选集合" body="下次发行版 Action 会同步该发行版提供的 Task、Group、Pattern 或元包；完整仓库仍可在高级入口查询。" />}
        {shownCurated.length > 0 && <><div className="section-heading"><div><span className="section-kicker">COLLECTION MEMBERS</span><h2>精选集合中的软件包</h2></div></div><section className="distro-list">{shownCurated.map((item) => <Link href={`/distributions/${entry?.id}/${item.id}?shard=${item.shard}`} className="distro-row" key={item.id}><div><strong>{item.name}</strong><code>{item.version}</code></div><p>{item.summary || "仓库未提供简介"}</p><span>{item.reasons.length.toLocaleString()} 个精选依据</span></Link>)}</section></>}
      </> : <>
        <div className="source-notes"><article><h3>高级数据</h3><p>这里包含依赖库、开发头文件、内核、驱动、调试符号和语言包，主要用于精确查询与本机清单分析。</p></article></div>
        <section className="distro-list">{shownPackages.map((item) => <Link href={`/distributions/${entry?.id}/${item.id}?shard=${item.shard}`} className="distro-row" key={item.id}><div><strong>{item.name}</strong><code>{item.version}</code></div><p>{item.summary || "仓库未提供简介"}</p><span>{item.repository}</span></Link>)}</section>
        {packagesFor === entry?.id && packages.length > shownPackages.length && <p className="distro-limit">当前显示前 {shownPackages.length.toLocaleString()} 项，请输入关键词缩小范围。</p>}
      </>}
    </>}
  </div>;
}
