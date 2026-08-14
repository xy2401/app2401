import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseArgs, prettyJson, readJson, sha256, writeJson, compareText } from "./lib/metadata-common.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.output) throw new Error("Usage: --input <directory> --output <metadata directory> [--generated-at <ISO date>]");
const projectRoot = resolve(import.meta.dirname, "..");
const inputDir = resolve(args.input);
const outputRoot = resolve(args.output);
const sourceConfig = await readJson(join(projectRoot, "data", "distribution-sources.json"));
const schema = await readJson(join(projectRoot, "schemas", "distribution-catalog-v1.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const documents = [];
for (const source of sourceConfig.distributions) {
  const path = join(inputDir, `${source.id}.json`);
  const document = await readJson(path);
  if (!validate(document)) throw new Error(`${basename(path)} failed schema validation: ${ajv.errorsText(validate.errors)}`);
  documents.push(document);
}

const generatedAt = args["generated-at"] || documents.map((item) => item.generatedAt).sort(compareText).at(-1) || new Date().toISOString();
const contentHash = sha256(documents.map((document) => prettyJson({ ...document, generatedAt: "" })).join("\n")).slice(0, 12);
const snapshotId = `${generatedAt.slice(0, 10)}-${contentHash}`;
const temporaryRoot = join(outputRoot, `.building-${snapshotId}`);
const snapshotRoot = join(temporaryRoot, "snapshots", snapshotId);
await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(snapshotRoot, { recursive: true });

async function writeData(relativePath, value) {
  const serialized = prettyJson(value);
  const path = join(snapshotRoot, relativePath);
  await writeJson(path, value);
  return { path: relativePath.replaceAll("\\", "/"), bytes: Buffer.byteLength(serialized), sha256: sha256(serialized) };
}

const manifestDistributions = [];
for (const document of documents.sort((a, b) => compareText(a.distribution.id, b.distribution.id))) {
  const id = document.distribution.id;
  const shards = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [index.toString(16).padStart(2, "0"), []]));
  for (const item of document.packages) shards[item.id.slice(0, 2)].push(item);
  const search = await writeData(`${id}/search.json`, {
    schemaVersion: "1.0.0",
    generatedAt,
    distribution: document.distribution,
    packages: document.packages.map((item) => ({ id: item.id, name: item.name, version: item.version, architecture: item.architecture, summary: item.summary, category: item.category || "", repository: item.repository, shard: item.id.slice(0, 2) })),
  });
  const repositories = await writeData(`${id}/repositories.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: id, repositories: document.repositories });
  const groups = await writeData(`${id}/groups.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: id, groups: document.groups, environments: document.environments });
  const detailFiles = {};
  for (const [shard, items] of Object.entries(shards)) detailFiles[shard] = await writeData(`${id}/packages/details/${shard}.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: id, shard, items });
  manifestDistributions.push({ id, label: sourceConfig.distributions.find((item) => item.id === id)?.label || document.distribution.name, distribution: document.distribution, image: document.image, packageCount: document.packages.length, groupCount: document.groups.length, environmentCount: document.environments.length, files: { search, repositories, groups, details: { pathTemplate: `${id}/packages/details/{shard}.json`, shards: detailFiles } } });
}
await writeData("manifest.json", { schemaVersion: "1.0.0", snapshotId, generatedAt, distributions: manifestDistributions });
await writeJson(join(temporaryRoot, "current.json"), { schemaVersion: "1.0.0", snapshotId, generatedAt, manifest: `snapshots/${snapshotId}/manifest.json` });
await copyFile(join(projectRoot, "schemas", "distribution-index-v1.schema.json"), join(temporaryRoot, "distribution-index.schema.json"));
await copyFile(join(projectRoot, "schemas", "distribution-catalog-v1.schema.json"), join(temporaryRoot, "distribution-catalog.schema.json"));

const liveSnapshots = join(outputRoot, "snapshots");
const previous = `${liveSnapshots}.previous`;
await rm(previous, { recursive: true, force: true });
try { await rename(liveSnapshots, previous); } catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(outputRoot, { recursive: true });
await rename(join(temporaryRoot, "snapshots"), liveSnapshots);
for (const file of ["current.json", "distribution-index.schema.json", "distribution-catalog.schema.json"]) await rename(join(temporaryRoot, file), join(outputRoot, file));
await rm(temporaryRoot, { recursive: true, force: true });
await rm(previous, { recursive: true, force: true });
console.log(`Built distribution snapshot ${snapshotId}: ${documents.reduce((sum, item) => sum + item.packages.length, 0)} packages`);
