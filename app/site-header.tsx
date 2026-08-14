"use client";

import Link from "next/link";
import { useRef } from "react";
import { useCatalog } from "./catalog-context";

export function SiteHeader() {
  const { status, meta, error, loadLocalCatalog, loadOnlineCatalog } = useCatalog();
  const input = useRef<HTMLInputElement>(null);
  const label = status === "loading" ? "正在读取元数据" : status === "error" ? "元数据不可用" : meta?.mode === "local" ? `本地 · ${meta.fileName}` : `在线快照 · ${meta?.snapshotId || ""}`;

  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand" aria-label="软件源地图首页">
          <span className="brand-mark">源</span>
          <span><strong>软件源地图</strong><small>Software source atlas</small></span>
        </Link>
        <nav aria-label="主导航">
          <Link href="/">介绍</Link>
          <Link href="/catalog">查软件</Link>
          <Link href="/sources">数据源</Link>
          <Link href="/inventory">本机清单</Link>
        </nav>
        <div className={`catalog-state state-${status}`} title={error || label}>
          <span className="state-dot" />{label}
        </div>
        <div className="header-actions">
          <button className="button button-quiet" onClick={() => input.current?.click()}>选择本地元数据目录</button>
          {meta?.mode === "local" && <button className="button button-quiet" onClick={() => void loadOnlineCatalog().catch(() => undefined)}>切回在线</button>}
          <input ref={input} hidden type="file" multiple accept="application/json,.json" {...{ webkitdirectory: "" }} onChange={(event) => { const files = Array.from(event.target.files || []); if (files.length) void loadLocalCatalog(files).catch(() => undefined); event.target.value = ""; }} />
        </div>
      </header>
      {status === "error" && <div className="global-error" role="alert"><strong>无法读取元数据：</strong>{error} <button onClick={() => void loadOnlineCatalog().catch(() => undefined)}>重试在线快照</button></div>}
    </>
  );
}
