import { NextRequest } from "next/server";
import { listItemChildren } from "@/lib/sitecoreTree";
import type { EnvConfig } from "@/lib/types";

export const runtime = "nodejs";

interface TreeRequestBody {
  env?: EnvConfig;
  database?: string;
  path?: string;
  language?: string;
  cursor?: string;
}

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as TreeRequestBody;
  const env = payload.env;
  const database = (payload.database || "master").trim();
  const path = (payload.path || "").trim();
  const language = (payload.language || "en").trim() || "en";
  const cursor = payload.cursor?.trim() || undefined;

  if (!env?.host || !env.tokenUrl || !env.clientId || !env.clientSecret) {
    return Response.json(
      { error: "Source environment host and OAuth credentials are required to browse the content tree." },
      { status: 400 }
    );
  }
  if (!path.startsWith("/sitecore") || path.includes("..")) {
    return Response.json({ error: "Path must be a Sitecore item path." }, { status: 400 });
  }

  try {
    const page = await listItemChildren(env, database, path, language, cursor);
    return Response.json(page);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const error =
      message === "fetch failed"
        ? "Could not reach the source environment. Check the environment host and token URL."
        : message;
    return Response.json({ error }, { status: 400 });
  }
}
