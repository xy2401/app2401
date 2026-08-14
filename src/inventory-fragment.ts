import type { Inventory } from "./catalog-types";

const prefix = "#inventory=v1.base64.";
const managers = new Set(["scoop", "chocolatey", "homebrew"]);
const systems = new Set(["windows", "macos", "linux", "unknown"]);

export function validateInventory(value: unknown): Inventory {
  if (!value || typeof value !== "object") throw new Error("这不是有效的 inventory v1 文件");
  const inventory = value as Partial<Inventory>;
  if (inventory.schemaVersion !== "1.0.0" || typeof inventory.generatedAt !== "string") throw new Error("这不是有效的 inventory v1 文件");
  if (!inventory.system || !systems.has(inventory.system.os || "") || typeof inventory.system.arch !== "string" || !inventory.system.arch) throw new Error("清单中的系统信息无效");
  if (!Array.isArray(inventory.packages)) throw new Error("清单中的软件列表无效");
  for (const item of inventory.packages) {
    if (!item || !managers.has(item.manager) || typeof item.name !== "string" || !item.name || typeof item.version !== "string") throw new Error("清单中包含无效的软件记录");
  }
  return inventory as Inventory;
}

export function decodeInventoryFragment(hash: string): Inventory | null {
  if (!hash.startsWith(prefix)) return null;
  const payload = hash.slice(prefix.length);
  if (!payload || payload.length > 1_000_000 || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("地址中的清单编码无效");
  const standard = payload.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard + "=".repeat((4 - standard.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return validateInventory(JSON.parse(new TextDecoder().decode(bytes)));
}
