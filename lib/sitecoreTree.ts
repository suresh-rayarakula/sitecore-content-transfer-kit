import { SitecoreApiError, getAccessToken } from "./sitecoreTransfer";
import type { EnvConfig, TreeNode } from "./types";

/**
 * Reads one level of the source content tree from the Authoring and
 * Management GraphQL API:
 *   POST {host}/sitecore/api/authoring/graphql/v1/
 *
 * XM Cloud has shipped more than one shape for `item` / `children`
 * (Relay `nodes` + `hasNextPage`, and the older `hasNext` page info).
 * The first call tries each shape until one is accepted, then reuses it.
 */

const PAGE_SIZE = 100;
const TOKEN_TTL_MS = 4 * 60 * 1000;

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();

interface RawNode {
  itemId?: string;
  id?: string;
  name?: string;
  path?: string;
  hasChildren?: boolean;
  template?: { name?: string } | null;
}

interface PageInfo {
  hasNextPage?: boolean;
  hasNext?: boolean;
  endCursor?: string | null;
}

interface ItemPayload {
  itemId?: string;
  name?: string;
  path?: string;
  children?:
    | RawNode[]
    | {
        nodes?: RawNode[];
        results?: RawNode[];
        pageInfo?: PageInfo;
      };
}

interface GqlBody {
  data?: { item?: ItemPayload | null };
  errors?: { message?: string }[];
  raw?: string;
}

interface Variant {
  query: string;
}

const CHILD_FIELDS_FULL = `itemId name path hasChildren template { name }`;
const CHILD_FIELDS_MIN = `itemId name path`;

const VARIANTS: Variant[] = [
  {
    // XM Cloud's Authoring API types `children(first:)` as PaginationAmount, not Int.
    query: `query ItemChildren($database: String!, $path: String!, $first: PaginationAmount!, $after: String) {
      item(where: { database: $database, path: $path }) {
        itemId
        name
        path
        children(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${CHILD_FIELDS_FULL} }
        }
      }
    }`,
  },
  {
    query: `query ItemChildren($database: String!, $path: String!, $first: PaginationAmount!, $after: String) {
      item(where: { database: $database, path: $path }) {
        itemId
        name
        path
        children(first: $first, after: $after) {
          pageInfo { hasNext endCursor }
          nodes { ${CHILD_FIELDS_FULL} }
        }
      }
    }`,
  },
  {
    query: `query ItemChildren($database: String!, $path: String!, $first: Int!, $after: String) {
      item(where: { database: $database, path: $path }) {
        itemId
        name
        path
        children(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${CHILD_FIELDS_MIN} }
        }
      }
    }`,
  },
  {
    query: `query ItemChildren($database: String!, $path: String!) {
      item(where: { database: $database, path: $path }) {
        itemId
        name
        path
        children {
          nodes { ${CHILD_FIELDS_MIN} }
        }
      }
    }`,
  },
  {
    query: `query ItemChildren($path: String!, $language: String!, $first: Int!, $after: String) {
      item(path: $path, language: $language) {
        id
        name
        path
        children(first: $first, after: $after) {
          pageInfo { hasNext endCursor }
          results { id name path hasChildren }
        }
      }
    }`,
  },
];

let preferredVariant = 0;

export interface TreePage {
  children: TreeNode[];
  hasMore: boolean;
  cursor?: string;
}

