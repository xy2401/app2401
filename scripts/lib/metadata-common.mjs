import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
export const unique = (values) => [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort(compareText);

export function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) output[key] = true;
    else {
      output[key] = value;
      index += 1;
    }
  }
  return output;
}

export function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, prettyJson(value), "utf8");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function normalizeArch(value) {
  const arch = String(value || "").toLowerCase();
  if (["x64", "x86_64", "amd64"].includes(arch)) return "amd64";
  if (["aarch64", "arm64"].includes(arch)) return "arm64";
  return arch || "unknown";
}

export function parseOsRelease(source) {
  return Object.fromEntries(String(source || "").split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]));
}

export function stableSoftwareId({ ecosystem, name, version, architecture }) {
  return sha256([ecosystem, name.toLowerCase(), version, normalizeArch(architecture)].join("\u0000")).slice(0, 16);
}
