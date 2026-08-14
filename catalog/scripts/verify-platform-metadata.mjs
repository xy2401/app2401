import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { prettyJson, readJson, sha256 } from "./lib/metadata-common.mjs";

const root = resolve(import.meta.dirname, "../..");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function walk(directory) {
  if (!await exists(directory)) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path)); else output.push(path);
  }
  return output;
}

function failSchema(label, validate) {
  if (validate.errors) throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: "\n" })}`);
}

const environmentSchema = await readJson(join(root, "catalog", "schemas", "environment-v1.schema.json"));
const environmentIndexSchema = await readJson(join(root, "catalog", "schemas", "environment-index-v1.schema.json"));
const validateEnvironment = ajv.compile(environmentSchema);
const validateEnvironmentIndex = ajv.compile(environmentIndexSchema);
for (const platform of ["windows", "linux"]) {
  const environmentRoot = join(root, "public", "metadata", "environments", "v1", "github-actions");
  const indexPath = join(environmentRoot, `${platform}.json`);
  if (!await exists(indexPath)) continue;
  const index = await readJson(indexPath);
  if (!validateEnvironmentIndex(index)) failSchema(indexPath, validateEnvironmentIndex);
  for (const descriptor of index.runners) {
    const path = join(environmentRoot, ...descriptor.path.split("/"));
    const body = Buffer.from((await readFile(path, "utf8")).replaceAll("\r\n", "\n"), "utf8");
    if (body.byteLength !== descriptor.bytes || sha256(body) !== descriptor.sha256) throw new Error(`Runner file integrity mismatch: ${descriptor.path}`);
    const document = JSON.parse(body);
    if (!validateEnvironment(document)) failSchema(path, validateEnvironment);
    if (document.platform !== platform || document.image.runnerLabel !== descriptor.runnerLabel) throw new Error(`Runner index mismatch: ${descriptor.runnerLabel}`);
  }
}

const distroRoot = join(root, "public", "metadata", "distributions", "v1");
const distroIndexPath = join(distroRoot, "index.json");
if (await exists(distroIndexPath)) {
  const indexSchema = await readJson(join(root, "catalog", "schemas", "distribution-index-v1.schema.json"));
  const collectionsSchema = await readJson(join(root, "catalog", "schemas", "distribution-collections-v1.schema.json"));
  const curatedSchema = await readJson(join(root, "catalog", "schemas", "distribution-curated-v1.schema.json"));
  const validateIndex = ajv.compile(indexSchema);
  const validateCollections = ajv.compile(collectionsSchema);
  const validateCurated = ajv.compile(curatedSchema);
  const index = await readJson(distroIndexPath);
  if (!validateIndex(index)) failSchema(distroIndexPath, validateIndex);
  for (const distro of index.distributions) {
    for (const file of [distro.files.search, distro.files.repositories, distro.files.groups, distro.files.collections, distro.files.curated, ...Object.values(distro.files.details.shards)]) {
      const path = join(distroRoot, ...file.path.split("/"));
      const body = Buffer.from((await readFile(path, "utf8")).replaceAll("\r\n", "\n"), "utf8");
      if (body.byteLength !== file.bytes || sha256(body) !== file.sha256) throw new Error(`Distribution file integrity mismatch: ${file.path}`);
    }
    const collections = await readJson(join(distroRoot, ...distro.files.collections.path.split("/")));
    const curated = await readJson(join(distroRoot, ...distro.files.curated.path.split("/")));
    if (!validateCollections(collections)) failSchema(distro.files.collections.path, validateCollections);
    if (!validateCurated(curated)) failSchema(distro.files.curated.path, validateCurated);
    if (collections.collections.length !== distro.collectionCount || curated.packages.length !== distro.curatedPackageCount) throw new Error(`Distribution curated counts differ: ${distro.id}`);
  }
}

const formattedRoots = [join(root, "catalog", "schemas"), join(root, "catalog", "config"), join(root, "public", "metadata")];
const catalogCurrentPath = join(root, "public", "metadata", "v1", "current.json");
const catalogCurrent = await exists(catalogCurrentPath) ? await readJson(catalogCurrentPath) : null;
const activeCatalogSnapshot = catalogCurrent ? join(root, "public", "metadata", "v1", "snapshots", catalogCurrent.snapshotId) : "";
for (const path of (await Promise.all(formattedRoots.map(walk))).flat()) {
  if (!path.endsWith(".json") && !path.endsWith(".xml")) continue;
  const catalogSnapshotsRoot = join(root, "public", "metadata", "v1", "snapshots");
  if (path.startsWith(catalogSnapshotsRoot) && !path.startsWith(activeCatalogSnapshot)) continue;
  const body = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
  if (body.charCodeAt(0) === 0xfeff) throw new Error(`UTF-8 BOM is forbidden: ${path}`);
  if (!body.endsWith("\n")) throw new Error(`Missing final newline: ${path}`);
  if (path.endsWith(".json")) {
    const expected = prettyJson(JSON.parse(body));
    if (body !== expected) throw new Error(`JSON is not formatted with two-space indentation: ${path}`);
  } else {
    const lines = body.trimEnd().split(/\r?\n/);
    if (lines.length < 2) throw new Error(`XML must not be stored on one line: ${path}`);
    if (lines.some((line) => line.length > 1000)) throw new Error(`XML contains an overlong line: ${path}`);
  }
}

console.log("Runner/distribution schemas, integrity, privacy-safe shapes, and JSON/XML formatting verified.");
