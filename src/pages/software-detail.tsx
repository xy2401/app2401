import { useEffect, useState } from "react";
import { useCatalog } from "../catalog-context";
import type { FishCommandRecord, PackageRecord, SoftwareDetail, TldrPageRecord } from "../catalog-types";
import { Link } from "../navigation";
import { CopyButton, LoadingBlock, ManagerBadge, PlatformBadges, ResultCard } from "../ui";

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

function CommandPanel({ command }: { command: FishCommandRecord }) {
  const [showAll, setShowAll] = useState(false);
  const commands = showAll ? command.commands : command.commands.slice(0, 80);
  return <article className="command-panel">
    <div className="command-head">
      <div><span className="manager-badge manager-fish">Fish</span><code>{command.name}</code>{command.wraps.length > 0 && <small>wraps {command.wraps.join(", ")}</small>}</div>
      <div><span>{command.commandCount.toLocaleString()} 条完整命令</span></div>
    </div>
    <div className="command-body">
      {command.dynamicStatementCount > 0 && <p className="dynamic-note">另外有 {command.dynamicStatementCount.toLocaleString()} 条动态补全无法安全展开；网站不会执行 Fish 函数或外部命令。</p>}
      {commands.length > 0 ? <section><h3>命令与解释</h3><div className="command-path-list">{commands.map((item, index) => <a href={item.sourceRef} target="_blank" rel="noreferrer" key={`${item.sourceRef}-${item.command}-${index}`}>
        <code>{item.command}</code><span>{item.description || "Fish 来源未提供解释"}</span>
      </a>)}</div></section> : <p className="command-empty">这个补全文件没有可静态展开、带解释的完整命令。</p>}
      {!showAll && command.commands.length > commands.length && <button className="details-toggle" onClick={() => setShowAll(true)}>显示全部 {command.commandCount.toLocaleString()} 条命令</button>}
      <div className="package-links">{command.sourceRefs.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Fish 来源{command.sourceRefs.length > 1 ? ` ${index + 1}` : ""} ↗</a>)}</div>
    </div>
  </article>;
}

function TldrPagePanel({ page }: { page: TldrPageRecord }) {
  return <article className="tldr-panel">
    <div className="tldr-head">
      <div><span className="manager-badge manager-tldr">TLDR · {page.locale === "zh" ? "简中" : page.locale}</span><h3>{page.title}</h3><p>{page.summary || "TLDR 来源未提供页面简介。"}</p></div>
      <PlatformBadges platforms={[page.platform]} />
    </div>
    <div className="tldr-example-list">{page.examples.map((example, index) => <div className="tldr-example" key={`${example.sourceRef}-${index}`}>
      <p>{example.description}</p>
      <div className="install-line"><code>{example.command}</code><CopyButton value={example.command} /></div>
    </div>)}</div>
    <div className="package-links"><a href={page.sourceRef} target="_blank" rel="noreferrer">TLDR 原始页面 ↗</a></div>
  </article>;
}

function TldrSection({ pages }: { pages: TldrPageRecord[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? pages : pages.slice(0, 24);
  const exampleCount = pages.reduce((sum, page) => sum + page.exampleCount, 0);
  return <section className="command-section"><div className="section-heading"><div><span className="section-kicker">PRACTICAL EXAMPLES</span><h2>TLDR 完整命令与解释</h2></div><span>{pages.length.toLocaleString()} 个命令页 · {exampleCount.toLocaleString()} 个示例</span></div>
    <p className="knowledge-intro">优先显示简体中文完整页面，缺少翻译时整页回退英文。双花括号内容是需要替换的占位符，网站只展示、不执行。</p>
    <div className="command-stack">{shown.map((page) => <TldrPagePanel key={page.id} page={page} />)}</div>
    {!showAll && shown.length < pages.length && <button className="details-toggle section-more" onClick={() => setShowAll(true)}>显示全部 {pages.length.toLocaleString()} 个 TLDR 命令页</button>}
  </section>;
}

export function SoftwarePage({ id }: { id: string }) {
  const { status, detail } = useCatalog();
  const [data, setData] = useState<SoftwareDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (status !== "ready") return; let active = true; void detail(id).then((next) => { if (active) setData(next); }).catch((cause) => { if (active) setError(cause.message); }); return () => { active = false; }; }, [status, id, detail]);
  if (status === "loading" || (!data && !error)) return <div className="page-shell detail-loading"><LoadingBlock /></div>;
  if (error || !data) return <div className="page-shell"><div className="empty-state"><strong>无法打开软件详情</strong><p>{error}</p><Link href="/catalog">返回搜索</Link></div></div>;
  const { software, packages, candidates, commands, tldrPages } = data;
  return (
    <div className="page-shell software-page">
      <Link className="back-link" href="/catalog">← 返回软件目录</Link>
      <header className="software-hero">
        <div><span className="section-kicker">SOFTWARE</span><h1>{software.name}</h1><p>{software.summary || "来源暂未提供软件简介。"}</p></div>
        <div className="software-facts"><PlatformBadges platforms={software.platforms} /><span>{packages.length} 个来源包</span><span>{software.licenses.join(" · ") || "许可证未知"}</span></div>
      </header>
      <div className="identity-links">{software.homepages.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">官网 · {new URL(url).hostname} ↗</a>)}{software.repositories.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">源码 · {new URL(url).hostname} ↗</a>)}</div>
      <section className="package-stack">{packages.map((item) => <PackagePanel key={item.id} item={item} />)}</section>
      {tldrPages.length > 0 && <TldrSection pages={tldrPages} />}
      {commands.length > 0 && <section className="command-section"><div className="section-heading"><div><span className="section-kicker">COMMAND KNOWLEDGE</span><h2>Fish 完整命令与解释</h2></div><span>{commands.reduce((sum, command) => sum + command.commandCount, 0)} 条命令</span></div><div className="command-stack">{commands.map((command) => <CommandPanel key={command.id} command={command} />)}</div></section>}
      {candidates.length > 0 && <section className="candidate-section"><div className="section-heading"><div><span className="section-kicker">POSSIBLE MATCHES</span><h2>同名但未自动合并</h2></div></div><p>这些记录名称相同，但官网或源码不足以确认是同一个软件。</p><div className="result-grid">{candidates.map((item) => <ResultCard item={item} key={item.id} />)}</div></section>}
    </div>
  );
}
