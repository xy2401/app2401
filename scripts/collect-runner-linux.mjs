import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs, normalizeArch, parseOsRelease, readJson, stableSoftwareId, unique, writeJson, compareText } from "./lib/metadata-common.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.output || !args["runner-label"]) throw new Error("Usage: --output <file> --runner-label <label> [--strict]");
if (args.fixture) {
  const fixture = await readJson(resolve(args.fixture));
  await writeJson(resolve(args.output), fixture);
  process.exit(0);
}

function run(command, commandArgs = []) {
  try {
    return { ok: true, output: execFileSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 }).trim() };
  } catch (error) {
    return { ok: false, output: "", error: String(error.stderr || error.message || error).trim().slice(0, 500) };
  }
}

const software = new Map();
const collectors = [];
function add(item, method) {
  if (!item.name) return;
  const normalized = {
    id: stableSoftwareId(item),
    name: String(item.name),
    version: String(item.version || ""),
    kind: item.kind || "package",
    ecosystem: String(item.ecosystem || "system"),
    architecture: normalizeArch(item.architecture || process.arch),
    ...(item.publisher ? { publisher: String(item.publisher) } : {}),
    ...(item.scope ? { scope: item.scope } : {}),
    ...(item.path ? { path: String(item.path) } : {}),
    ...(item.sourceRef ? { sourceRef: String(item.sourceRef) } : {}),
    discoveryMethods: [method],
  };
  const existing = software.get(normalized.id);
  if (existing) existing.discoveryMethods = unique([...existing.discoveryMethods, method]);
  else software.set(normalized.id, normalized);
}

function collect(id, command, commandArgs, parser, required = false) {
  const result = run(command, commandArgs);
  if (!result.ok) {
    collectors.push({ id, status: "unavailable", count: 0, error: result.error || "command unavailable" });
    if (required && args.strict) throw new Error(`${id} collector failed: ${result.error}`);
    return;
  }
  const before = software.size;
  parser(result.output);
  collectors.push({ id, status: "ok", count: software.size - before });
}

const osRelease = parseOsRelease(readFileSync("/etc/os-release", "utf8"));
const architecture = normalizeArch(run("uname", ["-m"]).output || process.arch);
const runnerLabel = String(args["runner-label"]);
const readmeLabel = runnerLabel === "ubuntu-24.04" ? "Ubuntu2404" : "Ubuntu2204";
const readmeSource = `https://github.com/actions/runner-images/blob/main/images/ubuntu/${readmeLabel}-Readme.md`;
try {
  const response = await fetch(`https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/${readmeLabel}-Readme.md`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const before = software.size;
  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line.startsWith("|") || /^\|[\s|:-]+\|?$/.test(line)) continue;
    const fields = line.split("|").slice(1, -1).map((value) => value.trim());
    if (fields.length < 2 || /^(tool|name|package|software)$/i.test(fields[0])) continue;
    const name = fields[0].replace(/!?(?:\[([^\]]+)\]\([^)]*\))/g, "$1").replace(/<[^>]+>|[`*_]/g, "").trim();
    const version = fields[1].replace(/<[^>]+>|[`*_]/g, "").trim();
    if (name && version && !/^version$/i.test(version)) add({ name, version, ecosystem: "runner-image-readme", architecture, scope: "system", kind: "component", sourceRef: readmeSource }, "official-image-manifest");
  }
  collectors.push({ id: "official-image-manifest", status: "ok", count: software.size - before });
} catch (error) {
  collectors.push({ id: "official-image-manifest", status: "error", count: 0, error: String(error.message).slice(0, 500) });
  if (args.strict) throw error;
}

collect("dpkg", "dpkg-query", ["-W", "-f=${binary:Package}\t${Version}\t${Architecture}\t${Maintainer}\n"], (output) => {
  for (const line of output.split("\n")) {
    const [name, version, arch, publisher] = line.split("\t");
    add({ name: name?.replace(/:[^:]+$/, ""), version, architecture: arch, publisher, ecosystem: "dpkg", kind: "package", scope: "system" }, "dpkg");
  }
}, true);

