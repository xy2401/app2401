export type Manager = "scoop" | "chocolatey" | "homebrew";

export type CatalogSource = {
  id: string;
  manager: Manager;
  label: string;
  tier: "known-bucket" | "curated-community" | "official-index";
  itemCount: number;
  snapshot: string;
  snapshotAt?: string;
  sourceUrl?: string;
};

export type KnowledgeSource = {
  id: string;
  type: "command-completions" | "command-examples";
  label: string;
  tier: "official-repository" | "curated-community";
  itemCount: number;
  recordCount: number;
  exampleCount?: number;
  localeCount?: number;
  translationCount?: number;
  snapshot: string;
  snapshotAt?: string;
  sourceUrl?: string;
};

export type CatalogMeta = {
  schemaVersion: string;
  generatedAt: string;
  snapshotId: string;
  softwareCount: number;
  packageCount: number;
  commandCount: number;
  tldrPageCount: number;
  tldrTranslationCount: number;
  tldrLocaleCount: number;
  sources: CatalogSource[];
  knowledgeSources: KnowledgeSource[];
  mode: "online" | "local";
  fileName?: string;
};

export type SourcePackageRecord = Pick<PackageRecord, "id" | "softwareId" | "manager" | "sourceId" | "collection" | "name" | "title" | "version" | "description" | "platforms" | "status">;
export type SourceSoftwareRecord = Pick<SoftwareRecord, "id" | "name" | "summary" | "platforms">;

export type SoftwareSummary = {
  id: string;
  name: string;
  aliases: string[];
  summary: string;
  platforms: string[];
  managers: Manager[];
  packageCount: number;
  commands: string[];
  score?: number;
};

export type SoftwareRecord = {
  id: string;
  name: string;
  aliases: string[];
  summary: string;
  homepages: string[];
  repositories: string[];
  licenses: string[];
  platforms: string[];
  packageIds: string[];
  sourceIds: string[];
  candidateSoftwareIds: string[];
  commandIds?: string[];
  tldrPageIds?: string[];
};

export type FishCommandPath = {
  command: string;
  description: string;
  dynamic: boolean;
  line: number;
  sourceRef: string;
};

export type FishCommandRecord = {
  id: string;
  name: string;
  shell: "fish";
  wraps: string[];
  softwareIds: string[];
  candidateSoftwareIds: string[];
  commandCount: number;
  statementCount: number;
  dynamicStatementCount: number;
  commands: FishCommandPath[];
  sourceRefs: string[];
};

export type TldrExample = {
  command: string;
  description: string;
  line: number;
  sourceRef: string;
};

export type TldrPageRecord = {
  id: string;
  canonicalPath: string;
  locale: string;
  sourceLocale: string;
  name: string;
  title: string;
  summary: string;
  platform: string;
  softwareIds: string[];
  candidateSoftwareIds: string[];
  exampleCount: number;
  examples: TldrExample[];
  sourceRef: string;
};

export type PackageRecord = {
  id: string;
  softwareId: string;
  manager: Manager;
  sourceId: string;
  collection: string;
  name: string;
  title: string;
  version: string;
  description: string;
  homepage: string;
  repository: string;
  licenses: string[];
  platforms: string[];
  architectures: string[];
  installCommand: string;
  artifacts: Array<{ url: string; hash?: string; architecture?: string; kind?: string }>;
  dependencies: string[];
  commands: string[];
  status: "active" | "deprecated" | "disabled" | "unlisted";
  sourceRef: string;
  sourceDetails: Record<string, unknown> & { type: string };
};

export type SoftwareDetail = {
  software: SoftwareRecord;
  packages: PackageRecord[];
  candidates: SoftwareSummary[];
  commands: FishCommandRecord[];
  tldrPages: TldrPageRecord[];
};

export type Inventory = {
  schemaVersion: "1.0.0";
  generatedAt: string;
  system: { os: "windows" | "macos" | "linux" | "unknown"; arch: string };
  packages: Array<{
    manager: Manager;
    collection?: string;
    name: string;
    version: string;
    scope?: "user" | "system" | "unknown";
    path?: string;
  }>;
};

export type InventoryResult = {
  system: Inventory["system"];
  generatedAt: string;
  matched: Array<{ installed: Inventory["packages"][number]; package: PackageRecord; software: SoftwareRecord }>;
  unknown: Inventory["packages"];
};
