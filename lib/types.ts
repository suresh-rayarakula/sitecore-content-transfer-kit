export type Scope = "SingleItem" | "ItemAndDescendants";

export type MergeStrategy =
  | "OverrideExistingItem"
  | "KeepExistingItem"
  | "LatestWin"
  | "OverrideExistingTree";

export interface DataTree {
  ItemPath: string;
  Scope: Scope;
  MergeStrategy: MergeStrategy;
}

/** Connection details for one Sitecore environment (source or target). */
export interface EnvConfig {
  /** Environment host, e.g. https://xmc-org-tenant-envname.sitecorecloud.io (no trailing slash) */
  host: string;
  /**
   * OAuth 2.0 client_credentials token endpoint.
   * Defaults to https://auth.sitecorecloud.io/oauth/token when omitted.
   */
  tokenUrl?: string;
  clientId: string;
  clientSecret: string;
  /**
   * Audience/resource parameter for Sitecore Cloud OAuth.
   * Defaults to https://api.sitecorecloud.io when omitted.
   */
  audience?: string;
}

/** Shared Sitecore Cloud OAuth defaults (same for every environment). */
export const SITECORE_TOKEN_URL = "https://auth.sitecorecloud.io/oauth/token";
export const SITECORE_AUDIENCE = "https://api.sitecorecloud.io";

export interface TransferRequestBody {
  source: EnvConfig;
  target: EnvConfig;
  dataTrees: DataTree[];
  database: string;
}

export interface ChunkSetMetadata {
  ChunkSetId: string;
  ChunkCount: number;
  TotalItemCount: number;
}

export interface TransferStatusResponse {
  State: "InProgress" | "Completed" | "Failed" | string;
  ChunkSetsMetadata: ChunkSetMetadata[];
}

export interface BlobStatusResponse {
  BlobState: "Transferred" | "TransferredWithErrors" | string;
  Error: string | null;
  SourceName: string;
  Name: string;
}

/** Item-level validation failure returned by the Item Transfer API. */
export interface TransferValidationError {
  Message?: string;
  message?: string;
  Error?: string;
  error?: string;
  ItemPath?: string;
  itemPath?: string;
  ItemId?: string;
  itemId?: string;
  Path?: string;
  Details?: string;
  [key: string]: unknown;
}

/** Transfer record returned by GET /ItemsTransfer/transfers/{sourceName}. */
export interface TransferDetailsResponse {
  TransferState?: string;
  State?: string;
  Status?: string;
  Error?: string | null;
  Message?: string | null;
  ValidationErrors?: TransferValidationError[] | string[] | null;
  Errors?: TransferValidationError[] | string[] | null;
  FailedItems?: TransferValidationError[] | string[] | null;
  SourceName?: string;
  Name?: string;
  [key: string]: unknown;
}

export interface LogLine {
  msg: string;
  ts: number;
  level?: "info" | "success" | "error" | "warn";
}
