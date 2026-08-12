import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(import.meta.dirname, "..");
const catalogPath = resolve(root, "public/metadata/v1/catalog.json");
const schema = JSON.parse(await readFile(resolve(root, "schemas/catalog-v1.schema.json"), "utf8"));
const inventorySchema = JSON.parse(await readFile(resolve(root, "schemas/inventory-v1.schema.json"), "utf8"));
const inventory = JSON.parse(await readFile(resolve(root, "public/examples/inventory.example.json"), "utf8"));
const raw = await readFile(catalogPath, "utf8");
const catalog = JSON.parse(raw);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

for (const [name, validationSchema, value] of [["catalog", schema, catalog], ["inventory example", inventorySchema, inventory]]) {
  if (!ajv.validate(validationSchema, value)) throw new Error(`${name}: ${ajv.errorsText(ajv.errors)}`);
}

const packageIds = new Set(catalog.packages.map((item) => item.id));
const softwareIds = new Set(catalog.software.map((item) => item.id));
if (packageIds.size !== catalog.packages.length) throw new Error("duplicate package id");
if (softwareIds.size !== catalog.software.length) throw new Error("duplicate software id");
for (const item of catalog.packages) if (!softwareIds.has(item.softwareId)) throw new Error(`missing software ${item.softwareId}`);

const counts = new Map(catalog.sources.map((source) => [source.id, 0]));
for (const item of catalog.packages) counts.set(item.sourceId, (counts.get(item.sourceId) || 0) + 1);
const scoopCount = catalog.sources.filter((source) => source.manager === "scoop").reduce((sum, source) => sum + source.itemCount, 0);
const chocolateyCount = catalog.sources.find((source) => source.id === "chocolatey:community-packages")?.itemCount;
const formulaCount = catalog.sources.find((source) => source.id === "homebrew:formula")?.itemCount;
const caskCount = catalog.sources.find((source) => source.id === "homebrew:cask")?.itemCount;
if (scoopCount !== 6595 || chocolateyCount !== 347 || formulaCount !== 8542 || caskCount !== 7692) throw new Error(`source baseline changed: scoop=${scoopCount}, chocolatey=${chocolateyCount}, formula=${formulaCount}, cask=${caskCount}`);

const ffmpeg = catalog.software.find((software) => software.packageIds.filter((id) => catalog.packages.find((pkg) => pkg.id === id)?.name.toLowerCase() === "ffmpeg").length >= 3);
if (!ffmpeg) throw new Error("ffmpeg did not conservatively merge across three sources");
const ffmpegManagers = new Set(ffmpeg.packageIds.map((id) => catalog.packages.find((pkg) => pkg.id === id)?.manager));
if (!["scoop", "chocolatey", "homebrew"].every((manager) => ffmpegManagers.has(manager))) throw new Error("ffmpeg is missing a source manager");

console.log(`verified ${catalog.software.length} software and ${catalog.packages.length} packages (${createHash("sha256").update(raw).digest("hex").slice(0, 12)})`);
