"use client";

import { useState } from "react";
import type { EnvConfig } from "@/lib/types";

interface Props {
  label: string;
  accent: string;
  value: EnvConfig;
  onChange: (value: EnvConfig) => void;
}

export default function EnvPanel({ label, accent, value, onChange }: Props) {
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState("");

  const set = (patch: Partial<EnvConfig>) => onChange({ ...value, ...patch });

  const runTest = async () => {
    setTestState("testing");
    setTestMessage("");
    try {
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const json = await res.json();
      if (json.ok) {
        setTestState("ok");
      } else {
        setTestState("fail");
        setTestMessage(json.error || "Authentication failed.");
      }
    } catch (e) {
      setTestState("fail");
      setTestMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rounded-lg border border-line bg-panel/60 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">{label}</h3>
        </div>
        <button
          type="button"
          onClick={runTest}
          className="rounded border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-white/60 hover:border-white/30 hover:text-white/90 transition-colors"
        >
          {testState === "testing" ? "Testing…" : "Test auth"}
        </button>
      </div>

      <div className="space-y-3">
        <Field label="Environment host">
          <input
            type="text"
            placeholder="https://xmc-org-tenant-env.sitecorecloud.io"
            value={value.host}
            onChange={(e) => set({ host: e.target.value.replace(/\/+$/, "") })}
            className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm text-white/90 placeholder:text-white/25 focus:border-white/30"
          />
        </Field>

        <Field label="OAuth token URL">
          <input
            type="text"
            placeholder="https://identity.sitecorecloud.io/oauth/token"
            value={value.tokenUrl}
            onChange={(e) => set({ tokenUrl: e.target.value })}
            className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm text-white/90 placeholder:text-white/25 focus:border-white/30"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Client ID">
            <input
              type="text"
              value={value.clientId}
              onChange={(e) => set({ clientId: e.target.value })}
              className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm text-white/90 focus:border-white/30"
            />
          </Field>
          <Field label="Client secret">
            <input
              type="password"
              value={value.clientSecret}
              onChange={(e) => set({ clientSecret: e.target.value })}
              className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm text-white/90 focus:border-white/30"
            />
          </Field>
        </div>

        <Field label="Audience">
          <input
            type="text"
            placeholder="https://api.sitecorecloud.io"
            value={value.audience || ""}
            onChange={(e) => set({ audience: e.target.value })}
            className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm text-white/90 placeholder:text-white/25 focus:border-white/30"
          />
        </Field>
      </div>

      {testState === "ok" && (
        <p className="mt-3 font-mono text-xs text-accent">✓ Credentials verified — token issued.</p>
      )}
      {testState === "fail" && (
        <p className="mt-3 font-mono text-xs text-rose">✕ {testMessage}</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-white/40">
        {label}
      </span>
      {children}
    </label>
  );
}
