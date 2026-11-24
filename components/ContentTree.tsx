"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CONTENT_ROOT } from "@/lib/authoringTree";
import type { TreeNode, TreeResponse } from "@/lib/types";

export { CONTENT_ROOT };

interface Slot {
  status: "loading" | "ready" | "error";
  children: TreeNode[];
  error?: string;
  hasMore: boolean;
  cursor?: string;
}

interface Props {
  loadChildren: (path: string, cursor?: string) => Promise<TreeResponse>;
  isSelected: (path: string) => boolean;
  isCovered: (path: string) => boolean;
  onToggle: (node: { name: string; path: string }) => void;
  onRootLoaded: (nodes: TreeNode[]) => void;
  focusPath?: string;
  focusNonce: number;
}

interface TreeCtx {
  expanded: Record<string, boolean>;
  slots: Record<string, Slot>;
  focusPath?: string;
  toggleExpand: (node: TreeNode) => void;
  loadMore: (path: string, cursor: string) => void;
  retry: (path: string) => void;
  isSelected: (path: string) => boolean;
  isCovered: (path: string) => boolean;
  onToggle: (node: { name: string; path: string }) => void;
}

const Ctx = createContext<TreeCtx | null>(null);

function nodeDomId(path: string) {
  return `tree-node-${encodeURIComponent(path)}`;
}

