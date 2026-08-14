import { compareText } from "./metadata-common.mjs";

const collectionTypeOrder = new Map([
  ["environment", 0], ["task", 1], ["pattern", 2], ["group", 3], ["metapackage", 4],
]);

function localized(value, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return fallback ? { en: fallback } : {};
}

export function dependencyPackageName(value) {
  return String(value || "")
    .split("|")[0]
    .trim()
    .replace(/^([a-z0-9+_.-]+)(?:\([^)]*\)|\s.*|[<>=].*)$/i, "$1")
    .replace(/:[a-z0-9_-]+$/i, "");
}

function normalizeMember(member) {
  const name = dependencyPackageName(member.name || member.package || member);
  if (!name) return null;
  return {
    name,
    role: ["mandatory", "default", "optional", "conditional"].includes(member.role || member.type) ? member.role || member.type : "default",
    ...(member.requires ? { condition: String(member.requires) } : {}),
  };
}

function isExplicitMetapackage(pkg) {
  const category = String(pkg.category || "").toLowerCase();
  const description = `${pkg.summary || ""} ${pkg.description || ""}`.toLowerCase();
  return /(^|\/)metapackages?$/.test(category)
    || /\bmeta[- ]package\b/.test(description)
    || (/-(?:meta|desktop|server)$/.test(pkg.name) && pkg.dependencies?.requires?.length > 1);
}

export function buildCollections(document) {
  const output = [];
  for (const group of document.groups || []) {
    output.push({
      id: `group:${group.id}`,
      sourceId: group.id,
      type: "group",
      names: localized(group.names, group.id),
      descriptions: localized(group.descriptions),
      visible: group.visible !== false,
      default: group.default === true,
      installTarget: group.id,
      members: (group.packages || []).map(normalizeMember).filter(Boolean),
      children: [],
    });
  }
  for (const environment of document.environments || []) {
    output.push({
      id: `environment:${environment.id}`,
      sourceId: environment.id,
      type: "environment",
      names: localized(environment.names, environment.id),
      descriptions: localized(environment.descriptions),
      visible: true,
      default: false,
      installTarget: environment.id,
      members: [],
      children: [
        ...(environment.groups || []).map((id) => ({ id: `group:${id}`, role: "default" })),
        ...(environment.optionalGroups || []).map((id) => ({ id: `group:${id}`, role: "optional" })),
      ],
    });
  }
  for (const collection of document.collections || []) {
    output.push({
      id: `${collection.type}:${collection.id}`,
      sourceId: collection.id,
      type: collection.type,
      names: localized(collection.names, collection.id),
      descriptions: localized(collection.descriptions),
      visible: collection.visible !== false,
      default: collection.default === true,
      installTarget: collection.installTarget || collection.id,
      members: (collection.members || []).map(normalizeMember).filter(Boolean),
      children: (collection.children || []).map((child) => ({ id: child.id.includes(":") ? child.id : `${child.type || "group"}:${child.id}`, role: child.role || "default" })),
    });
  }
  for (const pkg of document.packages || []) {
    if (!isExplicitMetapackage(pkg)) continue;
    const members = (pkg.dependencies?.requires || []).map((name) => normalizeMember({ name, role: "default" })).filter(Boolean);
    if (!members.length) continue;
    output.push({
      id: `metapackage:${pkg.name}`,
      sourceId: pkg.name,
      type: "metapackage",
      names: { en: pkg.name },
      descriptions: pkg.summary ? { en: pkg.summary } : {},
      visible: true,
      default: false,
      installTarget: pkg.name,
      members,
      children: [],
    });
  }

  const unique = new Map();
  for (const collection of output) {
    const existing = unique.get(collection.id);
    if (!existing) unique.set(collection.id, collection);
    else {
      existing.members = [...new Map([...existing.members, ...collection.members].map((member) => [`${member.name}\0${member.role}`, member])).values()];
      existing.children = [...new Map([...existing.children, ...collection.children].map((child) => [`${child.id}\0${child.role}`, child])).values()];
    }
  }
  return [...unique.values()].map((collection) => ({
    ...collection,
    members: collection.members.sort((a, b) => compareText(`${a.role}\0${a.name}`, `${b.role}\0${b.name}`)),
    children: collection.children.sort((a, b) => compareText(`${a.role}\0${a.id}`, `${b.role}\0${b.id}`)),
  })).sort((a, b) => (collectionTypeOrder.get(a.type) ?? 99) - (collectionTypeOrder.get(b.type) ?? 99) || compareText(a.id, b.id));
}

export function buildCuratedPackages(document, collections) {
  const packagesByName = new Map();
  for (const pkg of document.packages || []) {
    const list = packagesByName.get(pkg.name) || [];
    list.push(pkg);
    packagesByName.set(pkg.name, list);
  }
  const reasons = new Map();
  function addReason(packageName, reason) {
    for (const pkg of packagesByName.get(packageName) || []) {
      const list = reasons.get(pkg.id) || [];
      list.push(reason);
      reasons.set(pkg.id, list);
    }
  }
  for (const collection of collections) {
    if (!collection.visible) continue;
    if (collection.type === "metapackage") addReason(collection.installTarget, { type: "collection-target", collectionId: collection.id, role: "default" });
    for (const member of collection.members) addReason(member.name, { type: "collection-member", collectionId: collection.id, role: member.role });
  }
  return (document.packages || []).filter((pkg) => reasons.has(pkg.id)).map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    architecture: pkg.architecture,
    summary: pkg.summary,
    category: pkg.category || "",
    repository: pkg.repository,
    shard: pkg.id.slice(0, 2),
    reasons: reasons.get(pkg.id).sort((a, b) => compareText(`${a.collectionId}\0${a.role}`, `${b.collectionId}\0${b.role}`)),
  })).sort((a, b) => compareText(`${a.name}\0${a.id}`, `${b.name}\0${b.id}`));
}
