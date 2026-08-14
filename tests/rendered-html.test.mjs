import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the finished product shell", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /软件源地图/);
  assert.match(html, /看懂软件|开始查软件/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("separates the introduction from the searchable catalog", async () => {
  const [home, catalog] = await Promise.all([render("/"), render("/catalog")]);
  const homeHtml = await home.text();
  const catalogHtml = await catalog.text();
  assert.doesNotMatch(homeHtml, /placeholder="搜索软件/);
  assert.match(catalogHtml, /查软件|搜索软件/);
  assert.match(catalogHtml, /placeholder="搜索软件/);
});

test("renders static inventory and sources routes", async () => {
  const [inventory, sources] = await Promise.all([render("/inventory"), render("/sources")]);
  assert.equal(inventory.status, 200);
  assert.equal(sources.status, 200);
  assert.match(await inventory.text(), /本机清单|看懂这台电脑装了什么/);
  assert.match(await sources.text(), /数据源|从哪里来/);
});

test("keeps catalog data outside JavaScript bundles", async () => {
  const current = JSON.parse(await readFile(new URL("../public/metadata/v1/current.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL(`../public/metadata/v1/${current.manifest}`, import.meta.url), "utf8"));
  const detail = JSON.parse(await readFile(new URL(`../public/metadata/v1/snapshots/${current.snapshotId}/${manifest.files.details.shards["00"].path}`, import.meta.url), "utf8"));
  const files = await (await import("node:fs/promises")).readdir(new URL("../dist/client/assets/", import.meta.url), { recursive: true });
  const scripts = files.filter((file) => String(file).endsWith(".js"));
  const needle = detail.items.flatMap((item) => item.packages).find((item) => item.artifacts[0]?.hash)?.artifacts[0]?.hash;
  assert.ok(needle);
  for (const file of scripts) {
    const content = await readFile(new URL(`../dist/client/assets/${String(file).replaceAll("\\", "/")}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, new RegExp(needle));
  }
  await access(new URL("../dist/client/metadata/v1/current.json", import.meta.url)).catch(async () => access(new URL("../dist/metadata/v1/current.json", import.meta.url)));
  await assert.rejects(access(new URL("../dist/client/metadata/v1/catalog.json", import.meta.url)));
});
