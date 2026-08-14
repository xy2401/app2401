let manifest = null;
let searchRows = [];
let summariesById = new Map();
let onlineBaseUrl = "";
let localFiles = null;
let localSnapshotPrefix = "";
const detailCache = new Map();
const inventoryCache = new Map();
const sourcePageCache = new Map();
let commandIndex = null;
const commandDetailCache = new Map();
let tldrIndex = null;
const tldrDetailCache = new Map();

const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[._\s/\\-]+/g, " ").trim();
const unique = (items) => [...new Set(items.filter(Boolean))];
const publicSummary = (summary) => ({
  id: summary.id,
  name: summary.name,
  aliases: summary.aliases,
  summary: summary.summary,
  platforms: summary.platforms,
  managers: summary.managers,
  packageCount: summary.packageCount,
  commands: summary.commands,
});

function assertManifest(value) {
  if (!value || value.schemaVersion !== "1.0.0" || value.formatRevision !== "sharded-4" || !value.files?.search || !value.files?.details || !value.files?.tldr || !Array.isArray(value.sources)) {
    throw new Error("这不是有效的分片 catalog v1 清单");
  }
}

function resetCaches() {
  detailCache.clear();
  inventoryCache.clear();
  sourcePageCache.clear();
  commandIndex = null;
  commandDetailCache.clear();
  tldrIndex = null;
  tldrDetailCache.clear();
}

function findLocalEntry(path) {
  const wanted = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const match = [...localFiles.entries()].find(([name]) => name === wanted || name.endsWith(`/${wanted}`));
  if (!match) throw new Error(`本地 catalog 缺少 ${wanted}`);
  return match;
}

function findLocalFile(path) {
  return findLocalEntry(path)[1];
}

async function readData(path) {
  if (localFiles) return JSON.parse(await findLocalFile(`${localSnapshotPrefix}/${path}`).text());
  const response = await fetch(new URL(path, onlineBaseUrl), { cache: "force-cache" });
  if (!response.ok) throw new Error(`无法读取元数据分片 ${path}（${response.status}）`);
  return response.json();
}

async function activate(nextManifest, mode, label) {
  assertManifest(nextManifest);
  manifest = nextManifest;
  resetCaches();
  const search = await readData(nextManifest.files.search.path);
  if (search.snapshotId !== nextManifest.snapshotId || !Array.isArray(search.items)) throw new Error("搜索索引与快照不匹配");
  summariesById = new Map(search.items.map((item) => [item.id, item]));
  searchRows = search.items.map((summary) => {
    const exactNames = unique([summary.name, ...summary.aliases, ...summary.packageNames]).map(normalize);
    const commands = summary.commands.map(normalize);
    return { summary, exactNames, commands, text: normalize([summary.name, summary.aliases.join(" "), summary.packageNames.join(" "), summary.summary, commands.join(" ")].join(" ")) };
  });
  return {
    schemaVersion: nextManifest.schemaVersion,
    generatedAt: nextManifest.generatedAt,
    snapshotId: nextManifest.snapshotId,
    softwareCount: nextManifest.softwareCount,
    packageCount: nextManifest.packageCount,
    commandCount: nextManifest.commandCount || 0,
    tldrPageCount: nextManifest.tldrPageCount || 0,
    tldrTranslationCount: nextManifest.tldrTranslationCount || 0,
    tldrLocaleCount: nextManifest.tldrLocaleCount || 1,
    sources: nextManifest.sources,
    knowledgeSources: nextManifest.knowledgeSources || [],
    mode,
    ...(label ? { fileName: label } : {}),
  };
}

