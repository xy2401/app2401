import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { CatalogProvider } from "./catalog-context";
import { SiteHeader } from "./site-header";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: { default: "软件源地图", template: "%s · 软件源地图" },
    description: "一份开放元数据，看懂软件从哪里来、怎样安装、有什么作用。",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "软件源地图", description: "一份元数据，看懂软件从哪里来", type: "website", images: [{ url: new URL("/og.png", base).toString(), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "软件源地图", description: "一份元数据，看懂软件从哪里来", images: [new URL("/og.png", base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <CatalogProvider>
          <SiteHeader />
          <main>{children}</main>
          <footer className="site-footer">
            <span>软件源地图 · 静态开放元数据</span>
            <span>不上传本机清单，不执行安装脚本</span>
          </footer>
        </CatalogProvider>
      </body>
    </html>
  );
}
