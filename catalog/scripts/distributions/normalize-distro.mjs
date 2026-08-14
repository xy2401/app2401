import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { parseArgs, parseOsRelease, readJson, sha256, unique, writeJson, compareText } from "../lib/metadata-common.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.distro || !args["raw-dir"] || !args.output) throw new Error("Usage: --distro <id> --raw-dir <directory> --output <file>");
const root = resolve(import.meta.dirname, "../../..");
const config = await readJson(join(root, "catalog", "config", "distribution-sources.json"));
const source = config.distributions.find((entry) => entry.id === args.distro);
if (!source) throw new Error(`Unsupported distribution: ${args.distro}`);
const rawDir = resolve(args["raw-dir"]);

async function optionalText(path) {
  try { return await readFile(path, "utf8"); } catch { return ""; }
}

function paragraphs(text) {
  const records = [];
  let record = {};
  let lastKey = "";
  for (const line of String(text).replaceAll("\r", "").split("\n")) {
    if (!line) {
      if (Object.keys(record).length) records.push(record);
      record = {};
      lastKey = "";
      continue;
    }
    if (/^\s/.test(line) && lastKey) record[lastKey] = `${record[lastKey]}\n${line.trim()}`;
    else {
      const separator = line.indexOf(":");
      if (separator < 1) continue;
      lastKey = line.slice(0, separator);
      record[lastKey] = line.slice(separator + 1).trim();
    }
  }
  if (Object.keys(record).length) records.push(record);
  return records;
}

const depList = (value) => unique(String(value || "").split(/[,\n]/).map((item) => item.trim()));
const emptyDependencies = () => ({ requires: [], recommends: [], suggests: [], provides: [], conflicts: [], replaces: [] });

function packageRecord(data, versionId) {
  const architecture = String(data.architecture || "amd64").replace("x86_64", "amd64");
  const repository = String(data.repository || "unknown");
  const name = String(data.name || "").trim();
  return {
    id: sha256([source.id, versionId, repository, name, architecture].join("\u0000")).slice(0, 20),
    name,
    ...(data.epoch ? { epoch: String(data.epoch) } : {}),
    version: String(data.version || ""),
    ...(data.release ? { release: String(data.release) } : {}),
    architecture,
    summary: String(data.summary || ""),
    description: String(data.description || data.summary || ""),
    ...(data.homepage ? { homepage: String(data.homepage) } : {}),
    ...(data.license ? { license: String(data.license) } : {}),
    ...(data.maintainer ? { maintainer: String(data.maintainer) } : {}),
    ...(data.sourcePackage ? { sourcePackage: String(data.sourcePackage) } : {}),
    ...(data.category ? { category: String(data.category) } : {}),
    repository,
    ...(Number.isFinite(Number(data.installedSize)) ? { installedSize: Number(data.installedSize) } : {}),
    ...(Number.isFinite(Number(data.downloadSize)) ? { downloadSize: Number(data.downloadSize) } : {}),
    dependencies: {
      ...emptyDependencies(),
      ...(data.dependencies || {}),
    },
  };
}

function parseApt(text, versionId) {
  return paragraphs(text).filter((entry) => entry.Package).map((entry) => {
    const description = entry.Description || "";
    const [summary, ...rest] = description.split("\n");
    const version = String(entry.Version || "");
    const epochSplit = version.includes(":") ? version.split(/:(.*)/s) : ["", version];
    const releaseSplit = epochSplit[1].match(/^(.*?)-([^-]+)$/);
    return packageRecord({
      name: entry.Package,
      epoch: epochSplit[0],
      version: releaseSplit?.[1] || epochSplit[1],
      release: releaseSplit?.[2] || "",
      architecture: entry.Architecture,
      summary,
      description: rest.join("\n").replace(/^\.\n?/gm, "\n").trim() || summary,
      homepage: entry.Homepage,
      maintainer: entry.Maintainer,
      sourcePackage: entry.Source?.split(/\s/)[0],
      category: entry.Section,
      repository: entry["APT-Sources"]?.split(/\s/)[0] || "official",
      installedSize: Number(entry["Installed-Size"] || 0) * 1024,
      dependencies: {
        requires: depList(entry.Depends), recommends: depList(entry.Recommends), suggests: depList(entry.Suggests),
        provides: depList(entry.Provides), conflicts: depList(entry.Conflicts), replaces: depList(entry.Replaces),
      },
    }, versionId);
  });
}

