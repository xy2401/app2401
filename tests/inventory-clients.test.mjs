import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "public", "examples", "inventory.example.json");

function assertFormattedInventory(body) {
  assert.equal(body.charCodeAt(0) === 0xfeff, false);
  assert.equal(body, `${JSON.stringify(JSON.parse(body), null, 2)}\n`);
  const inventory = JSON.parse(body);
  assert.equal(inventory.schemaVersion, "1.0.0");
  assert.equal(inventory.packages.length, 3);
}

const hasPowerShell = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
test("PowerShell client always writes a formatted inventory", { skip: !hasPowerShell }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "software-atlas-ps-"));
  const output = join(directory, "inventory.json");
  try {
    execFileSync("pwsh", ["-NoProfile", "-File", join(root, "clients", "software-atlas.ps1"), "inventory", "-Output", output, "-SiteUrl", "https://example.pages.dev", "-Fixture", fixture, "-NoOpen"], { stdio: "pipe" });
    assertFormattedInventory(await readFile(output, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Bash client uses the same formatted inventory contract", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "software-atlas-sh-"));
  const output = join(directory, "inventory.json");
  try {
    execFileSync("bash", [join(root, "clients", "software-atlas.sh"), "inventory", "--output", output, "--site-url", "https://example.pages.dev", "--fixture", fixture, "--no-open"], { stdio: "pipe" });
    assertFormattedInventory(await readFile(output, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