collect("apt-manual", "apt-mark", ["showmanual"], (output) => {
  const manual = new Set(output.split("\n").filter(Boolean));
  for (const item of software.values()) if (item.ecosystem === "dpkg" && manual.has(item.name)) item.discoveryMethods = unique([...item.discoveryMethods, "apt-manual"]);
});

collect("snap", "snap", ["list", "--unicode=never"], (output) => {
  for (const [index, line] of output.split("\n").entries()) {
    if (!index) continue;
    const fields = line.trim().split(/\s+/);
    add({ name: fields[0], version: fields[1], ecosystem: "snap", architecture, scope: "system" }, "snap");
  }
});

for (const type of ["formula", "cask"]) collect(`homebrew-${type}`, "brew", ["list", `--${type}`, "--versions"], (output) => {
  for (const line of output.split("\n")) {
    const [name, ...versions] = line.trim().split(/\s+/);
    add({ name, version: versions.join(","), ecosystem: `homebrew-${type}`, architecture, scope: "user" }, `homebrew-${type}`);
  }
});

collect("pipx", "pipx", ["list", "--json"], (output) => {
  const parsed = JSON.parse(output || "{}");
  for (const [name, entry] of Object.entries(parsed.venvs || {})) add({ name, version: entry.metadata?.main_package?.package_version, ecosystem: "pipx", architecture, scope: "user", kind: "runtime" }, "pipx");
});

collect("npm-global", "npm", ["ls", "-g", "--depth=0", "--json"], (output) => {
  const parsed = JSON.parse(output || "{}");
  for (const [name, entry] of Object.entries(parsed.dependencies || {})) add({ name, version: entry.version, ecosystem: "npm-global", architecture, scope: "system", kind: "runtime" }, "npm-global");
});

collect("gem", "gem", ["list", "--local"], (output) => {
  for (const line of output.split("\n")) {
    const match = line.match(/^([^\s(]+) \(([^)]+)\)$/);
    if (match) add({ name: match[1], version: match[2], ecosystem: "rubygems", architecture, scope: "system", kind: "runtime" }, "gem");
  }
});

const toolCache = process.env.RUNNER_TOOL_CACHE;
let toolCount = 0;
if (toolCache) {
  try {
    for (const name of readdirSync(toolCache).sort(compareText)) {
      const toolPath = join(toolCache, name);
      if (!statSync(toolPath).isDirectory()) continue;
      for (const version of readdirSync(toolPath).sort(compareText)) {
        add({ name, version, ecosystem: "runner-tool-cache", architecture, scope: "system", kind: "tool", path: `<RUNNER_TOOL_CACHE>/${name}/${version}` }, "runner-tool-cache");
        toolCount += 1;
      }
    }
    collectors.push({ id: "runner-tool-cache", status: "ok", count: toolCount });
  } catch (error) {
    collectors.push({ id: "runner-tool-cache", status: "error", count: 0, error: String(error.message).slice(0, 500) });
  }
} else collectors.push({ id: "runner-tool-cache", status: "unavailable", count: 0 });

const probes = [
  ["git", ["--version"]], ["docker", ["--version"]], ["node", ["--version"]],
  ["python3", ["--version"]], ["java", ["-version"]], ["dotnet", ["--version"]], ["go", ["version"]], ["rustc", ["--version"]],
];
let probeCount = 0;
for (const [command, commandArgs] of probes) {
  const result = run(command, commandArgs);
  if (!result.ok) continue;
  const version = result.output.replace(/\s+/g, " ").slice(0, 200);
  add({ name: command, version, ecosystem: "version-probe", architecture, scope: "system", kind: "tool" }, "allowlisted-version-probe");
  probeCount += 1;
}
collectors.push({ id: "allowlisted-version-probes", status: "ok", count: probeCount });

const kernel = run("uname", ["-r"]).output;
await writeJson(resolve(args.output), {
  schemaVersion: "1.0.0",
  platform: "linux",
  image: {
    runnerLabel,
    imageVersion: process.env.ImageVersion || "",
    os: { name: osRelease.NAME || "Linux", version: osRelease.VERSION_ID || "", kernel, arch: architecture },
    sourceRefs: [readmeSource],
    collectors: collectors.sort((a, b) => compareText(a.id, b.id)),
    software: [...software.values()].sort((a, b) => compareText(a.id, b.id)),
  },
});