function parseApk(text, versionId) {
  const keyMap = { P: "name", V: "version", A: "architecture", T: "summary", U: "homepage", L: "license", m: "maintainer", o: "sourcePackage", I: "installedSize", S: "downloadSize" };
  return paragraphs(text).filter((entry) => entry.P).map((entry) => {
    const data = Object.fromEntries(Object.entries(keyMap).map(([key, name]) => [name, entry[key] || ""]));
    data.repository = "official";
    data.description = data.summary;
    data.dependencies = { requires: depList(entry.D?.replaceAll(" ", ",")), recommends: [], suggests: [], provides: depList(entry.p?.replaceAll(" ", ",")), conflicts: depList(entry.c?.replaceAll(" ", ",")), replaces: depList(entry.r?.replaceAll(" ", ",")) };
    return packageRecord(data, versionId);
  });
}

function parseTsv(text, versionId, kind) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => line.split("\t")).filter((fields) => fields[0]).map((fields) => {
    if (kind === "arch") return packageRecord({
      name: fields[0], version: fields[1], architecture: fields[2], summary: fields[3], description: fields[3], homepage: fields[4], license: fields[5],
      repository: fields[6], installedSize: fields[7], downloadSize: fields[8], dependencies: { requires: depList(fields[9]), recommends: [], suggests: depList(fields[10]), provides: depList(fields[11]), conflicts: depList(fields[12]), replaces: depList(fields[13]) },
    }, versionId);
    const evr = fields[1] || "";
    const epochParts = evr.includes(":") ? evr.split(/:(.*)/s) : ["", evr];
    const releaseParts = epochParts[1].match(/^(.*)-([^-]+)$/);
    return packageRecord({
      name: fields[0], epoch: epochParts[0], version: releaseParts?.[1] || epochParts[1], release: releaseParts?.[2] || "", architecture: fields[2], summary: fields[3], description: fields[4],
      homepage: fields[5], license: fields[6], repository: fields[7], downloadSize: fields[8], sourcePackage: fields[9],
      dependencies: { requires: depList(fields[10]?.replaceAll(" ", ",")), recommends: depList(fields[11]?.replaceAll(" ", ",")), suggests: depList(fields[12]?.replaceAll(" ", ",")), provides: depList(fields[13]?.replaceAll(" ", ",")), conflicts: depList(fields[14]?.replaceAll(" ", ",")), replaces: depList(fields[15]?.replaceAll(" ", ",")) },
    }, versionId);
  });
}

function parseRpmRecords(text, versionId) {
  return text.split("\x1e").map((record) => record.replace(/^\r?\n/, "")).filter(Boolean).map((record) => record.split("\x1f")).filter((fields) => fields[0]).map((fields) => packageRecord({
    name: fields[0],
    epoch: fields[1],
    version: fields[2],
    release: fields[3],
    architecture: fields[4],
    summary: fields[5],
    description: fields[6],
    homepage: fields[7],
    license: fields[8],
    repository: fields[9],
    downloadSize: fields[10],
    installedSize: fields[11],
    sourcePackage: fields[12],
    dependencies: {
      requires: depList(fields[13]), recommends: depList(fields[14]), suggests: depList(fields[15]),
      provides: depList(fields[16]), conflicts: depList(fields[17]), replaces: depList(fields[18]),
    },
  }, versionId));
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", isArray: (name) => ["solvable", "group", "environment", "name", "description", "packagereq", "groupid", "optionid"].includes(name) });
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const nodeText = (value) => typeof value === "object" ? String(value?.["#text"] || "") : String(value || "");

function parseZypper(text, versionId) {
  if (!text.trim()) return [];
  const parsed = xmlParser.parse(text);
  const nodes = parsed?.stream?.["search-result"]?.["solvable-list"]?.solvable || [];
  return asArray(nodes).map((entry) => packageRecord({ name: entry["@_name"], version: entry["@_edition"], architecture: entry["@_arch"], summary: entry["@_summary"] || "", description: entry["@_summary"] || "", repository: entry["@_repository"] || "official" }, versionId));
}

function localized(nodes) {
  const output = {};
  for (const node of asArray(nodes)) {
    const locale = typeof node === "object" ? node["@_xml:lang"] || node["@_lang"] || "en" : "en";
    const value = nodeText(node).trim();
    if (value) output[locale] = value;
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => compareText(a, b)));
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path)); else output.push(path);
  }
  return output;
}

async function parseComps() {
  const groups = [];
  const environments = [];
  const files = (await walk(rawDir)).filter((path) => /comps.*\.xml$/i.test(basename(path))).sort(compareText);
  for (const path of files) {
    const parsed = xmlParser.parse(await readFile(path, "utf8"));
    const comps = parsed.comps || parsed;
    for (const group of asArray(comps.group)) {
      const packages = asArray(group.packagelist?.packagereq).map((entry) => ({ name: nodeText(entry), type: entry["@_type"] || "optional", ...(entry["@_requires"] ? { requires: entry["@_requires"] } : {}) })).filter((entry) => entry.name);
      groups.push({ id: nodeText(group.id), names: localized(group.name), descriptions: localized(group.description), visible: nodeText(group.uservisible) !== "false", default: nodeText(group.default) === "true", ...(group.langonly ? { langOnly: nodeText(group.langonly) } : {}), packages });
    }
    for (const environment of asArray(comps.environment)) environments.push({ id: nodeText(environment.id), names: localized(environment.name), descriptions: localized(environment.description), groups: unique(asArray(environment.grouplist?.groupid).map(nodeText)), optionalGroups: unique(asArray(environment.optionlist?.groupid || environment.optionlist?.optionid).map(nodeText)) });
  }
  return { groups, environments };
}

