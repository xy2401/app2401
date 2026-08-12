"use client";

import Link from "next/link";
import { useState } from "react";
import type { Manager, SoftwareSummary } from "./catalog-types";

export const managerLabels: Record<Manager, string> = { scoop: "Scoop", chocolatey: "Chocolatey", homebrew: "Homebrew" };

export function ManagerBadge({ manager }: { manager: Manager }) {
  return <span className={`manager-badge manager-${manager}`}>{managerLabels[manager]}</span>;
}

export function PlatformBadges({ platforms }: { platforms: string[] }) {
  return <span className="platform-list">{platforms.map((platform) => <span className="platform-badge" key={platform}>{platform}</span>)}</span>;
}

export function ResultCard({ item }: { item: SoftwareSummary }) {
  return (
    <Link className="result-card" href={`/software/${encodeURIComponent(item.id)}`}>
      <div className="result-top"><h3>{item.name}</h3><span className="package-count">{item.packageCount} 个包</span></div>
      <p>{item.summary || "来源暂未提供软件简介。"}</p>
      <div className="result-meta"><span>{item.managers.map((manager) => <ManagerBadge key={manager} manager={manager} />)}</span><PlatformBadges platforms={item.platforms} /></div>
      {item.commands.length > 0 && <code className="command-preview">{item.commands.slice(0, 4).join(" · ")}</code>}
    </Link>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="copy-button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "已复制" : "复制"}</button>;
}

export function LoadingBlock({ label = "正在整理元数据…" }: { label?: string }) {
  return <div className="loading-block" role="status"><span className="loader" />{label}</div>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>;
}
