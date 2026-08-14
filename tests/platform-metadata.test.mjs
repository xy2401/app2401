import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(import.meta.dirname, "..");
const generatedAt = "2026-08-14T00:00:00.000Z";

async function write(path, body) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, body, "utf8");
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function rawFixture(base, id) {
  const directory = join(base, id);
  await mkdir(directory, { recursive: true });
  await write(join(directory, "meta.json"), `${JSON.stringify({ generatedAt, digest: `sha256:${id}` }, null, 2)}\n`);
  await write(join(directory, "repositories.tsv"), "official\tOfficial repository\thttps://example.invalid/repo\trev-1\n");
  return directory;
}

test("normalizes all distribution adapters and preserves DNF comps semantics", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "atlas-distros-"));
  const normalized = join(temporary, "normalized");
  await mkdir(normalized);
  const sources = [
    ["ubuntu-24.04", "ubuntu-24.04"], ["debian-stable", "debian-stable"], ["fedora", "fedora-latest"], ["rocky-9", "rocky-9"],
    ["arch", "arch-latest"], ["alpine", "alpine-latest"], ["opensuse-leap", "opensuse-leap-latest"],
  ];
  for (const [id, slug] of sources) {
    const raw = await rawFixture(temporary, slug);
    if (["ubuntu-24.04", "debian-stable"].includes(id)) {
      await write(join(raw, "os-release"), `NAME="${id}"\nVERSION_ID="1"\n`);
      await write(join(raw, "packages.txt"), "Package: atlas-demo\nVersion: 1:2.3-4\nArchitecture: amd64\nMaintainer: Example <example@example.invalid>\nDescription: Demo package\n A readable long description.\nHomepage: https://example.invalid/atlas\nSection: utils\nDepends: libc6 (>= 2)\nProvides: atlas-command\n\n");
      await write(join(raw, "tasks.tsv"), "developer-tools\tDeveloper tools\tatlas-demo,gcc\n");
    } else if (["fedora", "rocky-9"].includes(id)) {
      await write(join(raw, "os-release"), `NAME="${id}"\nVERSION_ID="9"\n`);
      await write(join(raw, "packages.records"), ["atlas-demo", "1", "2.3", "4", "x86_64", "Demo package", "Detailed RPM description", "https://example.invalid/atlas", "MIT", "official", "1024", "2048", "atlas-demo-2.3-4.src.rpm", "libc.so.6", "weak-dep", "suggested", "atlas-command", "old-atlas", "atlas-old"].join("\x1f") + "\x1e");
      if (id === "fedora") await write(join(raw, "comps-0.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<comps>
  <group>
    <id>development-tools</id>
    <name>Development Tools</name>
    <name xml:lang="zh_CN">开发工具</name>
    <description>Tools used for development.</description>
    <uservisible>true</uservisible>
    <default>false</default>
    <packagelist>
      <packagereq type="mandatory">atlas-demo</packagereq>
      <packagereq type="default">git</packagereq>
      <packagereq type="optional">cmake</packagereq>
      <packagereq type="conditional" requires="rust">cargo</packagereq>
    </packagelist>
  </group>
  <environment>
    <id>developer-workstation</id>
    <name>Developer Workstation</name>
    <description>A development environment.</description>
    <grouplist>
      <groupid>development-tools</groupid>
    </grouplist>
    <optionlist>
      <groupid>editors</groupid>
    </optionlist>
  </environment>
</comps>
`);
    } else if (id === "arch") {
      await write(join(raw, "os-release"), "NAME=Arch Linux\nVERSION_ID=rolling\n");
      await write(join(raw, "packages.tsv"), "atlas-demo\t2.3-4\tx86_64\tDemo package\thttps://example.invalid/atlas\tMIT\tcore\t2048\t1024\tglibc\toptional-tool\tatlas-command\told-atlas\tatlas-old\n");
      await write(join(raw, "groups.tsv"), "development\tatlas-demo\n");
    } else if (id === "alpine") {
      await write(join(raw, "os-release"), "NAME=Alpine Linux\nVERSION_ID=3.22\n");
      await write(join(raw, "packages.txt"), "P:atlas-demo\nV:2.3-r0\nA:x86_64\nT:Demo package\nU:https://example.invalid/atlas\nL:MIT\nm:Example\no:atlas-demo\nI:2048\nS:1024\nD:musl so:libc.musl-x86_64.so.1\np:cmd:atlas=2.3-r0\n\n");
    } else {
      await write(join(raw, "os-release"), "NAME=openSUSE Leap\nVERSION_ID=15.6\n");
      await write(join(raw, "packages.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<stream>
  <search-result>
    <solvable-list>
      <solvable name="atlas-demo" edition="2.3-4" arch="x86_64" repository="repo-oss" summary="Demo package" />
    </solvable-list>
  </search-result>
</stream>
`);
      await write(join(raw, "patterns.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<stream>
  <search-result>
    <solvable-list>
      <solvable name="devel_basis" edition="1" arch="noarch" repository="repo-oss" summary="Base Development" />
    </solvable-list>
  </search-result>
</stream>
`);
    }
    run("normalize-distro.mjs", ["--distro", id, "--raw-dir", raw, "--output", join(normalized, `${slug}.json`), "--generated-at", generatedAt]);
  }

  const fedora = JSON.parse(await readFile(join(normalized, "fedora-latest.json"), "utf8"));
  assert.equal(fedora.groups[0].names.zh_CN, "开发工具");
  assert.deepEqual(fedora.groups[0].packages.map((item) => item.type), ["mandatory", "default", "optional", "conditional"]);
  assert.deepEqual(fedora.environments[0].groups, ["development-tools"]);
  assert.deepEqual(fedora.environments[0].optionalGroups, ["editors"]);
  const ubuntu = JSON.parse(await readFile(join(normalized, "ubuntu-24.04.json"), "utf8"));
  assert.equal(ubuntu.collections[0].id, "developer-tools");
  const arch = JSON.parse(await readFile(join(normalized, "arch-latest.json"), "utf8"));
  assert.equal(arch.collections[0].members[0].name, "atlas-demo");
  const opensuse = JSON.parse(await readFile(join(normalized, "opensuse-leap-latest.json"), "utf8"));
  assert.equal(opensuse.collections[0].type, "pattern");

  const output = join(temporary, "public-metadata");
  run("build-distro-catalog.mjs", ["--input", normalized, "--output", output, "--generated-at", generatedAt]);
  const index = JSON.parse(await readFile(join(output, "index.json"), "utf8"));
  assert.equal(index.distributions.length, 7);
  assert.equal(Object.keys(index.distributions[0].files.details.shards).length, 256);
  assert.ok(index.distributions.some((entry) => entry.collectionCount > 0));
  assert.ok(index.distributions.find((entry) => entry.id === "fedora-latest").curatedPackageCount > 0);
  assert.equal(JSON.parse(await readFile(join(output, "fedora-latest", "collections.json"), "utf8")).collections[0].type, "environment");
  assert.equal((await readdir(join(output, "fedora-latest", "packages", "details"))).length, 256);
  const indexBody = await readFile(join(output, "index.json"), "utf8");
  assert.equal(indexBody, `${JSON.stringify(index, null, 2)}\n`);
});

test("environment schema rejects machine identity fields", async () => {
  const schema = JSON.parse(await readFile(join(root, "schemas", "environment-v1.schema.json"), "utf8"));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const document = {
    schemaVersion: "1.0.0",
    generatedAt,
    provider: "github-actions",
    platform: "linux",
    image: { runnerLabel: "ubuntu-24.04", imageVersion: "1", os: { name: "Ubuntu", version: "24.04", arch: "amd64" }, sourceRefs: [], collectors: [], software: [], hostname: "private-host" },
  };
  assert.equal(validate(document), false);
});
