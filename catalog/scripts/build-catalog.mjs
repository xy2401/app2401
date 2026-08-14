import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseFishCompletionFile } from "./lib/parse-fish-completions.mjs";
import { parseTldrPage } from "./lib/parse-tldr-page.mjs";

const root = resolve(import.meta.dirname, "../..");
const outputRoot = join(root, "public", "metadata", "v1");
const schemaPath = join(root, "catalog", "schemas", "catalog-v1.schema.json");
const inventorySchemaPath = join(root, "catalog", "schemas", "inventory-v1.schema.json");
const indexSchemaPath = join(root, "catalog", "schemas", "catalog-index-v1.schema.json");
const commandSchemaPath = join(root, "catalog", "schemas", "command-v1.schema.json");
const tldrSchemaPath = join(root, "catalog", "schemas", "tldr-v1.schema.json");
const overridesPath = join(root, "catalog", "config", "identity-overrides.json");
const formatRevision = "sharded-4";
const detailShardNames = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));
const tldrShardNames = Array.from({ length: 16 }, (_, index) => index.toString(16));
const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, textNodeName: "#text" });

const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const strings = (value) => [...new Set(array(value).flat(Infinity).filter((item) => item != null).map((item) => String(item).trim()).filter(Boolean))];
const text = (value) => value == null ? "" : typeof value === "object" && "#text" in value ? String(value["#text"] ?? "").trim() : String(value).trim();
const sortUnique = (items) => [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
const sha = (value, length = 12) => createHash("sha256").update(String(value)).digest("hex").slice(0, length);
const slugify = (value) => String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "software";
const posix = (path) => path.split(sep).join("/");
const gitWebUrl = (value) => String(value || "").replace(/\.git$/i, "");
const normalizeName = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[._\s/\\-]+/g, " ").trim();

function normalizeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\.git$/i, "").replace(/\/$/, "") || "/";
    url.search = "";
    return `//${url.host}${url.pathname === "/" ? "" : url.pathname}`.toLowerCase();
  } catch {
    return String(value).trim().toLowerCase().replace(/\/$/, "");
  }
}

