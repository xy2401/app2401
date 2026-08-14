const SEARCH_SHARDS = Array.from({ length: 16 }, (_, index) => index.toString(16));

export function summarizeDistributionPackage(item) {
  return {
    id: item.id,
    name: item.name,
    version: item.version,
    architecture: item.architecture,
    summary: item.summary,
    category: item.category || "",
    repository: item.repository,
    shard: item.id.slice(0, 2),
  };
}

export function buildDistributionSearchShards(packages) {
  const shards = Object.fromEntries(SEARCH_SHARDS.map((shard) => [shard, []]));
  for (const item of packages) shards[item.id.slice(0, 1)].push(summarizeDistributionPackage(item));
  return shards;
}
