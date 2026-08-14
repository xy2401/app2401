import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildCollections, buildCuratedPackages } from "./lib/distro-curation.mjs";
import { parseArgs, prettyJson, readJson, sha256, writeJson } from "./lib/metadata-common.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || join(import.meta.dirname, "..", "public", "metadata", "distributions", "v1"));
const indexPath = join(root, "index.json");
const index = await readJson(indexPath);

async function descriptor(relativePath, value) {
  const serialized = prettyJson(value);
  await writeJson(join(root, ...relativePath.split("/")), value);
  return { path: relativePath, bytes: Buffer.byteLength(serialized), sha256: sha256(serialized) };
}

for (const entry of index.distributions) {
  const rawGroups = await readJson(join(root, ...entry.files.groups.path.split("/")));
  const packages = [];
  for (const shard of Object.values(entry.files.details.shards)) {
    const document = JSON.parse(await readFile(join(root, ...shard.path.split("/")), "utf8"));
    packages.push(...document.items);
  }
  const document = { packages, groups: rawGroups.groups || [], environments: rawGroups.environments || [], collections: [] };
  const collections = buildCollections(document);
  const curated = buildCuratedPackages(document, collections);
  entry.collectionCount = collections.length;
  entry.curatedPackageCount = curated.length;
  entry.files.collections = await descriptor(`${entry.id}/collections.json`, { schemaVersion: "1.0.0", generatedAt: index.generatedAt, distributionId: entry.canonicalId, collections });
  entry.files.curated = await descriptor(`${entry.id}/curated.json`, { schemaVersion: "1.0.0", generatedAt: index.generatedAt, distributionId: entry.canonicalId, packages: curated });
  console.log(`${entry.id}: ${collections.length} collections, ${curated.length} curated packages`);
}

index.revision = sha256(prettyJson({ ...index, revision: "" })).slice(0, 12);
await writeJson(indexPath, index);
