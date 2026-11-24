import type { TreeNode, TreeResponse } from "./types";

export const CONTENT_ROOT = "/sitecore/content";

const CHILDREN_QUERY = `query ItemChildren($database: String!, $path: String!, $first: PaginationAmount!, $after: String) {
  item(where: { database: $database, path: $path }) {
    itemId
    name
    path
    children(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        itemId
        name
        path
        hasChildren
        template { name }
      }
    }
  }
}`;

interface RawNode {
  itemId?: string;
  name?: string;
  path?: string;
  hasChildren?: boolean;
  template?: { name?: string } | null;
}

interface AuthoringPayload {
  data?: {
    item?: {
      children?: {
        nodes?: RawNode[];
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    } | null;
  };
  errors?: { message?: string }[];
}

export function childrenQuery(database: string, path: string, cursor?: string) {
  return {
    query: CHILDREN_QUERY,
    variables: {
      database,
      path,
      first: 100,
      after: cursor ?? null,
    },
  };
}

export function parseAuthoringChildren(payload: AuthoringPayload, parentPath: string): TreeResponse {
  const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
  if (message) throw new Error(message);
  const item = payload.data?.item;
  if (!item) throw new Error(`No item found at ${parentPath}.`);
  const connection = item.children;
  const nodes = connection?.nodes ?? [];
  const hasNext = Boolean(connection?.pageInfo?.hasNextPage);
  const cursor = connection?.pageInfo?.endCursor || undefined;
  return {
    children: nodes.map((node) => toNode(node, parentPath)),
    hasMore: hasNext && Boolean(cursor),
    cursor: hasNext ? cursor : undefined,
  };
}

function toNode(raw: RawNode, parentPath: string): TreeNode {
  const name = raw.name?.trim() || "item";
  const path = raw.path && raw.path.startsWith("/") ? raw.path : `${parentPath.replace(/\/+$/, "")}/${name}`;
  return {
    itemId: raw.itemId || path,
    name,
    path,
    hasChildren: typeof raw.hasChildren === "boolean" ? raw.hasChildren : true,
    templateName: raw.template?.name || undefined,
  };
}
