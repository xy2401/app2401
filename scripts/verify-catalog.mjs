import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(import.meta.dirname, "..");
const metadataRoot = resolve(root, "public/metadata/v1");
const schema = JSON.parse(await readFile(resolve(root, "schemas/catalog-v1.schema.json"), "utf8"));
const inventorySchema = JSON.parse(await readFile(resolve(root, "schemas/inventory-v1.schema.json"), "utf8"));
const indexSchema = JSON.parse(await readFile(resolve(root, "schemas/catalog-index-v1.schema.json"), "utf8"));
const commandSchema = JSON.parse(await readFile(resolve(root, "schemas/command-v1.schema.json"), "utf8"));
const tldrSchema = JSON.parse(await readFile(resolve(root, "schemas/tldr-v1.schema.json"), "utf8"));
const inventory = JSON.parse(await readFile(resolve(root, "public/examples/inventory.example.json"), "utf8"));
const current = JSON.parse(await readFile(resolve(metadataRoot, "current.json"), "utf8"));
const manifestPath = resolve(metadataRoot, current.manifest);
const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);
const snapshotRoot = dirname(manifestPath);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

if (current.schemaVersion !== "1.0.0" || current.snapshotId !== manifest.snapshotId) throw new Error("current pointer does not match manifest");
if (Buffer.byteLength(manifestRaw) !== current.manifestBytes || hash(manifestRaw) !== current.manifestSha256) throw new Error("manifest integrity check failed");
if (manifest.formatRevision !== "sharded-4") throw new Error("unsupported shard format");

async function readDescriptor(descriptor) {
  const raw = await readFile(resolve(snapshotRoot, descriptor.path), "utf8");
  if (Buffer.byteLength(raw) !== descriptor.bytes || hash(raw) !== descriptor.sha256) throw new Error(`integrity check failed: ${descriptor.path}`);
  return JSON.parse(raw);
}

const search = await readDescriptor(manifest.files.search);
if (search.snapshotId !== manifest.snapshotId || search.items.length !== manifest.softwareCount) throw new Error("search index count or snapshot mismatch");

const detailFiles = Object.entries(manifest.files.details.shards);
if (detailFiles.length !== 256) throw new Error(`expected 256 detail shards, got ${detailFiles.length}`);
const detailData = await Promise.all(detailFiles.map(async ([shard, descriptor]) => {
  const data = await readDescriptor(descriptor);
  if (data.shard !== shard || data.snapshotId !== manifest.snapshotId || data.items.length !== descriptor.records) throw new Error(`invalid detail shard ${shard}`);
  return data;
}));
const software = detailData.flatMap((data) => data.items.map((item) => item.software));
const packages = detailData.flatMap((data) => data.items.flatMap((item) => item.packages));
software.sort((a, b) => a.id.localeCompare(b.id));
packages.sort((a, b) => a.id.localeCompare(b.id));

const commandIndex = await readDescriptor(manifest.files.commands.index);
const commandDetailFiles = Object.entries(manifest.files.commands.details.shards);
if (commandDetailFiles.length !== 256) throw new Error(`expected 256 command shards, got ${commandDetailFiles.length}`);
const commandData = await Promise.all(commandDetailFiles.map(async ([shard, descriptor]) => {
  const data = await readDescriptor(descriptor);
  if (data.shard !== shard || data.snapshotId !== manifest.snapshotId || data.items.length !== descriptor.records) throw new Error(`invalid command shard ${shard}`);
  return data;
}));
const commands = commandData.flatMap((data) => data.items);
for (const command of commands) if (!ajv.validate(commandSchema, command)) throw new Error(`command ${command.id}: ${ajv.errorsText(ajv.errors)}`);
if (commands.length !== manifest.commandCount || commandIndex.items.length !== manifest.commandCount) throw new Error("command count mismatch");
const commandIds = new Set(commands.map((item) => item.id));
if (commandIds.size !== commands.length || commandIndex.items.some((item) => !commandIds.has(item.id))) throw new Error("command index IDs do not match command shards");
for (const item of software) for (const commandId of item.commandIds || []) if (!commandIds.has(commandId)) throw new Error(`missing command ${commandId}`);
const fishSource = manifest.knowledgeSources.find((source) => source.id === "fish:completions");
if (!fishSource || fishSource.itemCount !== 1067 || fishSource.recordCount !== commands.length) throw new Error("Fish source count mismatch");
const gitCommand = commands.find((item) => item.name === "git");
if (!gitCommand || gitCommand.commandCount < 100 || !gitCommand.softwareIds.length || !gitCommand.dynamicStatementCount) throw new Error("Fish git commands were not parsed or linked");
if (!gitCommand.commands.some((item) => item.command === "git clone" && item.description) || !gitCommand.commands.some((item) => item.command === "git remote add" && item.description)) throw new Error("Fish git command paths are incomplete");

