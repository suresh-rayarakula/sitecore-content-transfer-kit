"use client";

import { useEffect, useRef, useState } from "react";
import EnvPanel from "./EnvPanel";
import type { DataTree, EnvConfig, LogLine, MergeStrategy, Scope } from "@/lib/types";

const emptyEnv: EnvConfig = {
  host: "",
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  // Sitecore Cloud's OAuth (Auth0-based) token endpoint requires this on
  // every client_credentials request — omit it and you get a 403
  // access_denied, not a helpful "audience is required" message. Default
  // it so people don't have to discover that the hard way.
  audience: "https://api.sitecorecloud.io",
};

const SCOPES: Scope[] = ["SingleItem", "ItemAndDescendants"];
const MERGE_STRATEGIES: MergeStrategy[] = [
  "OverrideExistingItem",
  "KeepExistingItem",
  // TODO: Enable additional merge strategies in a future release
  // "LatestWin",
  // "OverrideExistingTree",
];

let rowId = 0;
interface Row extends DataTree {
  id: number;
}

function newRow(): Row {
  rowId += 1;
  return { id: rowId, ItemPath: "", Scope: "SingleItem", MergeStrategy: "OverrideExistingItem" };
}

export default function TransferConsole({ orgLabel }: { orgLabel?: string }) {
  const [source, setSource] = useState<EnvConfig>(emptyEnv);
  const [target, setTarget] = useState<EnvConfig>(emptyEnv);
  const [database, setDatabase] = useState("master");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs]);

  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const addRow = () => setRows((rs) => [...rs, newRow()]);

  const canDispatch =
    !running &&
    source.host &&
    source.tokenUrl &&
    source.clientId &&
    source.clientSecret &&
    target.host &&
    target.tokenUrl &&
    target.clientId &&
    target.clientSecret &&
    rows.every((r) => r.ItemPath.trim().length > 0);

  const dispatch = async () => {
    setRunning(true);
    setLogs([]);
    try {
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          target,
          database,
          dataTrees: rows.map(({ ItemPath, Scope, MergeStrategy }) => ({ ItemPath, Scope, MergeStrategy })),
        }),
      });

      if (!res.body) throw new Error("No response stream from server.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            setLogs((prev) => [...prev, JSON.parse(line) as LogLine]);
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (e) {
      setLogs((prev) => [
        ...prev,
        { msg: e instanceof Error ? e.message : String(e), ts: Date.now(), level: "error" },
      ]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between border-b border-line pb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Sitecore Content Transfer Kit</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Content Transfer Console</h1>
          <p className="mt-2 max-w-xl text-sm text-white/50">
            Move items between Sitecore environments using the Content Transfer API and Item Transfer API — the supported replacement for the retired Package Designer/Installer.
          </p>
        </div>
        {orgLabel && (
          <span className="whitespace-nowrap rounded border border-line px-3 py-1 font-mono text-xs text-white/50">
            {orgLabel}
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <EnvPanel label="Source · Departure" accent="#5ee6c9" value={source} onChange={setSource} />
        <EnvPanel label="Target · Arrival" accent="#e6b95e" value={target} onChange={setTarget} />
      </div>

      <section className="mt-8 rounded-lg border border-line bg-panel/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">Manifest</h3>
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-white/40">
            Database
            <input
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              className="w-28 rounded border border-line bg-ink px-2 py-1 font-mono text-xs text-white/90 focus:border-white/30"
            />
          </label>
        </div>

        <div className="manifest-rail overflow-hidden rounded border border-line">
          <div className="grid grid-cols-[1fr_180px_220px_40px] gap-0 border-b border-line bg-ink/60 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white/40">
            <span>Item path</span>
            <span>Scope</span>
            <span>Merge strategy</span>
            <span />
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[1fr_180px_220px_40px] items-center gap-0 border-b border-line px-3 py-2 last:border-b-0"
            >
              <input
                placeholder="/sitecore/content/Site/Home/Page"
                value={row.ItemPath}
                onChange={(e) => updateRow(row.id, { ItemPath: e.target.value })}
                className="bg-transparent px-2 font-mono text-sm text-white/90 placeholder:text-white/25 outline-none"
              />
              <select
                value={row.Scope}
                onChange={(e) => updateRow(row.id, { Scope: e.target.value as Scope })}
                className="bg-transparent px-2 font-mono text-xs text-white/70 outline-none"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s} className="bg-panel">
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={row.MergeStrategy}
                onChange={(e) => updateRow(row.id, { MergeStrategy: e.target.value as MergeStrategy })}
                className="bg-transparent px-2 font-mono text-xs text-white/70 outline-none"
              >
                {MERGE_STRATEGIES.map((m) => (
                  <option key={m} value={m} className="bg-panel">
                    {m}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                aria-label="Remove item path"
                className="justify-self-center text-white/30 hover:text-rose transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="mt-3 rounded border border-line px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/60 hover:border-white/30 hover:text-white/90 transition-colors"
        >
          + Add item path
        </button>
      </section>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          disabled={!canDispatch}
          onClick={dispatch}
          className="rounded-md bg-accent px-6 py-3 font-mono text-sm font-medium uppercase tracking-wide text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-30 hover:opacity-90"
        >
          {running ? "Transfer in progress…" : "Dispatch transfer"}
        </button>
        {!canDispatch && !running && (
          <span className="font-mono text-xs text-white/35">
            Fill in both environments and at least one item path to enable dispatch.
          </span>
        )}
      </div>

      <section className="mt-8">
        <h3 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-white/70">Manifest log</h3>
        <div className="scanline h-96 overflow-y-auto rounded-lg border border-line bg-black/40 p-4 font-mono text-[13px] leading-relaxed">
          {logs.length === 0 && (
            <p className="text-white/25">Awaiting dispatch — logs will stream here in real time.</p>
          )}
          {logs.map((l, i) => (
            <div key={i} className={colorFor(l.level)}>
              <span className="mr-2 text-white/25">{formatTime(l.ts)}</span>
              {l.msg}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}

function colorFor(level?: LogLine["level"]) {
  switch (level) {
    case "success":
      return "text-accent";
    case "warn":
      return "text-amber";
    case "error":
      return "text-rose";
    default:
      return "text-white/75";
  }
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false });
}
