import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targets = [
  ["environment-v1.schema.json", join("public", "metadata", "environments", "v1", "environment.schema.json")],
  ["distribution-index-v1.schema.json", join("public", "metadata", "distributions", "v1", "distribution-index.schema.json")],
  ["distribution-catalog-v1.schema.json", join("public", "metadata", "distributions", "v1", "distribution-catalog.schema.json")],
];
for (const [source, target] of targets) {
  const output = join(root, target);
  await mkdir(resolve(output, ".."), { recursive: true });
  await copyFile(join(root, "schemas", source), output);
}
