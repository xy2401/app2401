import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("builds a static Cloudflare Pages shell", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /软件源地图/);
  assert.match(html, /\/assets\/[^"]+\.js/);
  assert.doesNotMatch(html, /vinext|wrangler|_worker/i);

  const redirects = await readFile(new URL("../dist/_redirects", import.meta.url), "utf8");
  assert.equal(redirects.trim(), "/* /index.html 200");
  const headers = await readFile(new URL("../dist/_headers", import.meta.url), "utf8");
  assert.match(headers, /\/metadata\/v1\/snapshots\/\*/);
  assert.match(headers, /Cache-Control: public, max-age=31536000, immutable/);
  await access(new URL("../dist/catalog-search-worker.js", import.meta.url));
  await assert.rejects(access(new URL("../dist/catalog-worker.js", import.meta.url)));
  await assert.rejects(access(new URL("../dist/_worker.js", import.meta.url)));
  await assert.rejects(access(new URL("../dist/server", import.meta.url)));
});

test("keeps introduction, catalog and dynamic routes in the browser router", async () => {
  const [home, catalog, router] = await Promise.all([
    readFile(new URL("../src/pages/home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/catalog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/router.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(home, /placeholder="搜索软件/);
  assert.match(home, /开始查软件/);
  assert.match(catalog, /placeholder="搜索软件/);
  assert.match(router, /SoftwarePage/);
  assert.match(router, /SourcePage/);
  assert.match(router, /DistributionPackagePage/);
});

test("keeps catalog data outside JavaScript bundles", async () => {
  const current = JSON.parse(await readFile(new URL("../public/metadata/v1/current.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL(`../public/metadata/v1/${current.manifest}`, import.meta.url), "utf8"));
  const detail = JSON.parse(await readFile(new URL(`../public/metadata/v1/snapshots/${current.snapshotId}/${manifest.files.details.shards["00"].path}`, import.meta.url), "utf8"));
  const files = await readdir(new URL("../dist/assets/", import.meta.url), { recursive: true });
  const scripts = files.filter((file) => String(file).endsWith(".js"));
  const needle = detail.items.flatMap((item) => item.packages).find((item) => item.artifacts[0]?.hash)?.artifacts[0]?.hash;
  assert.ok(needle);
  for (const file of scripts) {
    const content = await readFile(new URL(`../dist/assets/${String(file).replaceAll("\\", "/")}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, new RegExp(needle));
  }
  await access(new URL("../dist/metadata/v1/current.json", import.meta.url));
  await assert.rejects(access(new URL("../dist/metadata/v1/catalog.json", import.meta.url)));
});

test("keeps every Cloudflare Pages asset below 25 MiB", async () => {
  const root = new URL("../dist/", import.meta.url);
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  const oversized = [];
  for (const file of files) {
    if (!file.isFile()) continue;
    const size = (await stat(join(file.parentPath, file.name))).size;
    if (size > 25 * 1024 * 1024) oversized.push(`${file.name}: ${size}`);
  }
  assert.deepEqual(oversized, []);
});

test("publishes only the active catalog snapshot", async () => {
  const current = JSON.parse(await readFile(new URL("../public/metadata/v1/current.json", import.meta.url), "utf8"));
  const entries = await readdir(new URL("../public/metadata/v1/snapshots/", import.meta.url), { withFileTypes: true });
  assert.deepEqual(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name), [current.snapshotId]);
});
