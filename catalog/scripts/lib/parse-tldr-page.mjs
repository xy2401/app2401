const platformNames = new Map([
  ["common", "cross-platform"],
  ["osx", "macos"],
  ["windows", "windows"],
  ["linux", "linux"],
  ["android", "android"],
  ["freebsd", "freebsd"],
  ["netbsd", "netbsd"],
  ["openbsd", "openbsd"],
  ["sunos", "sunos"],
]);

function cleanQuote(value) {
  return value.replace(/^>\s?/, "").trim();
}

export function parseTldrPage(source, relativePath = "common/unknown.md") {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => line.startsWith("# "));
  if (titleIndex < 0) throw new Error(`${relativePath}: missing TLDR title`);
  const title = lines[titleIndex].slice(2).trim();
  if (!title) throw new Error(`${relativePath}: empty TLDR title`);

  const platformDirectory = relativePath.replaceAll("\\", "/").split("/")[0];
  const platform = platformNames.get(platformDirectory) || platformDirectory;
  const rootCommand = title.split(/\s+/)[0];
  const quoteLines = lines
    .slice(titleIndex + 1)
    .filter((line) => line.startsWith(">"))
    .map(cleanQuote)
    .filter((line) => line && !/<https?:\/\//i.test(line) && !/^(?:more information|see also):/i.test(line));

  const examples = [];
  for (let index = titleIndex + 1; index < lines.length; index++) {
    if (!lines[index].startsWith("- ")) continue;
    const description = lines[index].slice(2).trim();
    let commandIndex = index + 1;
    while (commandIndex < lines.length && !lines[commandIndex].trim()) commandIndex++;
    const commandLine = lines[commandIndex]?.trim() || "";
    if (commandLine.length >= 2 && commandLine.startsWith("`") && commandLine.endsWith("`")) {
      examples.push({ description, command: commandLine.slice(1, -1), line: commandIndex + 1 });
    }
  }

  return {
    title,
    rootCommand,
    platform,
    summary: quoteLines.join(" "),
    examples,
  };
}
