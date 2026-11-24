"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import ContentTree from "./ContentTree";
import { childrenQuery, parseAuthoringChildren } from "@/lib/authoringTree";
import { runMarketplaceTransfer } from "@/lib/marketplaceTransfer";
import type { XmEnvironment } from "@/lib/xmEnvironments";
import type { DataTree, LogLine, MergeStrategy, Scope, TreeNode, TreeResponse } from "@/lib/types";

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: "SingleItem", label: "This item only" },
  { value: "ItemAndDescendants", label: "This item and all descendants" },
];

const MERGE_OPTIONS: { value: MergeStrategy; label: string }[] = [
  { value: "OverrideExistingItem", label: "Override existing item" },
  { value: "KeepExistingItem", label: "Keep existing item" },
];

const STEPS = [
  { id: "connect", n: "1", label: "Connect", hint: "Pick source and destination" },
  { id: "select", n: "2", label: "Select content", hint: "Browse, scope and merge strategy" },
  { id: "review", n: "3", label: "Review & transfer", hint: "Run the migration" },
] as const;

type Step = (typeof STEPS)[number]["id"];

let rowId = 0;
interface Row extends DataTree {
  id: number;
  name: string;
}

function newRow(partial?: Partial<Row>): Row {
  rowId += 1;
  return {
    id: rowId,
    name: "",
    ItemPath: "",
    Scope: "SingleItem",
    MergeStrategy: "OverrideExistingItem",
    ...partial,
  };
}

function normPath(path: string) {
  return path.trim().replace(/\/+$/, "").toLowerCase();
}

function samePath(a: string, b: string) {
  return normPath(a) === normPath(b);
}

function isUnder(parent: string, child: string) {
  const p = normPath(parent);
  const c = normPath(child);
  return p.length > 0 && c.startsWith(`${p}/`);
}

function itemName(row: Row) {
  if (row.name.trim()) return row.name.trim();
  const parts = row.ItemPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || row.ItemPath;
}

function envLabel(env: XmEnvironment | undefined) {
  return env ? `${env.app} / ${env.name}` : "";
}

