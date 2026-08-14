import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prettyJson, readJson } from "./lib/metadata-common.mjs";

const root = resolve(import.meta.dirname, "..");

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.name.endsWith(".json")) output.push(path);
  }
  return output;
}

const current = await readJson(join(root, "public", "metadata", "v1", "current.json"));
const paths = [
  ...await walk(join(root, "schemas")),
  ...await walk(join(root, "data")),
  ...await walk(join(root, "public", "metadata", "environments")),
  ...await walk(join(root, "public", "metadata", "distributions")),
  ...await walk(join(root, "public", "metadata", "v1", "snapshots", current.snapshotId)),
  join(root, "public", "metadata", "v1", "current.json"),
  ...await readdir(join(root, "public", "metadata", "v1"), { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => join(root, "public", "metadata", "v1", entry.name))),
];
for (const path of [...new Set(paths)]) {
  const value = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, prettyJson(value), "utf8");
}
console.log(`Formatted ${new Set(paths).size} JSON files.`);
