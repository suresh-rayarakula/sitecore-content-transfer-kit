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
  /** OAuth 2.0 client_credentials token endpoint for this environment's API client */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Optional audience/resource parameter, if your identity provider requires one */
  audience?: string;
}

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
  BlobState: "Transferred" | string;
  Error: string | null;
  SourceName: string;
  Name: string;
}

export interface LogLine {
  msg: string;
  ts: number;
  level?: "info" | "success" | "error" | "warn";
}