async function cachedToken(env: EnvConfig): Promise<string> {
  const key = `${env.host}|${env.tokenUrl}|${env.clientId}|${env.audience ?? ""}|${env.clientSecret}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const token = await getAccessToken(env);
  tokenCache.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function isSchemaError(errors: { message?: string }[]): boolean {
  return errors.some((e) =>
    /Cannot query field|Unknown argument|is not defined|not defined|unknown field|contains a field not in|must not have a selection|not compatible with the type|Unknown type|Expected type/i.test(
      e.message || ""
    )
  );
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

function toNode(raw: RawNode, parentPath: string): TreeNode {
  const name = raw.name?.trim() || "item";
  const path = raw.path && raw.path.startsWith("/") ? raw.path : joinPath(parentPath, name);
  return {
    itemId: raw.itemId || raw.id || path,
    name,
    path,
    hasChildren: typeof raw.hasChildren === "boolean" ? raw.hasChildren : true,
    templateName: raw.template?.name || undefined,
  };
}

function readPage(item: ItemPayload, parentPath: string): TreePage {
  const children = item.children;
  if (!children) return { children: [], hasMore: false };
  if (Array.isArray(children)) {
    return { children: children.map((node) => toNode(node, parentPath)), hasMore: false };
  }
  const raw = children.nodes ?? children.results ?? [];
  const page = children.pageInfo ?? {};
  const hasNext = Boolean(page.hasNextPage ?? page.hasNext);
  const cursor = page.endCursor || undefined;
  return {
    children: raw.map((node) => toNode(node, parentPath)),
    hasMore: hasNext && Boolean(cursor),
    cursor: hasNext ? cursor : undefined,
  };
}

async function postQuery(
  env: EnvConfig,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<{ status: number; body: GqlBody }> {
  const res = await fetch(`${env.host}/sitecore/api/authoring/graphql/v1/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body: GqlBody;
  try {
    body = JSON.parse(text) as GqlBody;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
}

function errorMessage(status: number, body: GqlBody, fallback: string): string {
  const fromGql = body.errors?.map((e) => e.message).filter(Boolean).join("; ");
  const message = fromGql || body.raw || `${fallback} (HTTP ${status})`;
  if (/not authorized to access this resource/i.test(message)) {
    return "This automation client cannot read items on the source environment. In Sitecore Cloud Deploy, open Credentials, choose the Environment tab for this source environment, and create an Automation client there. Organization-level credentials can get a token, but the content tree only accepts an environment client. Use that client id and secret, then retry.";
  }
  return message;
}

/**
 * Lists the immediate children of `path` in the source environment.
 * `cursor` continues a previous page for the same parent.
 */
export async function listItemChildren(
  env: EnvConfig,
  database: string,
  path: string,
  language: string,
  cursor?: string
): Promise<TreePage> {
  const token = await cachedToken(env);
  const order = [preferredVariant, ...VARIANTS.map((_, i) => i).filter((i) => i !== preferredVariant)];
  let lastSchemaMessage = "The Authoring API rejected the content tree query.";

  for (const index of order) {
    const variant = VARIANTS[index];
    const usesPaging = variant.query.includes("$first");
    if (!usesPaging && cursor) continue;
    const variables: Record<string, unknown> = {};
    if (variant.query.includes("$database")) variables.database = database;
    if (variant.query.includes("$path")) variables.path = path;
    if (variant.query.includes("$language")) variables.language = language;
    if (usesPaging) {
      variables.first = PAGE_SIZE;
      variables.after = cursor ?? null;
    }

    const { status, body } = await postQuery(env, token, variant.query, variables);

    if (status === 401 || status === 403) {
      throw new SitecoreApiError(
        `Authoring API unauthorized (HTTP ${status}). The automation client needs authoring read access on the source environment. ${errorMessage(status, body, "")}`.trim(),
        status,
        body.raw || ""
      );
    }

    if (body.errors?.length && isSchemaError(body.errors)) {
      lastSchemaMessage = errorMessage(status, body, lastSchemaMessage);
      continue;
    }

    if (body.errors?.length || (status >= 400 && !body.data)) {
      throw new SitecoreApiError(
        errorMessage(status, body, "Loading content tree failed"),
        status,
        body.raw || ""
      );
    }

    if (!body.data?.item) {
      throw new SitecoreApiError(`No item found at ${path}.`, status || 404, "");
    }

    preferredVariant = index;
    return readPage(body.data.item, path);
  }

  throw new Error(lastSchemaMessage);
}
