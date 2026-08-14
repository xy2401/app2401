"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CatalogMeta, Inventory, InventoryResult, SoftwareDetail, SoftwareSummary, SourcePackageRecord, SourceSoftwareRecord } from "./catalog-types";

type Status = "loading" | "ready" | "error";
type CatalogApi = {
  status: Status;
  error: string;
  meta: CatalogMeta | null;
  loadOnlineCatalog(): Promise<void>;
  loadLocalCatalog(files: File[]): Promise<void>;
  search(query: string, managers?: string[]): Promise<SoftwareSummary[]>;
  detail(id: string): Promise<SoftwareDetail>;
  browseSource(sourceId: string, query?: string, offset?: number): Promise<{ total: number; items: Array<{ package: SourcePackageRecord; software: SourceSoftwareRecord }> }>;
  matchInventory(inventory: Inventory): Promise<InventoryResult>;
};

const CatalogContext = createContext<CatalogApi | null>(null);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>());
  const requestId = useRef(0);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<CatalogMeta | null>(null);

  const call = useCallback(<T,>(type: string, payload: Record<string, unknown> = {}) => new Promise<T>((resolve, reject) => {
    const id = ++requestId.current;
    pending.current.set(id, { resolve: resolve as (value: unknown) => void, reject });
    workerRef.current?.postMessage({ id, type, payload });
  }), []);

  const loadOnlineCatalog = useCallback(async () => {
    setStatus("loading"); setError("");
    try { const next = await call<CatalogMeta>("loadOnline"); setMeta(next); setStatus("ready"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus("error"); throw cause; }
  }, [call]);

  const loadLocalCatalog = useCallback(async (files: File[]) => {
    setStatus("loading"); setError("");
    try { const next = await call<CatalogMeta>("loadFolder", { files }); setMeta(next); setStatus("ready"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus("error"); throw cause; }
  }, [call]);

  useEffect(() => {
    const worker = new Worker("/catalog-worker.js");
    const tasks = pending.current;
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const task = pending.current.get(event.data.id);
      if (!task) return;
      pending.current.delete(event.data.id);
      if (event.data.ok) task.resolve(event.data.data);
      else task.reject(new Error(event.data.error));
    };
    worker.onerror = () => { setError("元数据处理器启动失败"); setStatus("error"); };
    worker.postMessage({ id: ++requestId.current, type: "loadOnline", payload: {} });
    tasks.set(requestId.current, { resolve: (value) => { setMeta(value as CatalogMeta); setStatus("ready"); }, reject: (cause) => { setError(cause.message); setStatus("error"); } });
    return () => { worker.terminate(); tasks.forEach((task) => task.reject(new Error("Worker stopped"))); tasks.clear(); };
  }, []);

  const search = useCallback((query: string, managers: string[] = []) => call<SoftwareSummary[]>("search", { query, managers }), [call]);
  const detail = useCallback((id: string) => call<SoftwareDetail>("detail", { id }), [call]);
  const browseSource = useCallback((sourceId: string, query = "", offset = 0) => call<{ total: number; items: Array<{ package: SourcePackageRecord; software: SourceSoftwareRecord }> }>("browseSource", { sourceId, query, offset }), [call]);
  const matchInventory = useCallback((inventory: Inventory) => call<InventoryResult>("matchInventory", { inventory }), [call]);
  const value: CatalogApi = { status, error, meta, loadOnlineCatalog, loadLocalCatalog, search, detail, browseSource, matchInventory };
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("useCatalog must be used inside CatalogProvider");
  return value;
}