export default function TransferConsole({
  orgLabel,
  client,
  environments,
  contextReady,
  contextError,
}: {
  orgLabel?: string;
  client: ClientSDK | null;
  environments: XmEnvironment[];
  contextReady: boolean;
  contextError?: string;
}) {
  const [sourceApp, setSourceApp] = useState("");
  const [targetApp, setTargetApp] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [database, setDatabase] = useState("master");
  const [rows, setRows] = useState<Row[]>([]);
  const [sites, setSites] = useState<TreeNode[]>([]);
  const [focusPath, setFocusPath] = useState<string>();
  const [focusNonce, setFocusNonce] = useState(0);
  const [manualPath, setManualPath] = useState("");
  const [step, setStep] = useState<Step>("connect");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs]);

  const apps = Array.from(new Set(environments.map((env) => env.app)));
  const sourceChoices = environments.filter((env) => env.app === sourceApp);
  const targetChoices = environments.filter((env) => env.app === targetApp);
  const sourceEnv = environments.find((env) => env.id === sourceId);
  const targetEnv = environments.find((env) => env.id === targetId);

  useEffect(() => {
    if (!environments.length || sourceId) return;
    const first = environments[0];
    const second = environments.find((env) => env.id !== first.id);
    setSourceApp(first.app);
    setSourceId(first.id);
    setTargetApp(second?.app || first.app);
    if (second) setTargetId(second.id);
  }, [environments, sourceId]);

  useEffect(() => {
    setSites([]);
    setFocusPath(undefined);
  }, [sourceId, database]);

  const pairReady = Boolean(client && sourceEnv && targetEnv && sourceEnv.id !== targetEnv.id);
  const selectionReady = rows.length > 0 && rows.every((r) => r.ItemPath.trim().length > 0);
  const canDispatch = !running && pairReady && selectionReady;

  const updateRow = (id: number, patch: Partial<Row>) => {
    setRows((rs) => {
      let next = rs.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const parent = next.find((r) => r.id === id);
      if (parent && patch.Scope === "ItemAndDescendants") {
        next = next.filter((r) => r.id === parent.id || !isUnder(parent.ItemPath, r.ItemPath));
      }
      return next;
    });
  };

  const removeRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));

  const toggleNode = (node: { name: string; path: string }) => {
    setRows((rs) => {
      if (rs.some((r) => r.Scope === "ItemAndDescendants" && isUnder(r.ItemPath, node.path))) return rs;
      const existing = rs.find((r) => samePath(r.ItemPath, node.path));
      if (existing) return rs.filter((r) => r.id !== existing.id);
      return [...rs, newRow({ ItemPath: node.path, name: node.name })];
    });
  };

  const addManual = () => {
    const path = manualPath.trim();
    if (!path.startsWith("/sitecore") || path.includes("..")) return;
    if (rows.some((r) => samePath(r.ItemPath, path))) {
      setManualPath("");
      return;
    }
    const parts = path.split("/").filter(Boolean);
    setRows((rs) => [...rs, newRow({ ItemPath: path, name: parts[parts.length - 1] || path })]);
    setManualPath("");
  };

  const openStep = (next: Step) => {
    if (next === "connect") setStep("connect");
    if (next === "select" && pairReady) setStep("select");
    if (next === "review" && pairReady && selectionReady) setStep("review");
  };

  const loadChildren = useCallback(
    async (path: string, cursor?: string): Promise<TreeResponse> => {
      if (!client || !sourceEnv) throw new Error("Choose a source environment first.");
      const graph = childrenQuery(database, path, cursor);
      const result = await client.mutate("xmc.authoring.graphql", {
        params: {
          body: {
            query: graph.query,
            variables: graph.variables,
          },
          query: { sitecoreContextId: sourceEnv.contextId },
        },
        timeoutMs: 60000,
      });
      if ("error" in result && result.error) {
        const reason = result.error;
        throw new Error(reason instanceof Error ? reason.message : "The content tree request failed.");
      }
      return parseAuthoringChildren(result.data ?? {}, path);
    },
    [client, database, sourceEnv]
  );

  const chooseApp = (side: "source" | "target", app: string) => {
    const choices = environments.filter((env) => env.app === app);
    const current = side === "source" ? sourceId : targetId;
    const next = choices.some((env) => env.id === current) ? current : choices[0]?.id || "";
    if (side === "source") {
      setSourceApp(app);
      setSourceId(next);
    } else {
      setTargetApp(app);
      setTargetId(next);
    }
  };

  const dispatch = async () => {
    if (!client || !sourceEnv || !targetEnv) return;
    setRunning(true);
    setLogs([]);
    try {
      await runMarketplaceTransfer(
        client,
        {
          sourceContextId: sourceEnv.contextId,
          targetContextId: targetEnv.contextId,
          database,
          dataTrees: rows.map(({ ItemPath, Scope, MergeStrategy }) => ({ ItemPath, Scope, MergeStrategy })),
        },
        (line) => setLogs((prev) => [...prev, line])
      );
    } catch (e) {
      setLogs((prev) => [
        ...prev,
        { msg: e instanceof Error ? e.message : String(e), ts: Date.now(), level: "error" },
      ]);
    } finally {
      setRunning(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

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

      <nav aria-label="Progress" className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        {STEPS.map((s, i) => {
          const active = step === s.id;
          const done = stepIndex > i;
          const locked =
            (s.id === "select" && !pairReady) || (s.id === "review" && !(pairReady && selectionReady));
          return (
            <div key={s.id} className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                disabled={locked}
                onClick={() => openStep(s.id)}
                className="flex min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-xs ${
                    active || done ? "bg-accent text-ink" : "border border-line text-white/50"
                  }`}
                >
                  {done ? "✓" : s.n}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm ${active ? "text-white" : "text-white/70"}`}>{s.label}</span>
                  <span className="block truncate text-xs text-white/40">{s.hint}</span>
                </span>
              </button>
              {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-line sm:block" />}
            </div>
          );
        })}
      </nav>

      {step === "connect" && (
        <section>
          {!contextReady && (
            <p className="mb-4 font-mono text-xs text-white/45">
              {contextError
                ? "Open this app from the Sitecore portal. The project and environment lists come from the environments this app is installed on."
                : "Connecting to Sitecore…"}
            </p>
          )}
          {contextReady && environments.length === 0 && (
            <p className="mb-4 font-mono text-xs text-white/45">
              No environments are available yet. Install this app on the source and destination environments, then reopen it from the portal.
            </p>
          )}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <EnvSelect
              label="Source · Departure"
              accent="#5ee6c9"
              apps={apps}
              app={sourceApp}
              environments={sourceChoices}
              environmentId={sourceId}
              onApp={(app) => chooseApp("source", app)}
              onEnvironment={setSourceId}
            />
            <EnvSelect
              label="Target · Arrival"
              accent="#e6b95e"
              apps={apps}
              app={targetApp}
              environments={targetChoices}
              environmentId={targetId}
              onApp={(app) => chooseApp("target", app)}
              onEnvironment={setTargetId}
            />
          </div>
          <div className="mt-8 flex items-center gap-4">
            <button
              type="button"
              disabled={!pairReady}
              onClick={() => setStep("select")}
              className="rounded-md bg-accent px-6 py-3 font-mono text-sm font-medium uppercase tracking-wide text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-30 hover:opacity-90"
            >
              Continue
            </button>
            {contextReady && environments.length > 0 && sourceEnv && targetEnv && sourceEnv.id === targetEnv.id && (
              <span className="font-mono text-xs text-white/35">Choose two different environments.</span>
            )}
            {contextReady && environments.length > 0 && !pairReady && sourceEnv?.id !== targetEnv?.id && (
              <span className="font-mono text-xs text-white/35">Choose a source and a destination environment.</span>
            )}
          </div>
        </section>
      )}

      {step === "select" && (
        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Select content</h2>
              <p className="mt-1 max-w-2xl text-sm text-white/50">
                Browse the source environment&apos;s content tree, select the items to migrate, and choose each item&apos;s scope and merge strategy.
              </p>
              <p className="mt-2 text-sm text-white/60">
                Source <span className="text-accent">{envLabel(sourceEnv)}</span>
                <span className="mx-2 text-white/30">→</span>
                Destination <span className="text-amber">{envLabel(targetEnv)}</span>
              </p>
            </div>
            <label className="block">
              <span className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-white/40">Database</span>
              <input
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                className="w-28 rounded border border-line bg-ink px-2 py-1.5 font-mono text-xs text-white/90 focus:border-white/30"
              />
            </label>
          </div>

          <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-white/40">Sites in this environment</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {sites.length === 0 && (
              <span className="font-mono text-xs text-white/35">Sites appear here once the content tree loads.</span>
            )}
            {sites.map((site) => {
              const active = focusPath === site.path;
              return (
                <button
                  key={site.path}
                  type="button"
                  onClick={() => {
                    setFocusPath(site.path);
                    setFocusNonce((n) => n + 1);
                  }}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-white/70 hover:border-white/30 hover:text-white"
                  }`}
                >
                  {site.name}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-line bg-panel/40">
              <ContentTree
                key={`${sourceEnv?.id}|${database}`}
                loadChildren={loadChildren}
                isSelected={(path) => rows.some((r) => samePath(r.ItemPath, path))}
                isCovered={(path) => rows.some((r) => r.Scope === "ItemAndDescendants" && isUnder(r.ItemPath, path))}
                onToggle={toggleNode}
                onRootLoaded={setSites}
                focusPath={focusPath}
                focusNonce={focusNonce}
              />
            </div>
            <aside className="rounded-lg border border-line bg-panel/40 p-4">
              <h3 className="text-sm font-medium">Selected ({rows.length})</h3>
              <p className="mt-1 text-xs text-white/40">Configure each item&apos;s scope and merge strategy below.</p>
              <ul className="mt-3 space-y-2">
                {rows.length === 0 && <li className="text-sm text-white/35">Nothing selected yet.</li>}
                {rows.map((row) => (
                  <li key={row.id} className="truncate text-sm text-white/80" title={row.ItemPath}>
                    {itemName(row)}
                  </li>
                ))}
              </ul>
            </aside>
          </div>

          <div className="mt-6">
            {rows.length === 0 && (
              <p className="text-sm text-white/40">
                Check items in the tree. Each checked item is transferred with the scope and merge strategy you set here.
              </p>
            )}
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-1 items-center gap-3 border-b border-line py-3 md:grid-cols-[minmax(0,1fr)_220px_240px_36px]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{itemName(row)}</div>
                  <div className="truncate font-mono text-xs text-white/40">{row.ItemPath}</div>
                </div>
                <select
                  aria-label={`Scope for ${itemName(row)}`}
                  value={row.Scope}
                  onChange={(e) => updateRow(row.id, { Scope: e.target.value as Scope })}
                  className="rounded border border-line bg-ink px-2 py-2 font-mono text-xs text-white/80"
                >
                  {SCOPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-panel">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Merge strategy for ${itemName(row)}`}
                  value={row.MergeStrategy}
                  onChange={(e) => updateRow(row.id, { MergeStrategy: e.target.value as MergeStrategy })}
                  className="rounded border border-line bg-ink px-2 py-2 font-mono text-xs text-white/80"
                >
                  {MERGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-panel">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label={`Remove ${itemName(row)}`}
                  className="justify-self-center text-white/30 hover:text-rose"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              addManual();
            }}
          >
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/sitecore/content/Site/Home"
              aria-label="Add item by path"
              className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm text-white/90 placeholder:text-white/25 focus:border-white/30"
            />
            <button
              type="submit"
              disabled={!manualPath.trim().startsWith("/sitecore")}
              className="shrink-0 rounded border border-line px-3 py-2 font-mono text-xs uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              Add path
            </button>
          </form>

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setStep("connect")}
              className="rounded-md border border-line px-5 py-2.5 font-mono text-sm uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!selectionReady}
              onClick={() => setStep("review")}
              className="rounded-md bg-accent px-6 py-3 font-mono text-sm font-medium uppercase tracking-wide text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-30 hover:opacity-90"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "review" && (
        <section>
          <h2 className="text-lg font-medium">Review & transfer</h2>
          <p className="mt-1 text-sm text-white/50">
            Source <span className="text-accent">{envLabel(sourceEnv)}</span>
            <span className="mx-2 text-white/30">→</span>
            Destination <span className="text-amber">{envLabel(targetEnv)}</span>
          </p>
          <p className="mt-1 font-mono text-xs text-white/40">{database}</p>

          <div className="mt-5 overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-[minmax(0,1fr)_200px_220px] gap-3 border-b border-line bg-ink/60 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-white/40">
              <span>Item</span>
              <span>Scope</span>
              <span>Merge strategy</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_200px_220px] gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm">{itemName(row)}</div>
                  <div className="truncate font-mono text-xs text-white/40">{row.ItemPath}</div>
                </div>
                <div className="self-center text-sm text-white/70">
                  {SCOPE_OPTIONS.find((o) => o.value === row.Scope)?.label}
                </div>
                <div className="self-center text-sm text-white/70">
                  {MERGE_OPTIONS.find((o) => o.value === row.MergeStrategy)?.label ?? row.MergeStrategy}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-4">
            <button
              type="button"
              onClick={() => setStep("select")}
              className="rounded-md border border-line px-5 py-2.5 font-mono text-sm uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!canDispatch}
              onClick={dispatch}
              className="rounded-md bg-accent px-6 py-3 font-mono text-sm font-medium uppercase tracking-wide text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-30 hover:opacity-90"
            >
              {running ? "Transfer in progress…" : "Dispatch transfer"}
            </button>
          </div>

          <div className="mt-8">
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
          </div>
        </section>
      )}
    </div>
  );
}

function EnvSelect({
  label,
  accent,
  apps,
  app,
  environments,
  environmentId,
  onApp,
  onEnvironment,
}: {
  label: string;
  accent: string;
  apps: string[];
  app: string;
  environments: XmEnvironment[];
  environmentId: string;
  onApp: (app: string) => void;
  onEnvironment: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">{label}</h3>
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-white/40">App</span>
          <select
            value={app}
            onChange={(e) => onApp(e.target.value)}
            className="w-full rounded border border-line bg-ink px-3 py-2 text-sm text-white/90"
          >
            {apps.length === 0 && <option value="">No apps available</option>}
            {apps.map((name) => (
              <option key={name} value={name} className="bg-panel">
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-white/40">Environment</span>
          <select
            value={environmentId}
            onChange={(e) => onEnvironment(e.target.value)}
            className="w-full rounded border border-line bg-ink px-3 py-2 text-sm text-white/90"
          >
            {environments.length === 0 && <option value="">No environments</option>}
            {environments.map((env) => (
              <option key={env.id} value={env.id} className="bg-panel">
                {env.name}
              </option>
            ))}
          </select>
        </label>
      </div>
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
