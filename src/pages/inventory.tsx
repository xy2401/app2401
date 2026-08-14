import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalog } from "../catalog-context";
import type { Inventory, InventoryResult } from "../catalog-types";
import { decodeInventoryFragment, validateInventory } from "../inventory-fragment";
import { Link } from "../navigation";
import { ManagerBadge, PlatformBadges } from "../ui";

export default function InventoryPage() {
  const { status, matchInventory } = useCatalog();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<InventoryResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<Inventory | null>(null);
  const fragmentRead = useRef(false);
  const match = useCallback(async (inventory: Inventory, source: "file" | "fragment") => {
    setError("");
    try {
      setResult(await matchInventory(inventory));
      setNotice(source === "fragment" ? "已读取脚本放入地址的本机清单；地址栏中的清单数据已经清除。" : "已从本地文件读取清单。文件没有上传。 ");
    } catch (cause) {
      setResult(null);
      setNotice("");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [matchInventory]);
  const read = async (file: File) => {
    try { await match(validateInventory(JSON.parse(await file.text())), "file"); }
    catch (cause) { setResult(null); setNotice(""); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  useEffect(() => {
    if (fragmentRead.current) return;
    fragmentRead.current = true;
    try {
      const inventory = decodeInventoryFragment(window.location.hash);
      if (!inventory) return;
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      pending.current = inventory;
    } catch (cause) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      const message = cause instanceof Error ? cause.message : String(cause);
      queueMicrotask(() => setError(message));
    }
  }, []);
  useEffect(() => {
    if (status !== "ready" || !pending.current) return;
    const inventory = pending.current;
    pending.current = null;
    void match(inventory, "fragment");
  }, [match, status]);
  return <div className="page-shell inventory-page">
    <header className="inner-hero"><span className="section-kicker">LOCAL INVENTORY</span><h1>看懂这台电脑装了什么</h1><p>选择由脚本生成的 inventory.json。文件只在当前浏览器标签页内读取，与 catalog 在本机匹配，不会上传到任何服务器。</p></header>
    <section className="privacy-callout"><span>LOCAL ONLY</span><div><strong>你的清单不会离开浏览器</strong><p>没有上传接口、账号或后台。页面不会读取用户名、主机名、序列号和 IP。</p></div></section>
    <div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void read(file); }}>
      <div className="drop-symbol">＋</div><h2>放入 inventory.json</h2><p>或者从电脑中选择文件</p><button className="button button-primary" disabled={status !== "ready"} onClick={() => input.current?.click()}>选择本机清单</button><input ref={input} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void read(file); event.target.value = ""; }} /><div className="drop-links"><a href="/examples/inventory.example.json" download>下载示例</a><a href="/metadata/v1/inventory.schema.json" target="_blank">查看 Schema</a></div>
    </div>
    {notice && <div className="inline-notice" role="status">{notice}</div>}
    {error && <div className="inline-error" role="alert"><strong>无法读取清单</strong><p>{error}</p></div>}
    {result && <section className="inventory-result">
      <div className="inventory-summary"><div><strong>{result.matched.length}</strong><span>已识别</span></div><div><strong>{result.unknown.length}</strong><span>未识别</span></div><div><strong>{result.system.os}</strong><span>{result.system.arch}</span></div></div>
      <div className="section-heading"><div><span className="section-kicker">MATCHED</span><h2>已识别的软件</h2></div></div>
      <div className="inventory-list">{result.matched.map(({ installed, package: pkg, software }, index) => <article key={`${pkg.id}-${index}`}><div><ManagerBadge manager={installed.manager} /><h3><Link href={`/software/${encodeURIComponent(software.id)}`}>{software.name}</Link></h3><p>{software.summary || "暂无简介"}</p></div><div className="installed-version"><code>{installed.version || "版本未知"}</code><span>已安装版本</span></div><PlatformBadges platforms={pkg.platforms} /></article>)}</div>
      {result.unknown.length > 0 && <><div className="section-heading unknown-heading"><div><span className="section-kicker">UNKNOWN</span><h2>尚未识别</h2></div></div><div className="unknown-list">{result.unknown.map((item, index) => <div key={`${item.manager}-${item.name}-${index}`}><ManagerBadge manager={item.manager} /><strong>{item.name}</strong><code>{item.version}</code></div>)}</div></>}
    </section>}
  </div>;
}