async function loadOnline() {
  localFiles = null;
  localSnapshotPrefix = "";
  const currentResponse = await fetch("/metadata/v1/current.json", { cache: "no-cache" });
  if (!currentResponse.ok) throw new Error(`无法读取当前元数据指针（${currentResponse.status}）`);
  const current = await currentResponse.json();
  if (!current?.manifest) throw new Error("当前元数据指针无效");
  const manifestUrl = new URL(current.manifest, new URL("/metadata/v1/", self.location.origin));
  const response = await fetch(manifestUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error(`无法读取快照清单（${response.status}）`);
  onlineBaseUrl = new URL(".", manifestUrl).href;
  return activate(await response.json(), "online");
}

async function loadFolder(files) {
  localFiles = new Map(files.map((file) => [(file.webkitRelativePath || file.name).replaceAll("\\", "/"), file]));
  const currentEntry = [...localFiles.entries()].find(([name]) => name === "current.json" || name.endsWith("/current.json"));
  if (!currentEntry) throw new Error("所选目录中没有 current.json");
  const current = JSON.parse(await currentEntry[1].text());
  if (!current?.manifest) throw new Error("本地 current.json 无效");
  const manifestEntry = findLocalEntry(current.manifest);
  localSnapshotPrefix = manifestEntry[0].split("/").slice(0, -1).join("/");
  const nextManifest = JSON.parse(await manifestEntry[1].text());
  return activate(nextManifest, "local", currentEntry[0].split("/")[0] || "本地目录");
}

function search({ query = "", managers = [], limit = 60 } = {}) {
  const q = normalize(query);
  const managerSet = new Set(managers);
  return searchRows
    .map((row) => {
      if (managerSet.size && !row.summary.managers.some((manager) => managerSet.has(manager))) return null;
      let score = 1;
      if (q) {
        if (row.exactNames.includes(q)) score = 100;
        else if (row.exactNames.some((name) => name.startsWith(q))) score = 75;
        else if (row.commands.includes(q)) score = 65;
        else if (row.exactNames.some((name) => name.includes(q))) score = 48;
        else if (row.text.includes(q)) score = 20;
        else return null;
      }
      return { ...publicSummary(row.summary), score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.managers.length - a.managers.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

async function getDetailShard(shard) {
  if (!detailCache.has(shard)) {
    const descriptor = manifest.files.details.shards[shard];
    if (!descriptor) throw new Error(`快照中没有详情分片 ${shard}`);
    const data = await readData(descriptor.path);
    if (data.snapshotId !== manifest.snapshotId || data.shard !== shard) throw new Error(`详情分片 ${shard} 与快照不匹配`);
    detailCache.set(shard, new Map(data.items.map((item) => [item.software.id, item])));
  }
  return detailCache.get(shard);
}

async function getCommandIndex() {
  if (!manifest.files.commands) return new Map();
  if (!commandIndex) {
    const data = await readData(manifest.files.commands.index.path);
    if (data.snapshotId !== manifest.snapshotId || !Array.isArray(data.items)) throw new Error("命令索引与快照不匹配");
    commandIndex = new Map(data.items.map((item) => [item.id, item]));
  }
  return commandIndex;
}

async function getCommandDetailShard(shard) {
  if (!commandDetailCache.has(shard)) {
    const descriptor = manifest.files.commands?.details?.shards?.[shard];
    if (!descriptor) throw new Error(`快照中没有命令分片 ${shard}`);
    const data = await readData(descriptor.path);
    if (data.snapshotId !== manifest.snapshotId || data.shard !== shard) throw new Error(`命令分片 ${shard} 与快照不匹配`);
    commandDetailCache.set(shard, new Map(data.items.map((item) => [item.id, item])));
  }
  return commandDetailCache.get(shard);
}

async function getTldrIndex() {
  if (!manifest.files.tldr) return new Map();
  if (!tldrIndex) {
    const data = await readData(manifest.files.tldr.index.path);
    if (data.snapshotId !== manifest.snapshotId || !Array.isArray(data.items)) throw new Error("TLDR 索引与快照不匹配");
    tldrIndex = new Map(data.items.map((item) => [item.id, item]));
  }
  return tldrIndex;
}

async function getTldrDetailShard(shard) {
  if (!tldrDetailCache.has(shard)) {
    const descriptor = manifest.files.tldr?.details?.shards?.[shard];
    if (!descriptor) throw new Error(`快照中没有 TLDR 分片 ${shard}`);
    const data = await readData(descriptor.path);
    if (data.snapshotId !== manifest.snapshotId || data.shard !== shard) throw new Error(`TLDR 分片 ${shard} 与快照不匹配`);
    tldrDetailCache.set(shard, new Map(data.items.map((item) => [item.id, item])));
  }
  return tldrDetailCache.get(shard);
}

async function getTldrLocaleDetailShard(locale, shard) {
  const cacheKey = `${locale}:${shard}`;
  if (!tldrDetailCache.has(cacheKey)) {
    const descriptor = manifest.files.tldr?.locales?.[locale]?.shards?.[shard];
    if (!descriptor) return new Map();
    const data = await readData(descriptor.path);
    if (data.snapshotId !== manifest.snapshotId || data.locale !== locale || data.shard !== shard) throw new Error(`TLDR ${locale} 分片 ${shard} 与快照不匹配`);
    tldrDetailCache.set(cacheKey, new Map(data.items.map((item) => [item.id, item])));
  }
  return tldrDetailCache.get(cacheKey);
}

async function detail({ id }) {
  const summary = summariesById.get(id);
  if (!summary) throw new Error("没有找到这个软件");
  const item = (await getDetailShard(summary.shard)).get(id);
  if (!item) throw new Error("软件详情分片中缺少这条记录");
  const index = await getCommandIndex();
  const commandSummaries = (item.software.commandIds || []).map((commandId) => index.get(commandId)).filter(Boolean);
  await Promise.all(unique(commandSummaries.map((command) => command.shard)).map(getCommandDetailShard));
  const commands = commandSummaries.map((command) => commandDetailCache.get(command.shard)?.get(command.id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const tldrPageIndex = await getTldrIndex();
  const tldrSummaries = (item.software.tldrPageIds || []).map((pageId) => tldrPageIndex.get(pageId)).filter(Boolean);
  await Promise.all(unique(tldrSummaries.map((page) => page.shard)).map(getTldrDetailShard));
  const preferredLocale = manifest.files.tldr.locales?.zh ? "zh" : "en";
  if (preferredLocale !== "en") await Promise.all(unique(tldrSummaries.map((page) => page.shard)).map((shard) => getTldrLocaleDetailShard(preferredLocale, shard)));
  const tldrPages = tldrSummaries.map((page) => {
    const translated = preferredLocale === "en" ? null : tldrDetailCache.get(`${preferredLocale}:${page.shard}`)?.get(page.id);
    return translated || tldrDetailCache.get(page.shard)?.get(page.id);
  }).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform));
  return {
    software: item.software,
    packages: [...item.packages].sort((a, b) => a.manager.localeCompare(b.manager) || a.collection.localeCompare(b.collection)),
    candidates: item.software.candidateSoftwareIds.map((candidateId) => summariesById.get(candidateId)).filter(Boolean).map(publicSummary),
    commands,
    tldrPages,
  };
}

async function getSourcePage(path) {
  if (!sourcePageCache.has(path)) sourcePageCache.set(path, await readData(path));
  return sourcePageCache.get(path);
}

async function browseSource({ sourceId, query = "", offset = 0, limit = 80 }) {
  const index = manifest.files.sources[sourceId];
  if (!index) throw new Error("没有找到这个数据源");
  const q = normalize(query);
  if (q) {
    const pages = await Promise.all(index.pages.map((page) => getSourcePage(page.path)));
    const matches = pages.flatMap((page) => page.items).filter(({ package: item }) => normalize(`${item.name} ${item.title} ${item.description}`).includes(q));
    return { total: matches.length, items: matches.slice(offset, offset + limit) };
  }
  const pageNumber = Math.floor(offset / index.pageSize);
  const descriptor = index.pages[pageNumber];
  if (!descriptor) return { total: index.total, items: [] };
  const page = await getSourcePage(descriptor.path);
  const withinPage = offset % index.pageSize;
  return { total: index.total, items: page.items.slice(withinPage, withinPage + limit) };
}

async function getInventoryIndex(manager) {
  if (!inventoryCache.has(manager)) {
    const descriptor = manifest.files.inventory[manager];
    if (!descriptor) throw new Error(`当前 catalog 不支持 ${manager}`);
    const data = await readData(descriptor.path);
    if (data.snapshotId !== manifest.snapshotId || data.manager !== manager) throw new Error(`${manager} 索引与快照不匹配`);
    inventoryCache.set(manager, data.packages);
  }
  return inventoryCache.get(manager);
}

async function matchInventory({ inventory }) {
  if (!inventory || inventory.schemaVersion !== "1.0.0" || !inventory.system || !Array.isArray(inventory.packages)) throw new Error("这不是有效的 inventory v1 文件");
  const managers = unique(inventory.packages.map((item) => item.manager));
  const indexes = Object.fromEntries(await Promise.all(managers.map(async (manager) => [manager, await getInventoryIndex(manager)])));
  const pendingMatches = [];
  const unknown = [];
  for (const installed of inventory.packages) {
    const choices = indexes[installed.manager]?.[normalize(installed.name)] || [];
    const selected = (installed.collection ? choices.find((item) => normalize(item.collection) === normalize(installed.collection)) : null) || choices.find((item) => item.status === "active") || choices[0];
    if (!selected) unknown.push(installed);
    else pendingMatches.push({ installed, selected });
  }
  await Promise.all(unique(pendingMatches.map((item) => item.selected.shard)).map(getDetailShard));
  const matched = pendingMatches.map(({ installed, selected }) => {
    const item = detailCache.get(selected.shard).get(selected.softwareId);
    const pkg = item?.packages.find((candidate) => candidate.id === selected.packageId);
    if (!item || !pkg) return null;
    return { installed, package: pkg, software: item.software };
  }).filter(Boolean);
  return { system: inventory.system, generatedAt: inventory.generatedAt, matched, unknown };
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    let data;
    if (type === "loadOnline") data = await loadOnline();
    else if (type === "loadFolder") data = await loadFolder(payload.files);
    else {
      if (!manifest) throw new Error("元数据尚未加载");
      if (type === "search") data = search(payload);
      else if (type === "detail") data = await detail(payload);
      else if (type === "browseSource") data = await browseSource(payload);
      else if (type === "matchInventory") data = await matchInventory(payload);
      else throw new Error("未知操作");
    }
    self.postMessage({ id, ok: true, data });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
