import { basename } from "node:path";

const valueFlags = new Set(["c", "p", "s", "l", "o", "a", "d", "n", "w", "C"]);
const longFlags = new Map([
  ["command", "c"], ["path", "p"], ["short-option", "s"], ["long-option", "l"], ["old-option", "o"],
  ["arguments", "a"], ["description", "d"], ["condition", "n"], ["wraps", "w"],
  ["require-parameter", "r"], ["exclusive", "x"], ["no-files", "f"], ["force-files", "F"],
  ["keep-order", "k"], ["erase", "e"], ["do-complete", "C"],
]);

export function fishStatements(source) {
  const statements = [];
  let buffer = "";
  let quote = "";
  let escaped = false;
  let parenDepth = 0;
  let comment = false;
  let line = 1;
  let startLine = 1;
  const push = () => {
    const text = buffer.trim();
    if (text.startsWith("complete ")) statements.push({ text, line: startLine });
    buffer = "";
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (comment) {
      if (char === "\n") { push(); line++; startLine = line; comment = false; }
      continue;
    }
    if (escaped) {
      if (char !== "\r" && char !== "\n") buffer += `\\${char}`;
      escaped = false;
      if (char === "\n") line++;
      continue;
    }
    if (char === "\\" && (quote !== "'" || source[index + 1] === "'" || source[index + 1] === "\\")) { escaped = true; continue; }
    if (quote) {
      if (char === quote) quote = "";
      buffer += char;
      if (char === "\n") line++;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; buffer += char; continue; }
    if (char === "#" && (!buffer || /\s/.test(buffer.at(-1)))) { comment = true; continue; }
    if (char === "(") parenDepth++;
    else if (char === ")" && parenDepth) parenDepth--;
    if (char === "\n") {
      if (parenDepth === 0) push();
      else buffer += " ";
      line++;
      if (!buffer) startLine = line;
      continue;
    }
    buffer += char;
  }
  push();
  return statements;
}

export function fishTokens(statement) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;
  let parenDepth = 0;
  const push = () => { if (token) tokens.push(token); token = ""; };
  for (let index = 0; index < statement.length; index++) {
    const char = statement[index];
    if (escaped) { token += char === "t" ? "\t" : char; escaped = false; continue; }
    if (char === "\\" && (quote !== "'" || statement[index + 1] === "'" || statement[index + 1] === "\\")) { escaped = true; continue; }
    if (quote) {
      if (char === quote) quote = "";
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === "(") { parenDepth++; token += char; continue; }
    if (char === ")" && parenDepth) { parenDepth--; token += char; continue; }
    if (char === "#" && !token && parenDepth === 0) break;
    if (/\s/.test(char) && parenDepth === 0) { push(); continue; }
    token += char;
  }
  if (escaped) token += "\\";
  push();
  return tokens;
}

function setValue(output, flag, value) {
  if (flag === "c" || flag === "p") output.commands.push(value);
  else if (flag === "s") output.short.push(value);
  else if (flag === "l") output.long.push(value);
  else if (flag === "o") output.old.push(value);
  else if (flag === "a") output.arguments.push(value);
  else if (flag === "d") output.description = value;
  else if (flag === "n") output.conditions.push(value);
  else if (flag === "w") output.wraps.push(value);
  else if (flag === "C") output.doComplete = true;
}

function cleanDescription(value) {
  const translated = value.match(/^\((?:_|gettext)\s+(.+)\)$/s);
  return translated ? translated[1] : value;
}

export function parseCompleteStatement(statement, line = 1) {
  const tokens = fishTokens(statement);
  if (tokens[0] !== "complete") return null;
  const output = { commands: [], short: [], long: [], old: [], arguments: [], conditions: [], wraps: [], description: "", requiresParameter: false, noFiles: false, forceFiles: false, keepOrder: false, erase: false, doComplete: false, line, raw: statement };
  const positional = [];
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.startsWith("--")) {
      const [name, inline] = token.slice(2).split(/=(.*)/s, 2);
      const flag = longFlags.get(name);
      if (!flag) { positional.push(token); continue; }
      if (valueFlags.has(flag)) setValue(output, flag, inline ?? tokens[++index] ?? "");
      else if (flag === "r") output.requiresParameter = true;
      else if (flag === "x") { output.requiresParameter = true; output.noFiles = true; }
      else if (flag === "f") output.noFiles = true;
      else if (flag === "F") output.forceFiles = true;
      else if (flag === "k") output.keepOrder = true;
      else if (flag === "e") output.erase = true;
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      const flags = token.slice(1);
      let recognized = true;
      for (let flagIndex = 0; flagIndex < flags.length; flagIndex++) {
        const flag = flags[flagIndex];
        if (valueFlags.has(flag)) {
          const inline = flags.slice(flagIndex + 1);
          setValue(output, flag, inline || tokens[++index] || "");
          flagIndex = flags.length;
        } else if (flag === "r") output.requiresParameter = true;
        else if (flag === "x") { output.requiresParameter = true; output.noFiles = true; }
        else if (flag === "f") output.noFiles = true;
        else if (flag === "F") output.forceFiles = true;
        else if (flag === "k") output.keepOrder = true;
        else if (flag === "e") output.erase = true;
        else { recognized = false; break; }
      }
      if (!recognized) positional.push(token);
      continue;
    }
    positional.push(token);
  }
  if (!output.commands.length && positional[0]) output.commands.push(positional[0]);
  if (output.doComplete) return null;
  output.description = cleanDescription(output.description);
  output.dynamic = [...output.commands, ...output.arguments, ...output.conditions, output.description].some((value) => /\$|\([^)]*\)/.test(value));
  return output;
}