function repositoryFrom(value) {
  if (!value) return "";
  const candidate = normalizeUrl(value);
  if (/^\/\/(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\//.test(candidate)) return `https:${candidate}`;
  return "";
}

function licenseStrings(value) {
  if (!value) return [];
  if (typeof value === "string") return strings(value);
  if (typeof value === "object") return strings([value.identifier, value.url, value.type]);
  return [];
}

function git(repo, args) {
  try {
    return execFileSync("git", ["-c", "safe.directory=*", "-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

async function walk(directory, predicate) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path, predicate));
    else if (!predicate || predicate(path)) output.push(path);
  }
  return output;
}

function scoopArtifacts(manifest) {
  const artifacts = [];
  const add = (urlValue, hashValue, architecture) => {
    const urls = array(urlValue);
    const hashes = array(hashValue);
    urls.forEach((url, index) => {
      if (!url) return;
      artifacts.push({ url: String(url), ...(hashes[index] ? { hash: String(hashes[index]) } : {}), ...(architecture ? { architecture } : {}), kind: "download" });
    });
  };
  add(manifest.url, manifest.hash, "any");
  for (const [architecture, branch] of Object.entries(manifest.architecture ?? {})) add(branch.url, branch.hash, architecture);
  return artifacts;
}

function scoopCommands(value) {
  return sortUnique(array(value).map((entry) => Array.isArray(entry) ? entry[1] || basename(String(entry[0] ?? "")) : basename(String(entry))).map((name) => name.replace(/\.(exe|cmd|bat|ps1)$/i, "")));
}

async function parseScoop() {
  const rootDir = join(root, "sources", "scoop");
  const buckets = (await readdir(rootDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const packages = [];
  const sources = [];
  for (const bucket of buckets) {
    const repo = join(rootDir, bucket);
    const bucketDir = join(repo, "bucket");
    const files = (await readdir(bucketDir)).filter((name) => name.endsWith(".json")).sort();
    const commit = git(repo, ["rev-parse", "HEAD"]);
    const remote = git(repo, ["remote", "get-url", "origin"]);
    sources.push({
      id: `scoop:${bucket}`,
      manager: "scoop",
      label: `Scoop ${bucket}`,
      tier: "known-bucket",
      itemCount: files.length,
      snapshot: commit,
      snapshotAt: git(repo, ["show", "-s", "--format=%cI", "HEAD"]),
      sourceUrl: remote,
    });
    for (const file of files) {
      const manifest = JSON.parse(await readFile(join(bucketDir, file), "utf8"));
      const name = basename(file, ".json");
      const architectures = manifest.architecture ? Object.keys(manifest.architecture) : ["any"];
      const repository = repositoryFrom(manifest.checkver?.github || manifest.autoupdate?.url || manifest.homepage);
      packages.push({
        id: `scoop:${bucket}:${name.toLowerCase()}`,
        softwareId: "",
        manager: "scoop",
        sourceId: `scoop:${bucket}`,
        collection: bucket,
        name,
        title: name,
        version: text(manifest.version),
        description: text(manifest.description),
        homepage: text(manifest.homepage),
        repository,
        licenses: licenseStrings(manifest.license),
        platforms: ["windows"],
        architectures: sortUnique(architectures),
        installCommand: `scoop install ${bucket}/${name}`,
        artifacts: scoopArtifacts(manifest),
        dependencies: sortUnique(strings(manifest.depends)),
        commands: scoopCommands(manifest.bin),
        status: "active",
        sourceRef: `${gitWebUrl(remote)}/blob/${commit}/bucket/${file}`,
        sourceDetails: {
          type: "scoop",
          bin: manifest.bin ?? null,
          shortcuts: manifest.shortcuts ?? null,
          persist: manifest.persist ?? null,
          envAddPath: manifest.env_add_path ?? null,
          envSet: manifest.env_set ?? null,
          architecture: manifest.architecture ?? null,
          installer: manifest.installer ?? null,
          uninstaller: manifest.uninstaller ?? null,
          preInstall: manifest.pre_install ?? null,
          postInstall: manifest.post_install ?? null,
          notes: manifest.notes ?? null,
        },
      });
    }
  }
  return { sources, packages };
}

function chocolateyDependencies(value) {
  if (!value) return [];
  const deps = value.dependency ?? value;
  return sortUnique(array(deps).map((dep) => typeof dep === "string" ? dep : dep?.["@_id"]).filter(Boolean));
}

async function parseChocolatey() {
  const repo = join(root, "sources", "chocolatey", "community-packages");
  const files = (await walk(repo, (path) => path.toLowerCase().endsWith(".nuspec"))).sort();
  const packages = [];
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const remote = git(repo, ["remote", "get-url", "origin"]);
  for (const file of files) {
    const parsed = xml.parse(await readFile(file, "utf8"));
    const metadata = parsed.package?.metadata;
    if (!metadata?.id) continue;
    const name = text(metadata.id);
    if (!name || name.includes("{{")) continue;
    const packageDir = dirname(file);
    const relativeFile = posix(relative(repo, file));
    const allFiles = await walk(packageDir);
    const scriptRefs = allFiles.filter((path) => /chocolatey(?:install|uninstall|beforemodify)\.ps1$/i.test(path)).map((path) => posix(relative(root, path))).sort();
    const packageSource = text(metadata.packageSourceUrl);
    const projectSource = text(metadata.projectSourceUrl);
    packages.push({
      id: `chocolatey:community:${name.toLowerCase()}:${sha(relativeFile, 8)}`,
      softwareId: "",
      manager: "chocolatey",
      sourceId: "chocolatey:community-packages",
      collection: posix(relative(repo, packageDir)).split("/")[0] || "community",
      name,
      title: text(metadata.title) || name,
      version: text(metadata.version),
      description: text(metadata.summary) || text(metadata.description).replace(/\s+/g, " ").slice(0, 600),
      homepage: text(metadata.projectUrl),
      repository: repositoryFrom(projectSource || packageSource),
      licenses: sortUnique(strings([metadata.license, metadata.licenseUrl])),
      platforms: ["windows"],
      architectures: ["any"],
      installCommand: `choco install ${name}`,
      artifacts: [],
      dependencies: chocolateyDependencies(metadata.dependencies),
      commands: [],
      status: posix(relative(repo, file)).startsWith("deprecated/") ? "deprecated" : posix(relative(repo, file)).startsWith("unlisted/") ? "unlisted" : "active",
      sourceRef: `${gitWebUrl(remote)}/blob/${commit}/${relativeFile}`,
      sourceDetails: {
        type: "chocolatey",
        authors: strings(metadata.authors),
        owners: strings(metadata.owners),
        tags: strings(text(metadata.tags).split(/\s+/)),
        docsUrl: text(metadata.docsUrl),
        bugTrackerUrl: text(metadata.bugTrackerUrl),
        iconUrl: text(metadata.iconUrl),
        packageSourceUrl: packageSource,
        projectSourceUrl: projectSource,
        scriptRefs,
      },
    });
  }
  return {
    sources: [{
      id: "chocolatey:community-packages",
      manager: "chocolatey",
      label: "Chocolatey Community Maintainers",
      tier: "curated-community",
      itemCount: files.length,
      snapshot: commit,
      snapshotAt: git(repo, ["show", "-s", "--format=%cI", "HEAD"]),
      sourceUrl: remote,
    }],
    packages,
  };
}

function homebrewStatus(item) {
  return item.disabled ? "disabled" : item.deprecated ? "deprecated" : "active";
}

async function parseHomebrew() {
  const sourceRoot = join(root, "sources", "homebrew");
  const snapshot = JSON.parse(await readFile(join(sourceRoot, "snapshot.json"), "utf8"));
  const formulae = JSON.parse(await readFile(join(sourceRoot, "api", "formula.json"), "utf8"));
  const casks = JSON.parse(await readFile(join(sourceRoot, "api", "cask.json"), "utf8"));
  const packages = [];
  for (const item of formulae) {
    const url = item.urls?.stable?.url || item.urls?.head?.url || "";
    packages.push({
      id: `homebrew:formula:${item.name.toLowerCase()}`,
      softwareId: "",
      manager: "homebrew",
      sourceId: "homebrew:formula",
      collection: "formula",
      name: item.name,
      title: item.full_name || item.name,
      version: text(item.versions?.stable || item.versions?.head),
      description: text(item.desc),
      homepage: text(item.homepage),
      repository: repositoryFrom(item.urls?.head?.url || url),
      licenses: licenseStrings(item.license),
      platforms: ["macos", "linux"],
      architectures: ["any"],
      installCommand: `brew install ${item.name}`,
      artifacts: url ? [{ url, ...(item.urls?.stable?.checksum ? { hash: item.urls.stable.checksum } : {}), kind: item.versions?.bottle ? "source-or-bottle" : "source" }] : [],
      dependencies: sortUnique(strings([item.dependencies, item.build_dependencies, item.test_dependencies, item.recommended_dependencies, item.optional_dependencies])),
      commands: [item.name],
      status: homebrewStatus(item),
      sourceRef: `https://formulae.brew.sh/formula/${encodeURIComponent(item.name)}`,
      sourceDetails: {
        type: "homebrew-formula",
        fullName: item.full_name,
        versions: item.versions,
        bottle: item.bottle ?? null,
        service: item.service ?? null,
        usesFromMacos: item.uses_from_macos ?? [],
        requirements: item.requirements ?? [],
        caveats: item.caveats ?? "",
      },
    });
  }
  for (const item of casks) {
    const names = strings(item.name);
    const url = text(item.url);
    packages.push({
      id: `homebrew:cask:${item.token.toLowerCase()}`,
      softwareId: "",
      manager: "homebrew",
      sourceId: "homebrew:cask",
      collection: "cask",
      name: item.token,
      title: names[0] || item.token,
      version: text(item.version),
      description: text(item.desc),
      homepage: text(item.homepage),
      repository: repositoryFrom(url),
      licenses: [],
      platforms: ["macos"],
      architectures: sortUnique(strings(item.depends_on?.arch || ["any"])),
      installCommand: `brew install --cask ${item.token}`,
      artifacts: url ? [{ url, ...(item.sha256 && item.sha256 !== "no_check" ? { hash: item.sha256 } : {}), kind: "cask" }] : [],
      dependencies: sortUnique(strings([item.depends_on?.formula, item.depends_on?.cask])),
      commands: [],
      status: homebrewStatus(item),
      sourceRef: `https://formulae.brew.sh/cask/${encodeURIComponent(item.token)}`,
      sourceDetails: {
        type: "homebrew-cask",
        fullToken: item.full_token,
        names,
        artifacts: item.artifacts ?? [],
        dependsOn: item.depends_on ?? {},
        conflictsWith: item.conflicts_with ?? null,
        autoUpdates: Boolean(item.auto_updates),
        caveats: item.caveats ?? "",
        variations: item.variations ?? {},
        supportedPlatforms: item.supported_platforms ?? [],
      },
    });
  }
  const meta = Object.fromEntries(snapshot.sources.map((source) => [source.name, source]));
  return {
    sources: [
      { id: "homebrew:formula", manager: "homebrew", label: "Homebrew Formulae", tier: "official-index", itemCount: formulae.length, snapshot: meta.formula?.sha256 || "unknown", snapshotAt: snapshot.generatedAt, sourceUrl: meta.formula?.url || "https://formulae.brew.sh/api/formula.json" },
      { id: "homebrew:cask", manager: "homebrew", label: "Homebrew Casks", tier: "official-index", itemCount: casks.length, snapshot: meta.cask?.sha256 || "unknown", snapshotAt: snapshot.generatedAt, sourceUrl: meta.cask?.url || "https://formulae.brew.sh/api/cask.json" },
    ],
    packages,
  };
}

async function parseFish(packages) {
  const repo = join(root, "sources", "fish", "fish-shell");
  const completionsRoot = join(repo, "share", "completions");
  const files = (await readdir(completionsRoot)).filter((name) => name.endsWith(".fish")).sort();
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const remote = git(repo, ["remote", "get-url", "origin"]);
  const records = new Map();
  for (const file of files) {
    const source = await readFile(join(completionsRoot, file), "utf8");
    for (const parsed of parseFishCompletionFile(source, file)) {
      const key = parsed.name;
      if (!records.has(key)) records.set(key, { name: key, wraps: [], commandPaths: [], sourceRefs: [], statementCount: 0, dynamicStatementCount: 0 });
      const record = records.get(key);
      const sourceBase = `${gitWebUrl(remote)}/blob/${commit}/share/completions/${file}`;
      record.wraps.push(...parsed.wraps);
      record.commandPaths.push(...parsed.commandPaths.map((item) => ({ ...item, dynamic: false, sourceRef: `${sourceBase}#L${item.line}` })));
      record.sourceRefs.push(sourceBase);
      record.statementCount += parsed.statementCount;
      record.dynamicStatementCount += parsed.dynamicStatementCount;
    }
  }

  const explicitProviders = new Map();
  const nameProviders = new Map();
  const addProvider = (map, name, softwareId) => {
    const key = normalizeName(name);
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(softwareId);
  };
  for (const pkg of packages) {
    for (const command of pkg.commands) addProvider(explicitProviders, command, pkg.softwareId);
    addProvider(nameProviders, pkg.name, pkg.softwareId);
  }

  const uniqueObjects = (items) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
  const commands = [...records.values()].map((record) => {
    const explicit = explicitProviders.get(normalizeName(record.name)) || new Set();
    const fallback = nameProviders.get(normalizeName(record.name)) || new Set();
    const softwareIds = explicit.size ? [...explicit].sort() : fallback.size === 1 ? [...fallback] : [];
    const candidateSoftwareIds = explicit.size || fallback.size < 2 ? [] : [...fallback].sort();
    const commandPaths = uniqueObjects(record.commandPaths).sort((a, b) => a.command.localeCompare(b.command) || a.line - b.line);
    return {
      id: `command--${sha(record.name, 12)}`,
      name: record.name,
      shell: "fish",
      wraps: sortUnique(record.wraps),
      softwareIds,
      candidateSoftwareIds,
      commandCount: commandPaths.length,
      statementCount: record.statementCount,
      dynamicStatementCount: record.dynamicStatementCount,
      commands: commandPaths,
      sourceRefs: sortUnique(record.sourceRefs),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    source: {
      id: "fish:completions",
      type: "command-completions",
      label: "Fish Shell Completions",
      tier: "official-repository",
      itemCount: files.length,
      recordCount: commands.length,
      snapshot: commit,
      snapshotAt: git(repo, ["show", "-s", "--format=%cI", "HEAD"]),
      sourceUrl: remote,
    },
    commands,
  };
}

async function parseTldr(packages) {
  const repo = join(root, "sources", "tldr", "tldr");
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const remote = git(repo, ["remote", "get-url", "origin"]);
  const pageDirectories = (await readdir(repo, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && (entry.name === "pages" || entry.name.startsWith("pages.")))
    .map((entry) => entry.name)
    .sort((a, b) => a === "pages" ? -1 : b === "pages" ? 1 : a.localeCompare(b, "en"));

  const explicitProviders = new Map();
  const nameProviders = new Map();
  const addProvider = (map, name, softwareId) => {
    const key = normalizeName(name);
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(softwareId);
  };
  for (const pkg of packages) {
    for (const command of pkg.commands) addProvider(explicitProviders, command, pkg.softwareId);
    addProvider(nameProviders, pkg.name, pkg.softwareId);
  }

  const providerLink = (command) => {
    const explicit = explicitProviders.get(normalizeName(command)) || new Set();
    const fallback = nameProviders.get(normalizeName(command)) || new Set();
    return {
      softwareIds: explicit.size ? [...explicit].sort() : fallback.size === 1 ? [...fallback] : [],
      candidateSoftwareIds: explicit.size || fallback.size < 2 ? [] : [...fallback].sort(),
    };
  };
  const parseDirectory = async (directoryName) => {
    const pagesRoot = join(repo, directoryName);
    const sourceLocale = directoryName === "pages" ? "en" : directoryName.slice("pages.".length);
    const locale = sourceLocale.replaceAll("_", "-");
    const files = (await walk(pagesRoot, (path) => path.endsWith(".md"))).sort();
    const records = [];
    for (const file of files) {
      const relativePath = posix(relative(pagesRoot, file));
      const parsed = parseTldrPage(await readFile(file, "utf8"), relativePath);
      const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
      const sourceRef = `${gitWebUrl(remote)}/blob/${commit}/${directoryName}/${encodedPath}`;
      records.push({
        id: `tldr--${sha(relativePath, 12)}`,
        canonicalPath: relativePath,
        locale,
        sourceLocale,
        name: parsed.rootCommand,
        title: parsed.title,
        summary: parsed.summary,
        platform: parsed.platform,
        ...providerLink(parsed.rootCommand),
        exampleCount: parsed.examples.length,
        examples: parsed.examples.map((example) => ({ ...example, sourceRef: `${sourceRef}#L${example.line}` })),
        sourceRef,
      });
    }
    records.sort((a, b) => a.id.localeCompare(b.id));
    return { locale, sourceLocale, sourceDirectory: directoryName, records };
  };

  const parsedLocales = [];
  for (const directoryName of pageDirectories) parsedLocales.push(await parseDirectory(directoryName));
  const english = parsedLocales.find((item) => item.locale === "en");
  if (!english) throw new Error("TLDR English pages directory is missing");
  const canonicalByPath = new Map(english.records.map((page) => [page.canonicalPath, page]));
  const translations = parsedLocales.filter((item) => item.locale !== "en").map((item) => ({
    ...item,
    records: item.records.map((record) => {
      const canonical = canonicalByPath.get(record.canonicalPath);
      return canonical ? {
        ...record,
        name: canonical.name,
        softwareIds: canonical.softwareIds,
        candidateSoftwareIds: canonical.candidateSoftwareIds,
      } : record;
    }),
  }));
  const allPages = parsedLocales.flatMap((item) => item.records);
  const locales = parsedLocales.map(({ locale, sourceLocale, sourceDirectory, records }) => ({
    locale,
    sourceLocale,
    sourceDirectory,
    itemCount: records.length,
    coverage: Number((records.length / english.records.length).toFixed(6)),
  }));
  return {
    source: {
      id: "tldr:pages",
      type: "command-examples",
      label: "TLDR Pages",
      tier: "curated-community",
      itemCount: allPages.length,
      recordCount: english.records.length,
      localeCount: locales.length,
      translationCount: allPages.length - english.records.length,
      exampleCount: allPages.reduce((sum, page) => sum + page.exampleCount, 0),
      snapshot: commit,
      snapshotAt: git(repo, ["show", "-s", "--format=%cI", "HEAD"]),
      sourceUrl: remote,
    },
    pages: english.records,
    translations,
    locales,
  };
}

class UnionFind {
  constructor(items) { this.parent = new Map(items.map((item) => [item, item])); }
  find(item) { const parent = this.parent.get(item); if (parent !== item) this.parent.set(item, this.find(parent)); return this.parent.get(item); }
  union(a, b) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.parent.set(rb, ra); }
}

function identityKeys(pkg) {
  const keys = [];
  const homepage = normalizeUrl(pkg.homepage);
  const repository = normalizeUrl(pkg.repository);
  if (homepage) keys.push(`home:${homepage}`);
  if (repository) keys.push(`repo:${repository}`);
  return keys;
}

async function buildSoftware(packages) {
  const overrides = JSON.parse(await readFile(overridesPath, "utf8"));
  const uf = new UnionFind(packages.map((pkg) => pkg.id));
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const blocked = new Set(overrides.separatePairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const groupsByName = Map.groupBy(packages, (pkg) => pkg.name.toLowerCase());
  for (const group of groupsByName.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]; const b = group[j];
        if (a.manager === b.manager || blocked.has(`${a.id}|${b.id}`)) continue;
        const bKeys = new Set(identityKeys(b));
        if (identityKeys(a).some((key) => bKeys.has(key))) uf.union(a.id, b.id);
      }
    }
  }
  for (const ids of overrides.mergeGroups) {
    const valid = ids.filter((id) => byId.has(id));
    valid.slice(1).forEach((id) => uf.union(valid[0], id));
  }
  const clusters = Map.groupBy(packages, (pkg) => uf.find(pkg.id));
  const software = [];
  const usedSoftwareIds = new Set();
  for (const cluster of clusters.values()) {
    cluster.sort((a, b) => a.id.localeCompare(b.id));
    const preferred = [...cluster].sort((a, b) => Number(Boolean(b.description)) - Number(Boolean(a.description)) || a.title.localeCompare(b.title))[0];
    const identity = sortUnique(cluster.flatMap(identityKeys)).join("|") || cluster.map((pkg) => pkg.id).join("|");
    const baseSoftwareId = `${slugify(preferred.name)}--${sha(identity, 8)}`;
    const softwareId = usedSoftwareIds.has(baseSoftwareId) ? `${slugify(preferred.name)}--${sha(`${identity}|${cluster.map((pkg) => pkg.id).join("|")}`, 8)}` : baseSoftwareId;
    usedSoftwareIds.add(softwareId);
    cluster.forEach((pkg) => { pkg.softwareId = softwareId; });
    software.push({
      id: softwareId,
      name: preferred.title || preferred.name,
      aliases: sortUnique(cluster.flatMap((pkg) => [pkg.name, pkg.title]).filter((name) => name !== preferred.title)),
      summary: preferred.description,
      homepages: sortUnique(cluster.map((pkg) => pkg.homepage)),
      repositories: sortUnique(cluster.map((pkg) => pkg.repository)),
      licenses: sortUnique(cluster.flatMap((pkg) => pkg.licenses)),
      platforms: sortUnique(cluster.flatMap((pkg) => pkg.platforms)),
      packageIds: cluster.map((pkg) => pkg.id).sort(),
      sourceIds: sortUnique(cluster.map((pkg) => pkg.sourceId)),
      candidateSoftwareIds: [],
    });
  }
  const softwareByPackage = new Map(packages.map((pkg) => [pkg.id, pkg.softwareId]));
  for (const group of groupsByName.values()) {
    const ids = sortUnique(group.map((pkg) => softwareByPackage.get(pkg.id)));
    if (ids.length < 2) continue;
    for (const item of software.filter((entry) => ids.includes(entry.id))) item.candidateSoftwareIds = ids.filter((id) => id !== item.id);
  }
  return software.sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  const [scoop, chocolatey, homebrew] = await Promise.all([parseScoop(), parseChocolatey(), parseHomebrew()]);
  const packages = [...scoop.packages, ...chocolatey.packages, ...homebrew.packages].sort((a, b) => a.id.localeCompare(b.id));
  const software = await buildSoftware(packages);
  const [fish, tldr] = await Promise.all([parseFish(packages), parseTldr(packages)]);
  const fishCommandsBySoftware = new Map();
  for (const command of fish.commands) {
    for (const softwareId of command.softwareIds) {
      if (!fishCommandsBySoftware.has(softwareId)) fishCommandsBySoftware.set(softwareId, []);
      fishCommandsBySoftware.get(softwareId).push(command);
    }
  }
  const tldrPagesBySoftware = new Map();
  for (const page of tldr.pages) {
    for (const softwareId of page.softwareIds) {
      if (!tldrPagesBySoftware.has(softwareId)) tldrPagesBySoftware.set(softwareId, []);
      tldrPagesBySoftware.get(softwareId).push(page);
    }
  }
  for (const item of software) item.commandIds = sortUnique((fishCommandsBySoftware.get(item.id) || []).map((command) => command.id));
  for (const item of software) item.tldrPageIds = sortUnique((tldrPagesBySoftware.get(item.id) || []).map((page) => page.id));
  const sources = [...scoop.sources, ...chocolatey.sources, ...homebrew.sources].sort((a, b) => a.id.localeCompare(b.id));
  const knowledgeSources = [fish.source, tldr.source];
  const snapshotTimes = [...sources, ...knowledgeSources].map((source) => Date.parse(source.snapshotAt)).filter(Number.isFinite);
  const catalog = {
    schemaVersion: "1.0.0",
    generatedAt: process.env.CATALOG_GENERATED_AT || new Date(Math.max(...snapshotTimes)).toISOString(),
    sources,
    software,
    packages,
  };
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  if (!ajv.validate(schema, catalog)) throw new Error(ajv.errorsText(ajv.errors, { separator: "\n" }));

  const overridesHash = createHash("sha256").update(await readFile(overridesPath)).digest("hex");
  const snapshotHashInput = JSON.stringify({
    schemaVersion: catalog.schemaVersion,
    formatRevision,
    overridesHash,
    sources: [...sources, ...knowledgeSources].map(({ id, snapshot }) => ({ id, snapshot })),
  });
  const snapshotId = `${catalog.generatedAt.slice(0, 7)}-${sha(snapshotHashInput, 10)}`;
  const snapshotRoot = join(outputRoot, "snapshots", snapshotId);
  const packageGroups = Map.groupBy(packages, (item) => item.softwareId);
  const softwareById = new Map(software.map((item) => [item.id, item]));
  const detailShard = (softwareId) => createHash("sha256").update(softwareId).digest("hex").slice(0, 2);
  const summaryFor = (item) => {
    const related = packageGroups.get(item.id) || [];
    return {
      id: item.id,
      name: item.name,
      aliases: item.aliases,
      summary: item.summary,
      platforms: item.platforms,
      managers: sortUnique(related.map((pkg) => pkg.manager)),
      packageCount: related.length,
      commands: sortUnique([
        ...related.flatMap((pkg) => pkg.commands),
        ...(fishCommandsBySoftware.get(item.id) || []).map((command) => command.name),
        ...(tldrPagesBySoftware.get(item.id) || []).flatMap((page) => [page.name, page.title]),
      ]).slice(0, 18),
      packageNames: sortUnique(related.map((pkg) => pkg.name)),
      shard: detailShard(item.id),
    };
  };
  const searchItems = software.map(summaryFor);

  await mkdir(outputRoot, { recursive: true });
  await mkdir(snapshotRoot, { recursive: true });

  const writeDataFile = async (relativePath, value) => {
    const target = join(snapshotRoot, ...relativePath.split("/"));
    const body = `${JSON.stringify(value, null, 2)}\n`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return {
      path: relativePath,
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  };

  const searchFile = await writeDataFile("search.json", {
    schemaVersion: catalog.schemaVersion,
    snapshotId,
    items: searchItems,
  });
  searchFile.records = searchItems.length;

  const commandDetailShard = (commandId) => createHash("sha256").update(commandId).digest("hex").slice(0, 2);
  const commandIndexItems = fish.commands.map((command) => ({
    id: command.id,
    name: command.name,
    shell: command.shell,
    wraps: command.wraps,
    softwareIds: command.softwareIds,
    candidateSoftwareIds: command.candidateSoftwareIds,
    commandCount: command.commandCount,
    dynamicStatementCount: command.dynamicStatementCount,
    shard: commandDetailShard(command.id),
  }));
  const commandIndexFile = await writeDataFile("commands/index.json", {
    schemaVersion: catalog.schemaVersion,
    snapshotId,
    sourceId: fish.source.id,
    items: commandIndexItems,
  });
  commandIndexFile.records = commandIndexItems.length;
  const commandDetailFiles = {};
  for (const shard of detailShardNames) {
    const items = fish.commands.filter((command) => commandDetailShard(command.id) === shard);
    commandDetailFiles[shard] = await writeDataFile(`commands/details/${shard}.json`, {
      schemaVersion: catalog.schemaVersion,
      snapshotId,
      shard,
      items,
    });
    commandDetailFiles[shard].records = items.length;
  }

  const tldrDetailShard = (page) => createHash("sha256").update(normalizeName(page.name)).digest("hex").slice(0, 1);
  const tldrIndexItems = tldr.pages.map((page) => ({
    id: page.id,
    name: page.name,
    title: page.title,
    summary: page.summary,
    platform: page.platform,
    softwareIds: page.softwareIds,
    candidateSoftwareIds: page.candidateSoftwareIds,
    exampleCount: page.exampleCount,
    shard: tldrDetailShard(page),
  }));
  const tldrIndexFile = await writeDataFile("tldr/index.json", {
    schemaVersion: catalog.schemaVersion,
    snapshotId,
    sourceId: tldr.source.id,
    items: tldrIndexItems,
  });
  tldrIndexFile.records = tldrIndexItems.length;
  const tldrDetailFiles = {};
  for (const shard of tldrShardNames) {
    const items = tldr.pages.filter((page) => tldrDetailShard(page) === shard);
    tldrDetailFiles[shard] = await writeDataFile(`tldr/details/${shard}.json`, {
      schemaVersion: catalog.schemaVersion,
      snapshotId,
      shard,
      items,
    });
    tldrDetailFiles[shard].records = items.length;
  }
  const tldrLocaleFiles = {};
  for (const locale of tldr.translations) {
    const localeShardFiles = {};
    for (const shard of tldrShardNames) {
      const items = locale.records.filter((page) => tldrDetailShard(page) === shard);
      localeShardFiles[shard] = await writeDataFile(`tldr/locales/${locale.locale}/details/${shard}.json`, {
        schemaVersion: catalog.schemaVersion,
        snapshotId,
        locale: locale.locale,
        sourceLocale: locale.sourceLocale,
        shard,
        items,
      });
      localeShardFiles[shard].records = items.length;
    }
    tldrLocaleFiles[locale.locale] = {
      locale: locale.locale,
      sourceLocale: locale.sourceLocale,
      sourceDirectory: locale.sourceDirectory,
      itemCount: locale.records.length,
      algorithm: "sha256-command-prefix",
      prefixLength: 1,
      pathTemplate: `tldr/locales/${locale.locale}/details/{shard}.json`,
      shards: localeShardFiles,
    };
  }
  const tldrLocalesFile = await writeDataFile("tldr/locales.json", {
    schemaVersion: catalog.schemaVersion,
    snapshotId,
    defaultLocale: "en",
    locales: tldr.locales,
  });
  tldrLocalesFile.records = tldr.locales.length;

  const inventoryFiles = {};
  for (const manager of ["scoop", "chocolatey", "homebrew"]) {
    const index = {};
    for (const pkg of packages.filter((item) => item.manager === manager)) {
      const key = normalizeName(pkg.name);
      if (!index[key]) index[key] = [];
      index[key].push({
        packageId: pkg.id,
        softwareId: pkg.softwareId,
        collection: pkg.collection,
        status: pkg.status,
        shard: detailShard(pkg.softwareId),
      });
    }
    for (const key of Object.keys(index)) index[key].sort((a, b) => a.packageId.localeCompare(b.packageId));
    const orderedIndex = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b, "en")));
    inventoryFiles[manager] = await writeDataFile(`inventory/${manager}.json`, {
      schemaVersion: catalog.schemaVersion,
      snapshotId,
      manager,
      packages: orderedIndex,
    });
    inventoryFiles[manager].records = packages.filter((item) => item.manager === manager).length;
  }

  const detailFiles = {};
  for (const shard of detailShardNames) {
    const items = software
      .filter((item) => detailShard(item.id) === shard)
      .map((item) => ({ software: item, packages: packageGroups.get(item.id) || [] }));
    detailFiles[shard] = await writeDataFile(`details/${shard}.json`, {
      schemaVersion: catalog.schemaVersion,
      snapshotId,
      shard,
      items,
    });
    detailFiles[shard].records = items.length;
  }

  const sourceIndexes = {};
  const sourcePageSize = 250;
  for (const source of sources) {
    const sourcePackages = packages.filter((item) => item.sourceId === source.id);
    const pages = [];
    for (let offset = 0; offset < sourcePackages.length; offset += sourcePageSize) {
      const page = Math.floor(offset / sourcePageSize);
      const items = sourcePackages.slice(offset, offset + sourcePageSize).map((pkg) => {
        const softwareItem = softwareById.get(pkg.softwareId);
        return {
          package: {
            id: pkg.id,
            softwareId: pkg.softwareId,
            manager: pkg.manager,
            sourceId: pkg.sourceId,
            collection: pkg.collection,
            name: pkg.name,
            title: pkg.title,
            version: pkg.version,
            description: pkg.description,
            platforms: pkg.platforms,
            status: pkg.status,
          },
          software: {
            id: softwareItem.id,
            name: softwareItem.name,
            summary: softwareItem.summary,
            platforms: softwareItem.platforms,
          },
        };
      });
      const descriptor = await writeDataFile(`sources/${slugify(source.id)}/${String(page).padStart(3, "0")}.json`, {
        schemaVersion: catalog.schemaVersion,
        snapshotId,
        sourceId: source.id,
        page,
        pageSize: sourcePageSize,
        total: sourcePackages.length,
        items,
      });
      descriptor.records = items.length;
      pages.push(descriptor);
    }
    sourceIndexes[source.id] = { total: sourcePackages.length, pageSize: sourcePageSize, pages };
  }

  const manifest = {
    schemaVersion: catalog.schemaVersion,
    formatRevision,
    snapshotId,
    generatedAt: catalog.generatedAt,
    softwareCount: software.length,
    packageCount: packages.length,
    commandCount: fish.commands.length,
    tldrPageCount: tldr.pages.length,
    tldrTranslationCount: tldr.source.translationCount,
    tldrLocaleCount: tldr.source.localeCount,
    sources,
    knowledgeSources,
    files: {
      search: searchFile,
      commands: {
        index: commandIndexFile,
        details: {
          algorithm: "sha256-prefix",
          prefixLength: 2,
          pathTemplate: "commands/details/{shard}.json",
          shards: commandDetailFiles,
        },
      },
      tldr: {
        index: tldrIndexFile,
        localesIndex: tldrLocalesFile,
        details: {
          algorithm: "sha256-command-prefix",
          prefixLength: 1,
          pathTemplate: "tldr/details/{shard}.json",
          shards: tldrDetailFiles,
        },
        locales: tldrLocaleFiles,
      },
      inventory: inventoryFiles,
      details: {
        algorithm: "sha256-prefix",
        prefixLength: 2,
        pathTemplate: "details/{shard}.json",
        shards: detailFiles,
      },
      sources: sourceIndexes,
    },
  };
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = join(snapshotRoot, "manifest.json");
  await writeFile(manifestPath, manifestBody);
  const current = {
    schemaVersion: catalog.schemaVersion,
    snapshotId,
    generatedAt: catalog.generatedAt,
    manifest: `snapshots/${snapshotId}/manifest.json`,
    manifestBytes: Buffer.byteLength(manifestBody),
    manifestSha256: createHash("sha256").update(manifestBody).digest("hex"),
  };
  await writeFile(join(outputRoot, "current.json"), `${JSON.stringify(current, null, 2)}\n`);
  await rm(join(outputRoot, "catalog.json"), { force: true });
  await rm(join(outputRoot, "manifest.json"), { force: true });
  await copyFile(schemaPath, join(outputRoot, "catalog.schema.json"));
  await copyFile(indexSchemaPath, join(outputRoot, "catalog-index.schema.json"));
  await copyFile(commandSchemaPath, join(outputRoot, "command.schema.json"));
  await copyFile(tldrSchemaPath, join(outputRoot, "tldr.schema.json"));
  await copyFile(inventorySchemaPath, join(outputRoot, "inventory.schema.json"));
  const snapshotBytes = Object.values(detailFiles).reduce((sum, item) => sum + item.bytes, 0)
    + Object.values(commandDetailFiles).reduce((sum, item) => sum + item.bytes, 0)
    + Object.values(tldrDetailFiles).reduce((sum, item) => sum + item.bytes, 0)
    + Object.values(tldrLocaleFiles).flatMap((item) => Object.values(item.shards)).reduce((sum, item) => sum + item.bytes, 0)
    + Object.values(inventoryFiles).reduce((sum, item) => sum + item.bytes, 0)
    + Object.values(sourceIndexes).flatMap((item) => item.pages).reduce((sum, item) => sum + item.bytes, 0)
    + searchFile.bytes + commandIndexFile.bytes + tldrIndexFile.bytes + tldrLocalesFile.bytes + Buffer.byteLength(manifestBody);
  console.log(`snapshot ${snapshotId}: ${software.length} software, ${packages.length} packages, ${fish.commands.length} Fish commands, ${tldr.pages.length} TLDR pages + ${tldr.source.translationCount} translations in ${tldr.source.localeCount} locales, ${(snapshotBytes / 1024 / 1024).toFixed(1)} MiB total`);
}

await main();
