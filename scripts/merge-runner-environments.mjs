import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs, readJson, writeJson, compareText } from "./lib/metadata-common.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.platform || !args.input || !args.output) throw new Error("Usage: --platform windows|linux --input <directory> --output <file>");
if (!["windows", "linux"].includes(args.platform)) throw new Error(`Unsupported platform: ${args.platform}`);

const input = resolve(args.input);
const files = (await readdir(input)).filter((file) => file.endsWith(".json")).sort(compareText);
if (!files.length) throw new Error(`No runner snapshots found in ${input}`);
const images = [];
for (const file of files) {
  const document = await readJson(join(input, file));
  if (document.platform !== args.platform || !document.image) throw new Error(`Invalid ${args.platform} runner snapshot: ${file}`);
  images.push(document.image);
}
images.sort((a, b) => compareText(a.runnerLabel, b.runnerLabel));
await writeJson(resolve(args.output), {
  schemaVersion: "1.0.0",
  generatedAt: args["generated-at"] || new Date().toISOString(),
  provider: "github-actions",
  platform: args.platform,
  images,
});
