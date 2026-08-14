import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compareText, parseArgs, prettyJson, readJson, sha256, writeJson } from "./lib/metadata-common.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.platform || !args.input || !args.output) throw new Error("Usage: --platform windows|linux --input <directory> --output <directory>");
if (!["windows", "linux"].includes(args.platform)) throw new Error(`Unsupported platform: ${args.platform}`);

const input = resolve(args.input);
const output = resolve(args.output);
const generatedAt = args["generated-at"] || new Date().toISOString();
const files = (await readdir(input)).filter((file) => file.endsWith(".json")).sort(compareText);
if (!files.length) throw new Error(`No runner environments found in ${input}`);

const runners = [];
for (const file of files) {
  const collected = await readJson(join(input, file));
  if (collected.platform !== args.platform || !collected.image) throw new Error(`Invalid ${args.platform} runner environment: ${file}`);
  const runner = {
    schemaVersion: "1.0.0",
    generatedAt,
    provider: "github-actions",
    platform: args.platform,
    image: collected.image,
  };
  const relativePath = `runners/${collected.image.runnerLabel}.json`;
  const serialized = prettyJson(runner);
  await writeJson(join(output, ...relativePath.split("/")), runner);
  runners.push({
    runnerLabel: collected.image.runnerLabel,
    imageVersion: collected.image.imageVersion,
    os: collected.image.os,
    softwareCount: collected.image.software.length,
    path: relativePath,
    bytes: Buffer.byteLength(serialized),
    sha256: sha256(serialized),
  });
}

runners.sort((a, b) => compareText(a.runnerLabel, b.runnerLabel));
await writeJson(join(output, `${args.platform}.json`), {
  schemaVersion: "1.0.0",
  generatedAt,
  provider: "github-actions",
  platform: args.platform,
  runners,
});
console.log(`Built ${args.platform} GitHub Actions index: ${runners.length} runners`);
