import { useEffect } from "react";
import { Link, useLocation } from "./navigation";
import CatalogPage from "./pages/catalog";
import { DistributionPackagePage } from "./pages/distribution-package";
import DistributionsPage from "./pages/distributions";
import HomePage from "./pages/home";
import InventoryPage from "./pages/inventory";
import { SoftwarePage } from "./pages/software-detail";
import { SourcePage } from "./pages/source-detail";
import SourcesPage from "./pages/sources";

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function AppRouter() {
  const location = useLocation();
  const segments = location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  useEffect(() => {
    if (location.hash) {
      document.querySelector(location.hash)?.scrollIntoView();
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [location.pathname, location.hash]);

  if (segments.length === 0) return <HomePage />;
  if (segments.length === 1 && segments[0] === "catalog") return <CatalogPage />;
  if (segments.length === 1 && segments[0] === "distributions") return <DistributionsPage />;
  if (segments.length === 1 && segments[0] === "inventory") return <InventoryPage />;
  if (segments.length === 1 && segments[0] === "sources") return <SourcesPage />;
  if (segments.length === 2 && segments[0] === "software") return <SoftwarePage id={decode(segments[1])} />;
  if (segments.length === 2 && segments[0] === "sources") return <SourcePage sourceId={decode(segments[1])} />;
  if (segments.length === 3 && segments[0] === "distributions") {
    return <DistributionPackagePage distro={decode(segments[1])} id={decode(segments[2])} />;
  }

  return <div className="page-shell"><div className="empty-state"><strong>页面不存在</strong><p>这个地址没有对应页面。</p><Link href="/">返回首页</Link></div></div>;
}