export default function ContentTree({
  loadChildren,
  isSelected,
  isCovered,
  onToggle,
  onRootLoaded,
  focusPath,
  focusNonce,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const fetched = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const onRootLoadedRef = useRef(onRootLoaded);
  onRootLoadedRef.current = onRootLoaded;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchChildren = useCallback(
    async (path: string, cursor?: string) => {
      const stamp = cursor ? `${path}@@${cursor}` : path;
      if (fetched.current.has(stamp)) return;
      fetched.current.add(stamp);

      setSlots((prev) => ({
        ...prev,
        [path]: {
          status: "loading",
          children: cursor ? prev[path]?.children ?? [] : [],
          hasMore: prev[path]?.hasMore ?? false,
          cursor: prev[path]?.cursor,
        },
      }));

      try {
        const json = await loadChildren(path, cursor);
        if (!mounted.current) return;
        let merged: TreeNode[] = json.children;
        setSlots((prev) => {
          merged = cursor ? [...(prev[path]?.children ?? []), ...json.children] : json.children;
          return {
            ...prev,
            [path]: {
              status: "ready",
              children: merged,
              hasMore: json.hasMore,
              cursor: json.cursor,
            },
          };
        });
        if (path === CONTENT_ROOT) onRootLoadedRef.current(merged);
      } catch (e) {
        fetched.current.delete(stamp);
        if (!mounted.current) return;
        const message = e instanceof Error ? e.message : String(e);
        setSlots((prev) => ({
          ...prev,
          [path]: {
            status: "error",
            children: prev[path]?.children ?? [],
            error: message,
            hasMore: false,
          },
        }));
        if (!cursor && path === CONTENT_ROOT) onRootLoadedRef.current([]);
      }
    },
    [loadChildren]
  );

  useEffect(() => {
    fetched.current = new Set();
    setSlots({});
    setExpanded({});
    void fetchChildren(CONTENT_ROOT);
  }, [fetchChildren]);

  useEffect(() => {
    if (!focusPath) return;
    setExpanded((prev) => ({ ...prev, [focusPath]: true }));
    void fetchChildren(focusPath);
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(nodeDomId(focusPath));
      tries += 1;
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        window.clearInterval(timer);
      } else if (tries > 25) {
        window.clearInterval(timer);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [fetchChildren, focusNonce, focusPath]);

  const toggleExpand = (node: TreeNode) => {
    setExpanded((prev) => {
      const open = !prev[node.path];
      if (open) void fetchChildren(node.path);
      return { ...prev, [node.path]: open };
    });
  };

  const root = slots[CONTENT_ROOT];

  return (
    <Ctx.Provider
      value={{
        expanded,
        slots,
        focusPath,
        toggleExpand,
        loadMore: (path, cursor) => void fetchChildren(path, cursor),
        retry: (path) => {
          fetched.current.delete(path);
          void fetchChildren(path);
        },
        isSelected,
        isCovered,
        onToggle,
      }}
    >
      <div role="tree" aria-label="Source content tree" className="py-1">
        {!root && <Status>Loading content tree…</Status>}
        {root?.status === "loading" && root.children.length === 0 && <Status>Loading content tree…</Status>}
        {root?.status === "error" && (
          <div className="px-3 py-2 font-mono text-xs text-rose">
            <p>{root.error}</p>
            <button type="button" onClick={() => {
              fetched.current.delete(CONTENT_ROOT);
              void fetchChildren(CONTENT_ROOT);
            }} className="mt-2 underline">
              Retry
            </button>
          </div>
        )}
        {root?.status === "ready" && root.children.length === 0 && (
          <Status>No items under /sitecore/content.</Status>
        )}
        {root?.children.map((node) => (
          <Branch key={node.itemId} node={node} depth={0} />
        ))}
        {root?.hasMore && root.cursor && (
          <LoadMore depth={0} onClick={() => void fetchChildren(CONTENT_ROOT, root.cursor)} />
        )}
      </div>
    </Ctx.Provider>
  );
}

function Branch({ node, depth }: { node: TreeNode; depth: number }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const open = Boolean(ctx.expanded[node.path]);
  const slot = ctx.slots[node.path];
  const covered = ctx.isCovered(node.path);
  const checked = covered || ctx.isSelected(node.path);
  const focused = ctx.focusPath === node.path;

  return (
    <div role="treeitem" aria-expanded={node.hasChildren ? open : undefined} aria-selected={checked}>
      <div
        id={nodeDomId(node.path)}
        className={`flex items-center gap-1.5 py-1 pr-3 ${focused ? "bg-accent/10" : "hover:bg-white/[0.03]"}`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {node.hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => ctx.toggleExpand(node)}
            className="flex h-5 w-5 shrink-0 items-center justify-center font-mono text-xs text-white/45 hover:text-white/80"
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <input
          type="checkbox"
          className="h-3.5 w-3.5 shrink-0 accent-accent"
          checked={checked}
          disabled={covered}
          title={covered ? "Included with a parent item" : undefined}
          aria-label={`Select ${node.name}`}
          onChange={() => ctx.onToggle({ name: node.name, path: node.path })}
        />
        <button
          type="button"
          disabled={covered}
          onClick={() => ctx.onToggle({ name: node.name, path: node.path })}
          className="min-w-0 truncate text-left text-sm text-white/90 disabled:text-white/50"
        >
          {node.name}
        </button>
      </div>
      {open && slot?.status === "loading" && slot.children.length === 0 && (
        <Status depth={depth + 1}>Loading…</Status>
      )}
      {open && slot?.status === "error" && (
        <div className="py-1 font-mono text-[11px] text-rose" style={{ paddingLeft: 28 + (depth + 1) * 16 }}>
          {slot.error}{" "}
          <button type="button" className="underline" onClick={() => ctx.retry(node.path)}>
            Retry
          </button>
        </div>
      )}
      {open && slot?.status === "ready" && slot.children.length === 0 && (
        <Status depth={depth + 1}>No subitems</Status>
      )}
      {open &&
        slot?.children.map((child) => <Branch key={child.itemId} node={child} depth={depth + 1} />)}
      {open && slot?.hasMore && slot.cursor && (
        <LoadMore depth={depth + 1} onClick={() => ctx.loadMore(node.path, slot.cursor!)} />
      )}
    </div>
  );
}

function Status({ children, depth = 0 }: { children: ReactNode; depth?: number }) {
  return (
    <p className="py-1 font-mono text-[11px] text-white/35" style={{ paddingLeft: 28 + depth * 16 }}>
      {children}
    </p>
  );
}

function LoadMore({ depth, onClick }: { depth: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="py-1 font-mono text-[11px] uppercase tracking-wide text-accent/80 hover:text-accent"
      style={{ paddingLeft: 28 + depth * 16 }}
    >
      Load more
    </button>
  );
}