const uniqueBy = (items, key) => [...new Map(items.map((item) => [key(item), item])).values()];

function commandParents(conditions) {
  const parents = [];
  for (const condition of conditions) {
    for (const match of condition.matchAll(/__fish_[a-z0-9_]*using_command\s+([a-z0-9][a-z0-9._+-]*)/gi)) parents.push(match[1]);
  }
  return [...new Set(parents)];
}

function isCommandContext(conditions) {
  return conditions.some((condition) => /(?:needs_command|use_subcommand|not\s+__fish_seen_subcommand_from|not\s+.*seen_subcommand)/.test(condition));
}

function staticCommandCandidates(argument, fallbackDescription) {
  if (!argument || /[$()]/.test(argument)) return [];
  const output = [];
  for (const line of argument.split(/\r?\n/)) {
    const [values, inlineDescription = ""] = line.split("\t", 2);
    for (const value of values.trim().split(/\s+/)) {
      if (!/^[a-z0-9][a-z0-9._:+/-]*$/i.test(value) || value.startsWith("-")) continue;
      output.push({ value, description: inlineDescription.replace(/^['"]|['"]$/g, "").trim() || fallbackDescription });
    }
  }
  return output;
}

export function parseFishCompletionFile(source, fileName) {
  const fallbackCommand = basename(fileName, ".fish");
  const records = new Map();
  for (const statement of fishStatements(source)) {
    const parsed = parseCompleteStatement(statement.text, statement.line);
    if (!parsed || parsed.erase) continue;
    const commands = parsed.commands.length ? parsed.commands : [fallbackCommand];
    for (const command of commands) {
      if (!command || /[$()\s]/.test(command)) continue;
      if (!records.has(command)) records.set(command, { name: command, wraps: [], options: [], completions: [], commandPaths: [], statementCount: 0, dynamicStatementCount: 0 });
      const record = records.get(command);
      record.statementCount++;
      if (parsed.dynamic) record.dynamicStatementCount++;
      record.wraps.push(...parsed.wraps.filter((value) => value && !/[$()\s]/.test(value)));
      if (parsed.short.length || parsed.long.length || parsed.old.length) {
        record.options.push({
          short: parsed.short,
          long: parsed.long,
          old: parsed.old,
          description: parsed.description,
          requiresParameter: parsed.requiresParameter,
          noFiles: parsed.noFiles,
          conditions: parsed.conditions,
          arguments: parsed.arguments,
          dynamic: parsed.dynamic,
          line: parsed.line,
        });
      } else if (parsed.arguments.length) {
        record.completions.push({
          values: parsed.arguments,
          description: parsed.description,
          conditions: parsed.conditions,
          kind: parsed.conditions.some((value) => /use_subcommand|not.*seen_subcommand/.test(value)) ? "subcommand" : "argument",
          dynamic: parsed.dynamic,
          line: parsed.line,
        });
        const parents = commandParents(parsed.conditions);
        if (parents.length || isCommandContext(parsed.conditions)) {
          for (const argument of parsed.arguments) {
            for (const candidate of staticCommandCandidates(argument, parsed.description)) {
              const paths = parents.length ? parents.map((parent) => `${command} ${parent} ${candidate.value}`) : [`${command} ${candidate.value}`];
              for (const path of paths) record.commandPaths.push({ command: path, description: candidate.description, dynamic: parsed.dynamic, line: parsed.line });
            }
          }
        }
      }
    }
  }
  if (!records.size) records.set(fallbackCommand, { name: fallbackCommand, wraps: [], options: [], completions: [], commandPaths: [], statementCount: 0, dynamicStatementCount: 0 });
  return [...records.values()].map((record) => ({
    ...record,
    wraps: [...new Set(record.wraps)].sort(),
    options: uniqueBy(record.options.map((item) => ({ ...item, short: [...new Set(item.short)], long: [...new Set(item.long)], old: [...new Set(item.old)], conditions: [...new Set(item.conditions)], arguments: [...new Set(item.arguments)] })), (item) => JSON.stringify(item)),
    completions: uniqueBy(record.completions.map((item) => ({ ...item, values: [...new Set(item.values)], conditions: [...new Set(item.conditions)] })), (item) => JSON.stringify(item)),
    commandPaths: uniqueBy(record.commandPaths, (item) => `${item.command}\0${item.description}`).sort((a, b) => a.command.localeCompare(b.command)),
  }));
}
