let catalog = null;
let softwareById = new Map();
let packagesBySoftware = new Map();
let packageLookup = new Map();
let searchRows = [];

const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[._\s/\\-]+/g, " ").trim();
const unique = (items) => [...new Set(items.filter(Boolean))];

function assertCatalog(value) {
  if (!value || value.schemaVersion !== "1.0.0" || !Array.isArray(value.software) || !Array.isArray(value.packages) || !Array.isArray(value.sources)) {
    throw new Error("这不是有效的 catalog v1 文件");
  }
}

function summarize(software) {
  const packages = packagesBySoftware.get(software.id) || [];
  return {
    id: software.id,
    name: software.name,
    aliases: software.aliases,
    summary: software.summary,
    platforms: software.platforms,
    managers: unique(packages.map((item) => item.manager)),
    packageCount: packages.length,
    commands: unique(packages.flatMap((item) => item.commands)).slice(0, 8),
  };
}

function activate(next, mode, fileName) {
  assertCatalog(next);
  catalog = next;
  softwareById = new Map(next.software.map((item) => [item.id, item]));
  packagesBySoftware = new Map();
  packageLookup = new Map();
  for (const item of next.packages) {
    if (!packagesBySoftware.has(item.softwareId)) packagesBySoftware.set(item.softwareId, []);
    packagesBySoftware.get(item.softwareId).push(item);
    const key = `${item.manager}:${normalize(item.name)}`;
    if (!packageLookup.has(key)) packageLookup.set(key, []);
    packageLookup.get(key).push(item);
  }
  searchRows = next.software.map((software) => {
    const summary = summarize(software);
    const exactNames = unique([software.name, ...software.aliases, ...(packagesBySoftware.get(software.id) || []).map((item) => item.name)]).map(normalize);
    const commands = summary.commands.map(normalize);
    return { software, summary, exactNames, commands, text: normalize([software.name, software.aliases.join(" "), software.summary, commands.join(" ")].join(" ")) };
  });
  return {
    schemaVersion: next.schemaVersion,
    generatedAt: next.generatedAt,
    softwareCount: next.software.length,
    packageCount: next.packages.length,
    sources: next.sources,
    mode,
    ...(fileName ? { fileName } : {}),
  };
}

async function loadOnline() {
  const response = await fetch("/metadata/v1/catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`无法读取在线 catalog（${response.status}）`);
  return activate(await response.json(), "online");
}

async function loadFile(file) {
  return activate(JSON.parse(await file.text()), "local", file.name);
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
      return { ...row.summary, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.managers.length - a.managers.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function detail({ id }) {
  const software = softwareById.get(id);
  if (!software) throw new Error("没有找到这个软件");
  return {
    software,
    packages: (packagesBySoftware.get(id) || []).sort((a, b) => a.manager.localeCompare(b.manager) || a.collection.localeCompare(b.collection)),
    candidates: software.candidateSoftwareIds.map((candidateId) => softwareById.get(candidateId)).filter(Boolean).map(summarize),
  };
}

function browseSource({ sourceId, query = "", offset = 0, limit = 80 }) {
  const q = normalize(query);
  const matches = catalog.packages.filter((item) => item.sourceId === sourceId && (!q || normalize(`${item.name} ${item.title} ${item.description}`).includes(q)));
  return {
    total: matches.length,
    items: matches.slice(offset, offset + limit).map((item) => ({ package: item, software: softwareById.get(item.softwareId) })),
  };
}

function matchInventory({ inventory }) {
  if (!inventory || inventory.schemaVersion !== "1.0.0" || !inventory.system || !Array.isArray(inventory.packages)) throw new Error("这不是有效的 inventory v1 文件");
  const matched = [];
  const unknown = [];
  for (const installed of inventory.packages) {
    const choices = packageLookup.get(`${installed.manager}:${normalize(installed.name)}`) || [];
    const selected = (installed.collection ? choices.find((item) => normalize(item.collection) === normalize(installed.collection)) : null) || choices.find((item) => item.status === "active") || choices[0];
    if (!selected) unknown.push(installed);
    else matched.push({ installed, package: selected, software: softwareById.get(selected.softwareId) });
  }
  return { system: inventory.system, generatedAt: inventory.generatedAt, matched, unknown };
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    let data;
    if (type === "loadOnline") data = await loadOnline();
    else if (type === "loadFile") data = await loadFile(payload.file);
    else {
      if (!catalog) throw new Error("元数据尚未加载");
      if (type === "search") data = search(payload);
      else if (type === "detail") data = detail(payload);
      else if (type === "browseSource") data = browseSource(payload);
      else if (type === "matchInventory") data = matchInventory(payload);
      else throw new Error("未知操作");
    }
    self.postMessage({ id, ok: true, data });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
