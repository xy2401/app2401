import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, copyFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(import.meta.dirname, "..");
const outputRoot = join(root, "public", "metadata", "v1");
const schemaPath = join(root, "schemas", "catalog-v1.schema.json");
const inventorySchemaPath = join(root, "schemas", "inventory-v1.schema.json");
const overridesPath = join(root, "data", "identity-overrides.json");
const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, textNodeName: "#text" });

const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const strings = (value) => [...new Set(array(value).flat(Infinity).filter((item) => item != null).map((item) => String(item).trim()).filter(Boolean))];
const text = (value) => value == null ? "" : typeof value === "object" && "#text" in value ? String(value["#text"] ?? "").trim() : String(value).trim();
const sortUnique = (items) => [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
const sha = (value, length = 12) => createHash("sha256").update(String(value)).digest("hex").slice(0, length);
const slugify = (value) => String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "software";
const posix = (path) => path.split(sep).join("/");
const gitWebUrl = (value) => String(value || "").replace(/\.git$/i, "");

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
  const sources = [...scoop.sources, ...chocolatey.sources, ...homebrew.sources].sort((a, b) => a.id.localeCompare(b.id));
  const snapshotTimes = sources.map((source) => Date.parse(source.snapshotAt)).filter(Number.isFinite);
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
  const stable = `${JSON.stringify(catalog)}\n`;
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, "catalog.json"), stable);
  await copyFile(schemaPath, join(outputRoot, "catalog.schema.json"));
  await copyFile(inventorySchemaPath, join(outputRoot, "inventory.schema.json"));
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: catalog.schemaVersion, generatedAt: catalog.generatedAt, bytes: Buffer.byteLength(stable), sha256: createHash("sha256").update(stable).digest("hex"), softwareCount: software.length, packageCount: packages.length, sources: catalog.sources.map(({ id, itemCount, snapshot }) => ({ id, itemCount, snapshot })) }, null, 2)}\n`);
  console.log(`catalog: ${software.length} software, ${packages.length} packages, ${(Buffer.byteLength(stable) / 1024 / 1024).toFixed(1)} MiB`);
}

await main();