const tldrIndex = await readDescriptor(manifest.files.tldr.index);
const tldrDetailFiles = Object.entries(manifest.files.tldr.details.shards);
if (tldrDetailFiles.length !== 16) throw new Error(`expected 16 TLDR shards, got ${tldrDetailFiles.length}`);
const tldrData = await Promise.all(tldrDetailFiles.map(async ([shard, descriptor]) => {
  const data = await readDescriptor(descriptor);
  if (data.shard !== shard || data.snapshotId !== manifest.snapshotId || data.items.length !== descriptor.records) throw new Error(`invalid TLDR shard ${shard}`);
  return data;
}));
const tldrPages = tldrData.flatMap((data) => data.items);
for (const page of tldrPages) if (!ajv.validate(tldrSchema, page)) throw new Error(`TLDR ${page.id}: ${ajv.errorsText(ajv.errors)}`);
if (tldrPages.length !== manifest.tldrPageCount || tldrIndex.items.length !== manifest.tldrPageCount) throw new Error("TLDR page count mismatch");
const tldrIds = new Set(tldrPages.map((item) => item.id));
if (tldrIds.size !== tldrPages.length || tldrIndex.items.some((item) => !tldrIds.has(item.id))) throw new Error("TLDR index IDs do not match TLDR shards");
for (const item of software) for (const pageId of item.tldrPageIds || []) if (!tldrIds.has(pageId)) throw new Error(`missing TLDR page ${pageId}`);
const tldrSource = manifest.knowledgeSources.find((source) => source.id === "tldr:pages");
if (!tldrSource || tldrSource.recordCount !== tldrPages.length) throw new Error("TLDR source count mismatch");
const gitClonePage = tldrPages.find((item) => item.title === "git clone" && item.platform === "cross-platform");
if (!gitClonePage || !gitClonePage.softwareIds.length || !gitClonePage.examples.some((item) => item.command.startsWith("git clone ") && item.description)) throw new Error("TLDR git clone page was not parsed or linked");

const tldrLocales = await readDescriptor(manifest.files.tldr.localesIndex);
if (tldrLocales.locales.length !== manifest.tldrLocaleCount || !tldrLocales.locales.some((item) => item.locale === "zh" && item.itemCount > 1500)) throw new Error("TLDR locale index is incomplete");
let translationCount = 0;
for (const [locale, localeIndex] of Object.entries(manifest.files.tldr.locales)) {
  const shardEntries = Object.entries(localeIndex.shards);
  if (shardEntries.length !== 16) throw new Error(`expected 16 TLDR ${locale} shards`);
  const localePages = (await Promise.all(shardEntries.map(async ([shard, descriptor]) => {
    const data = await readDescriptor(descriptor);
    if (data.locale !== locale || data.shard !== shard || data.snapshotId !== manifest.snapshotId || data.items.length !== descriptor.records) throw new Error(`invalid TLDR ${locale} shard ${shard}`);
    return data.items;
  }))).flat();
  if (localePages.length !== localeIndex.itemCount) throw new Error(`TLDR ${locale} count mismatch`);
  for (const page of localePages) if (!ajv.validate(tldrSchema, page)) throw new Error(`TLDR ${locale}/${page.id}: ${ajv.errorsText(ajv.errors)}`);
  translationCount += localePages.length;
  if (locale === "zh") {
    const chineseGitClone = localePages.find((item) => item.id === gitClonePage.id);
    if (!chineseGitClone || chineseGitClone.locale !== "zh" || !chineseGitClone.summary.includes("克隆") || !chineseGitClone.examples.some((item) => item.command.includes("{{远程代码库地址}}"))) throw new Error("TLDR Chinese git clone translation is incomplete");
  }
}
if (translationCount !== manifest.tldrTranslationCount || tldrSource.translationCount !== translationCount || tldrSource.itemCount !== tldrPages.length + translationCount) throw new Error("TLDR translation total mismatch");

