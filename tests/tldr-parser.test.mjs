import assert from "node:assert/strict";
import test from "node:test";
import { parseTldrPage } from "../scripts/lib/parse-tldr-page.mjs";

test("parses a TLDR page as full commands with descriptions", () => {
  const page = parseTldrPage(`# git clone

> Clone an existing repository.
> More information: <https://git-scm.com/docs/git-clone>.

- Clone an existing repository into a new directory:

\`git clone {{remote_repository_location}} {{path/to/directory}}\`

- Clone only recent history:

\`git clone --depth 10 {{remote_repository_location}}\`
`, "common/git-clone.md");
  assert.equal(page.title, "git clone");
  assert.equal(page.rootCommand, "git");
  assert.equal(page.platform, "cross-platform");
  assert.equal(page.summary, "Clone an existing repository.");
  assert.deepEqual(page.examples[0], {
    description: "Clone an existing repository into a new directory:",
    command: "git clone {{remote_repository_location}} {{path/to/directory}}",
    line: 8,
  });
  assert.equal(page.examples.length, 2);
});

test("maps TLDR osx pages to macOS", () => {
  const page = parseTldrPage("# softwareupdate\n\n> System software update tool.\n", "osx/softwareupdate.md");
  assert.equal(page.platform, "macos");
  assert.equal(page.rootCommand, "softwareupdate");
  assert.deepEqual(page.examples, []);
});

test("keeps a translated page intact and removes its localized information link", () => {
  const page = parseTldrPage(`# git clone

> 克隆现有的代码仓库。
> 更多信息：<https://git-scm.com/docs/git-clone>。

- 克隆到指定目录：

\`git clone {{远程代码库地址}} {{路径/到/目录}}\`
`, "common/git-clone.md");
  assert.equal(page.summary, "克隆现有的代码仓库。");
  assert.deepEqual(page.examples.map(({ command, description }) => ({ command, description })), [{
    command: "git clone {{远程代码库地址}} {{路径/到/目录}}",
    description: "克隆到指定目录：",
  }]);
});
