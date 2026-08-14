import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { compareText, parseArgs, prettyJson, readJson, sha256, writeJson } from "./lib/metadata-common.mjs";
import { buildCollections, buildCuratedPackages } from "./lib/distro-curation.mjs";

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
  const path = join(inputDir, `${source.slug || source.id}.json`);
  const document = await readJson(path);
  if (!validate(document)) throw new Error(`${basename(path)} failed schema validation: ${ajv.errorsText(validate.errors)}`);
  if (document.distribution.id !== source.id) throw new Error(`${basename(path)} has unexpected distribution identity: ${document.distribution.id}`);
  documents.push({ document, source });
}

const generatedAt = args["generated-at"] || documents.map(({ document }) => document.generatedAt).sort(compareText).at(-1) || new Date().toISOString();
const revision = sha256(documents.map(({ document }) => prettyJson({ ...document, generatedAt: "" })).join("\n")).slice(0, 12);
const temporaryRoot = `${outputRoot}.building-${revision}`;
const previousRoot = `${outputRoot}.previous`;
await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });

async function writeData(relativePath, value) {
  const serialized = prettyJson(value);
  const path = join(temporaryRoot, relativePath);
  await writeJson(path, value);
  return { path: relativePath.replaceAll("\\", "/"), bytes: Buffer.byteLength(serialized), sha256: sha256(serialized) };
}

const distributions = [];
for (const { document, source } of documents.sort((a, b) => compareText(a.source.slug || a.source.id, b.source.slug || b.source.id))) {
  const id = source.slug || source.id;
  const shards = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [index.toString(16).padStart(2, "0"), []]));
  for (const item of document.packages) shards[item.id.slice(0, 2)].push(item);
  const search = await writeData(`${id}/search.json`, {
    schemaVersion: "1.0.0",
    generatedAt,
    distribution: document.distribution,
    packages: document.packages.map((item) => ({ id: item.id, name: item.name, version: item.version, architecture: item.architecture, summary: item.summary, category: item.category || "", repository: item.repository, shard: item.id.slice(0, 2) })),
  });
  const repositories = await writeData(`${id}/repositories.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: document.distribution.id, repositories: document.repositories });
  const groups = await writeData(`${id}/groups.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: document.distribution.id, groups: document.groups, environments: document.environments });
  const collectionItems = buildCollections(document);
  const curatedItems = buildCuratedPackages(document, collectionItems);
  const collections = await writeData(`${id}/collections.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: document.distribution.id, collections: collectionItems });
  const curated = await writeData(`${id}/curated.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: document.distribution.id, packages: curatedItems });
  const detailFiles = {};
  for (const [shard, items] of Object.entries(shards)) detailFiles[shard] = await writeData(`${id}/packages/details/${shard}.json`, { schemaVersion: "1.0.0", generatedAt, distributionId: document.distribution.id, shard, items });
  distributions.push({
    id,
    canonicalId: document.distribution.id,
    label: source.label || document.distribution.name,
    distribution: document.distribution,
    image: document.image,
    packageCount: document.packages.length,
    groupCount: document.groups.length,
    environmentCount: document.environments.length,
    collectionCount: collectionItems.length,
    curatedPackageCount: curatedItems.length,
    files: { search, repositories, groups, collections, curated, details: { pathTemplate: `${id}/packages/details/{shard}.json`, shards: detailFiles } },
  });
}

await writeData("index.json", { schemaVersion: "1.0.0", generatedAt, revision, distributions });
await copyFile(join(projectRoot, "schemas", "distribution-index-v1.schema.json"), join(temporaryRoot, "distribution-index.schema.json"));
await copyFile(join(projectRoot, "schemas", "distribution-catalog-v1.schema.json"), join(temporaryRoot, "distribution-catalog.schema.json"));
await copyFile(join(projectRoot, "schemas", "distribution-collections-v1.schema.json"), join(temporaryRoot, "distribution-collections.schema.json"));
await copyFile(join(projectRoot, "schemas", "distribution-curated-v1.schema.json"), join(temporaryRoot, "distribution-curated.schema.json"));

await rm(previousRoot, { recursive: true, force: true });
try { await rename(outputRoot, previousRoot); } catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(dirname(outputRoot), { recursive: true });
await rename(temporaryRoot, outputRoot);
await rm(previousRoot, { recursive: true, force: true });
console.log(`Built distribution catalogs ${revision}: ${documents.reduce((sum, item) => sum + item.document.packages.length, 0)} packages`);