for (const [name, value] of [["current pointer", current], ["snapshot manifest", manifest]]) {
  if (!ajv.validate(indexSchema, value)) throw new Error(`${name}: ${ajv.errorsText(ajv.errors)}`);
}
for (const [name, validationSchema, value] of [
  ["logical catalog", schema, { schemaVersion: manifest.schemaVersion, generatedAt: manifest.generatedAt, sources: manifest.sources, software, packages }],
  ["inventory example", inventorySchema, inventory],
]) {
  if (!ajv.validate(validationSchema, value)) throw new Error(`${name}: ${ajv.errorsText(ajv.errors)}`);
}

if (software.length !== manifest.softwareCount || packages.length !== manifest.packageCount) throw new Error("manifest record counts do not match detail shards");
const packageIds = new Set(packages.map((item) => item.id));
const softwareIds = new Set(software.map((item) => item.id));
if (packageIds.size !== packages.length) throw new Error("duplicate package id");
if (softwareIds.size !== software.length) throw new Error("duplicate software id");
for (const item of packages) if (!softwareIds.has(item.softwareId)) throw new Error(`missing software ${item.softwareId}`);

const searchIds = new Set(search.items.map((item) => item.id));
if (searchIds.size !== softwareIds.size || [...softwareIds].some((id) => !searchIds.has(id))) throw new Error("search index software IDs do not match details");

for (const [manager, descriptor] of Object.entries(manifest.files.inventory)) {
  const data = await readDescriptor(descriptor);
  if (data.manager !== manager || data.snapshotId !== manifest.snapshotId) throw new Error(`invalid ${manager} inventory index`);
  const indexedCount = Object.values(data.packages).reduce((sum, entries) => sum + entries.length, 0);
  const expected = packages.filter((item) => item.manager === manager).length;
  if (indexedCount !== expected || descriptor.records !== expected) throw new Error(`${manager} inventory count mismatch`);
}

for (const [sourceId, sourceIndex] of Object.entries(manifest.files.sources)) {
  let count = 0;
  for (const descriptor of sourceIndex.pages) {
    const data = await readDescriptor(descriptor);
    if (data.sourceId !== sourceId || data.snapshotId !== manifest.snapshotId || data.items.length !== descriptor.records) throw new Error(`invalid source page ${descriptor.path}`);
    count += data.items.length;
  }
  if (count !== sourceIndex.total || count !== packages.filter((item) => item.sourceId === sourceId).length) throw new Error(`source index count mismatch: ${sourceId}`);
}

const scoopCount = manifest.sources.filter((source) => source.manager === "scoop").reduce((sum, source) => sum + source.itemCount, 0);
const chocolateyCount = manifest.sources.find((source) => source.id === "chocolatey:community-packages")?.itemCount;
const formulaCount = manifest.sources.find((source) => source.id === "homebrew:formula")?.itemCount;
const caskCount = manifest.sources.find((source) => source.id === "homebrew:cask")?.itemCount;
if (scoopCount !== 6595 || chocolateyCount !== 347 || formulaCount !== 8542 || caskCount !== 7692) throw new Error(`source baseline changed: scoop=${scoopCount}, chocolatey=${chocolateyCount}, formula=${formulaCount}, cask=${caskCount}`);

const packageById = new Map(packages.map((item) => [item.id, item]));
const ffmpeg = software.find((item) => item.packageIds.filter((id) => packageById.get(id)?.name.toLowerCase() === "ffmpeg").length >= 3);
if (!ffmpeg) throw new Error("ffmpeg did not conservatively merge across three sources");
const ffmpegManagers = new Set(ffmpeg.packageIds.map((id) => packageById.get(id)?.manager));
if (!["scoop", "chocolatey", "homebrew"].every((manager) => ffmpegManagers.has(manager))) throw new Error("ffmpeg is missing a source manager");

console.log(`verified snapshot ${manifest.snapshotId}: ${software.length} software, ${packages.length} packages, ${commands.length} Fish commands, ${tldrPages.length} TLDR pages`);
