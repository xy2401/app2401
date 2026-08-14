import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { prettyJson, readJson, sha256 } from "./lib/metadata-common.mjs";

const root = resolve(import.meta.dirname, "..");
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

const environmentSchema = await readJson(join(root, "schemas", "environment-v1.schema.json"));
const validateEnvironment = ajv.compile(environmentSchema);
for (const platform of ["windows", "linux"]) {
  const path = join(root, "public", "metadata", "environments", "v1", `${platform}.json`);
  if (!await exists(path)) continue;
  if (!validateEnvironment(await readJson(path))) failSchema(path, validateEnvironment);
}

const distroRoot = join(root, "public", "metadata", "distributions", "v1");
const currentPath = join(distroRoot, "current.json");
if (await exists(currentPath)) {
  const indexSchema = await readJson(join(root, "schemas", "distribution-index-v1.schema.json"));
  const validateIndex = ajv.compile(indexSchema);
  const current = await readJson(currentPath);
  if (!validateIndex(current)) failSchema(currentPath, validateIndex);
  const manifestPath = join(distroRoot, ...current.manifest.split("/"));
  const manifest = await readJson(manifestPath);
  if (manifest.snapshotId !== current.snapshotId) throw new Error("Distribution current.json and manifest snapshot IDs differ");
  for (const distro of manifest.distributions) {
    for (const file of [distro.files.search, distro.files.repositories, distro.files.groups, ...Object.values(distro.files.details.shards)]) {
      const path = join(manifestPath, "..", ...file.path.split("/"));
      const body = await readFile(path);
      if (body.byteLength !== file.bytes || sha256(body) !== file.sha256) throw new Error(`Distribution file integrity mismatch: ${file.path}`);
    }
  }
}

const formattedRoots = [join(root, "schemas"), join(root, "data"), join(root, "public", "metadata")];
const catalogCurrentPath = join(root, "public", "metadata", "v1", "current.json");
const catalogCurrent = await exists(catalogCurrentPath) ? await readJson(catalogCurrentPath) : null;
const activeCatalogSnapshot = catalogCurrent ? join(root, "public", "metadata", "v1", "snapshots", catalogCurrent.snapshotId) : "";
for (const path of (await Promise.all(formattedRoots.map(walk))).flat()) {
  if (!path.endsWith(".json") && !path.endsWith(".xml")) continue;
  const catalogSnapshotsRoot = join(root, "public", "metadata", "v1", "snapshots");
  if (path.startsWith(catalogSnapshotsRoot) && !path.startsWith(activeCatalogSnapshot)) continue;
  const body = await readFile(path, "utf8");
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
