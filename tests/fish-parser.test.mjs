import assert from "node:assert/strict";
import test from "node:test";
import { parseCompleteStatement, parseFishCompletionFile } from "../scripts/lib/parse-fish-completions.mjs";

test("parses Fish short and long options without executing expressions", () => {
  const parsed = parseCompleteStatement("complete -c demo -s h -l help -d 'Show help' -r -n '(__fish_seen_subcommand_from run)'", 7);
  assert.deepEqual(parsed.commands, ["demo"]);
  assert.deepEqual(parsed.short, ["h"]);
  assert.deepEqual(parsed.long, ["help"]);
  assert.equal(parsed.description, "Show help");
  assert.equal(parsed.requiresParameter, true);
  assert.equal(parsed.dynamic, true);
  assert.equal(parsed.conditions[0], "(__fish_seen_subcommand_from run)");
});

test("parses continuations, subcommands, wraps and dynamic arguments", () => {
  const source = [
    "complete -c demo -n __fish_use_subcommand -a run -d 'Run project' \\",
    "  -f",
    "complete -c demo -l target -xa '(__fish_dynamic_targets)' -d Target",
    "complete -c alias --wraps demo",
  ].join("\n");
  const records = parseFishCompletionFile(source, "demo.fish");
  const demo = records.find((item) => item.name === "demo");
  const alias = records.find((item) => item.name === "alias");
  assert.equal(demo.completions[0].kind, "subcommand");
  assert.equal(demo.completions[0].values[0], "run");
  assert.deepEqual(demo.commandPaths[0], { command: "demo run", description: "Run project", dynamic: false, line: 1 });
  assert.equal(demo.options[0].dynamic, true);
  assert.deepEqual(alias.wraps, ["demo"]);
});

test("builds complete nested command paths and explanations", () => {
  const source = [
    "complete -c git -n __fish_git_needs_command -a remote -d 'Manage repositories'",
    "complete -c git -n '__fish_git_using_command remote' -n 'not __fish_seen_subcommand_from add' -a add -d 'Add a remote'",
  ].join("\n");
  const git = parseFishCompletionFile(source, "git.fish")[0];
  assert.deepEqual(git.commandPaths.map(({ command, description }) => ({ command, description })), [
    { command: "git remote", description: "Manage repositories" },
    { command: "git remote add", description: "Add a remote" },
  ]);
});

test("ignores complete --do-complete queries", () => {
  assert.equal(parseCompleteStatement("complete -C 'git status'"), null);
});
