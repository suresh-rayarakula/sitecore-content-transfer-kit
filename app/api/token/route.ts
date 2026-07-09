import { NextRequest } from "next/server";
import { getAccessToken } from "@/lib/sitecoreTransfer";
import type { EnvConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const env = (await req.json()) as EnvConfig;
  try {
    await getAccessToken(env);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
