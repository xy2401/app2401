import { CatalogProvider } from "./catalog-context";
import { AppRouter } from "./router";
import { SiteHeader } from "./site-header";

export function App() {
  return (
    <CatalogProvider>
      <SiteHeader />
      <main><AppRouter /></main>
      <footer className="site-footer">
        <span>软件源地图 · 静态开放元数据</span>
        <span>不上传本机清单，不执行安装脚本</span>
      </footer>
    </CatalogProvider>
  );
}