async function parseCollections() {
  const collections = [];
  const taskText = await optionalText(join(rawDir, "tasks.tsv"));
  for (const line of taskText.split(/\r?\n/).filter(Boolean)) {
    const [id, description = "", packageList = ""] = line.split("\t");
    if (!id) continue;
    collections.push({
      id,
      type: "task",
      names: { en: description || id },
      descriptions: {},
      visible: true,
      default: false,
      installTarget: id,
      members: unique(packageList.split(",").map((name) => name.trim()).filter(Boolean)).map((name) => ({ name, role: "default" })),
    });
  }

  const groupMembers = new Map();
  const groupText = await optionalText(join(rawDir, "groups.tsv"));
  for (const line of groupText.split(/\r?\n/).filter(Boolean)) {
    const [id, name] = line.split("\t");
    if (!id || !name) continue;
    const members = groupMembers.get(id) || [];
    members.push({ name, role: "default" });
    groupMembers.set(id, members);
  }
  for (const [id, members] of groupMembers) collections.push({ id, type: "group", names: { en: id }, descriptions: {}, visible: true, default: false, installTarget: id, members });

  const patternsText = await optionalText(join(rawDir, "patterns.xml"));
  if (patternsText.trim()) {
    const parsed = xmlParser.parse(patternsText);
    const nodes = parsed?.stream?.["search-result"]?.["solvable-list"]?.solvable || [];
    for (const entry of asArray(nodes)) {
      const id = entry["@_name"];
      if (!id) continue;
      const summary = entry["@_summary"] || id;
      collections.push({ id, type: "pattern", names: { en: summary }, descriptions: {}, visible: true, default: false, installTarget: id, members: [] });
    }
  }
  return collections.sort((a, b) => compareText(`${a.type}\0${a.id}`, `${b.type}\0${b.id}`));
}

const meta = await readJson(join(rawDir, "meta.json"));
const osRelease = parseOsRelease(await optionalText(join(rawDir, "os-release")));
const versionId = osRelease.VERSION_ID || meta.versionId || "rolling";
let packages = [];
if (source.family === "debian") packages = parseApt(await optionalText(join(rawDir, "packages.txt")), versionId);
else if (source.family === "alpine") packages = parseApk(await optionalText(join(rawDir, "packages.txt")), versionId);
else if (source.family === "arch") packages = parseTsv(await optionalText(join(rawDir, "packages.tsv")), versionId, "arch");
else if (source.id === "opensuse-leap") packages = parseZypper(await optionalText(join(rawDir, "packages.xml")), versionId);
else packages = parseRpmRecords(await optionalText(join(rawDir, "packages.records")), versionId);

const deduped = new Map();
for (const item of packages) if (item.name) deduped.set([item.repository, item.name, item.architecture].join("\u0000"), item);
packages = [...deduped.values()].sort((a, b) => compareText(a.id, b.id));
const repositoryJson = await optionalText(join(rawDir, "repositories.json"));
const repositories = (repositoryJson ? JSON.parse(repositoryJson).filter((entry) => entry.is_enabled !== false).map((entry) => ({ id: entry.id, name: entry.name || entry.id, ...(entry.base_url?.[0] || entry.mirrorlist || entry.metalink ? { url: entry.base_url?.[0] || entry.mirrorlist || entry.metalink } : {}), ...(entry.revision ? { revision: String(entry.revision) } : {}) })) : (await optionalText(join(rawDir, "repositories.tsv"))).split(/\r?\n/).filter(Boolean).map((line) => {
  const [id, name, url, revision] = line.split("\t");
  return { id, name: name || id, ...(url ? { url } : {}), ...(revision ? { revision } : {}) };
})).sort((a, b) => compareText(a.id, b.id));
const comps = await parseComps();
const collections = await parseCollections();

await writeJson(resolve(args.output), {
  schemaVersion: "1.0.0",
  generatedAt: args["generated-at"] || meta.generatedAt || new Date().toISOString(),
  distribution: { id: source.id, name: osRelease.NAME || source.label, versionId, family: source.family, arch: "amd64" },
  image: { reference: source.image, digest: meta.digest || "unknown" },
  repositories,
  packages,
  groups: comps.groups.sort((a, b) => compareText(a.id, b.id)),
  environments: comps.environments.sort((a, b) => compareText(a.id, b.id)),
  collections,
});
