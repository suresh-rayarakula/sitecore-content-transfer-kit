import type {
  BlobStatusResponse,
  DataTree,
  EnvConfig,
  TransferDetailsResponse,
  TransferStatusResponse,
  TransferValidationError,
} from "./types";
import { SITECORE_AUDIENCE, SITECORE_TOKEN_URL } from "./types";

/**
 * Thin, explicit wrapper around the two APIs that replaced the retired
 * Sitecore Package Designer/Installer:
 *
 *  - Content Transfer API  (base: /sitecore/api/content/transfer/v1/...)
 *    packages up content on the SOURCE environment into chunks.
 *
 *  - Item Transfer API     (base: /sitecore/shell/api/v3/ItemsTransfer/...)
 *    consumes the packaged chunks into the TARGET environment.
 *
 * Every function here is a direct, unopinionated mapping to one HTTP call
 * so that the orchestration logic (in app/api/transfer/route.ts) stays easy
 * to read and reason about.
 */

export class SitecoreApiError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
    this.name = "SitecoreApiError";
  }
}

async function assertOk(res: Response, action: string) {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = extractErrorDetail(body);
    throw new SitecoreApiError(
      `${action} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      res.status,
      body
    );
  }
}

/** Pulls a human-readable reason out of a JSON error body, if there is one. */
function extractErrorDetail(body: string): string {
  if (!body) return "";
  try {
    const json = JSON.parse(body) as { 
      error?: string; 
      error_description?: string; 
      message?: string;
      Message?: string;
      detail?: string;
      title?: string;
    };
    return (
      json.error_description || 
      json.message || 
      json.Message ||
      json.detail ||
      json.title ||
      json.error || 
      body.slice(0, 500)
    );
  } catch {
    return body.slice(0, 500);
  }
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

/** Obtains a bearer token via OAuth 2.0 client_credentials for one environment. */
export async function getAccessToken(env: EnvConfig): Promise<string> {
  const tokenUrl = env.tokenUrl || SITECORE_TOKEN_URL;
  const audience = env.audience || SITECORE_AUDIENCE;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.clientId,
    client_secret: env.clientSecret,
    audience,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  await assertOk(res, "Requesting access token");
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Token endpoint responded 200 but no access_token was present.");
  }
  return json.access_token;
}

/** Step 1 (source): kick off packaging of the requested content into chunks. */
export async function initiateTransfer(
  env: EnvConfig,
  token: string,
  transferId: string,
  dataTrees: DataTree[],
  database: string
): Promise<void> {
  const url = `${env.host}/sitecore/api/content/transfer/v1/transfers`;
  const body = JSON.stringify({
    TransferId: transferId,
    Configuration: { DataTrees: dataTrees, Database: database },
  });
  console.log(`[initiateTransfer] URL: ${url}`);
  console.log(`[initiateTransfer] TransferId: ${transferId}`);
  console.log(`[initiateTransfer] Database: ${database}`);
  
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body,
  });
  
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    console.log(`[initiateTransfer] HTTP ${res.status} response: ${errorBody}`);
  }
  
  await assertOk(res, "Initiating transfer");
}

/** Step 2 (source): poll until the source has finished packaging. */
export async function getTransferStatus(
  env: EnvConfig,
  token: string,
  transferId: string
): Promise<TransferStatusResponse> {
  const url = `${env.host}/sitecore/api/content/transfer/v1/transfers/${transferId}/status`;
  const res = await fetch(url, { headers: authHeaders(token) });
  await assertOk(res, "Checking transfer status");
  return res.json();
}

/** Step 3 (source): download one chunk's raw bytes, plus its isMedia flag. */
export async function downloadChunk(
  env: EnvConfig,
  token: string,
  transferId: string,
  chunkSetId: string,
  chunkIndex: number
): Promise<{ buffer: Buffer; isMedia: boolean }> {
  const url = `${env.host}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunkSetId}/chunks/${chunkIndex}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  await assertOk(res, `Downloading chunk ${chunkIndex}`);

  const disposition = res.headers.get("content-disposition") || "";
  const isMedia = /isMedia\s*=\s*true/i.test(disposition);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, isMedia };
}

/** Step 4 (target): upload one chunk's raw bytes. */
export async function uploadChunk(
  env: EnvConfig,
  token: string,
  transferId: string,
  chunkSetId: string,
  chunkIndex: number,
  buffer: Buffer,
  isMedia: boolean
): Promise<void> {
  const url = `${env.host}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunkSetId}/chunks/${chunkIndex}?isMedia=${isMedia}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: authHeaders(token, { "Content-Type": "application/octet-stream" }),
    // @ts-expect-error - Buffer is a valid BodyInit on the Node.js runtime
    body: buffer,
  });
  await assertOk(res, `Uploading chunk ${chunkIndex}`);
}

/** Step 5 (target): tell the target every chunk in the set has arrived. Returns the assembled .raif filename. */
export async function completeChunkSet(
  env: EnvConfig,
  token: string,
  transferId: string,
  chunkSetId: string
): Promise<string> {
  const url = `${env.host}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunkSetId}/complete`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(token) });
  await assertOk(res, "Completing chunk set");
  const json = (await res.json()) as { ContentTransferFileName: string };
  return json.ContentTransferFileName;
}

/** Step 6 (target): consume the assembled .raif file into the content tree. Returns the Location header, if any. */
export async function consumeTransfer(
  env: EnvConfig,
  token: string,
  database: string,
  blobName: string
): Promise<string | null> {
  const url = `${env.host}/sitecore/shell/api/v3/ItemsTransfer/transfers/databases/${encodeURIComponent(
    database
  )}/sources?blobName=${encodeURIComponent(blobName)}`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(token) });
  await assertOk(res, "Consuming transfer package");
  return res.headers.get("location");
}

/** Step 7 (target): confirm the consumed blob actually landed. */
export async function verifyBlob(
  env: EnvConfig,
  token: string,
  blobName: string
): Promise<BlobStatusResponse> {
  const url = `${env.host}/sitecore/shell/api/v3/ItemsTransfer/sources/blobs/${encodeURIComponent(
    blobName
  )}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  await assertOk(res, "Verifying blob status");
  return res.json();
}

/**
 * Step 8 (target): load the transfer record for a consumed source.
 * When BlobState is TransferredWithErrors, ValidationErrors here explains why.
 */
export async function getTransferDetails(
  env: EnvConfig,
  token: string,
  sourceName: string
): Promise<TransferDetailsResponse> {
  const url = `${env.host}/sitecore/shell/api/v3/ItemsTransfer/transfers/${encodeURIComponent(
    sourceName
  )}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  await assertOk(res, "Fetching transfer details");
  return res.json();
}

/** Terminal blob states that mean the consume finished (successfully or not). */
export const TERMINAL_BLOB_FAILURE_STATES = new Set([
  "TransferredWithErrors",
  "Failed",
  "Error",
  "Cancelled",
  "Canceled",
]);

/** Formats ValidationErrors / Errors from a transfer details payload into log lines. */
export function formatTransferFailureDetails(
  blob: BlobStatusResponse,
  details: TransferDetailsResponse | null
): string[] {
  const lines: string[] = [];
  lines.push(`BlobState: ${blob.BlobState}`);
  if (blob.SourceName) lines.push(`Source: ${blob.SourceName}`);
  if (blob.Error) lines.push(`Blob error: ${blob.Error}`);

  if (details) {
    const transferState = details.TransferState || details.State || details.Status;
    if (transferState) lines.push(`TransferState: ${transferState}`);
    if (details.Error) lines.push(`Transfer error: ${details.Error}`);
    if (details.Message) lines.push(`Transfer message: ${details.Message}`);

    const rawErrors =
      details.ValidationErrors || details.Errors || details.FailedItems || [];
    const formatted = formatValidationErrors(rawErrors);
    if (formatted.length) {
      lines.push(`Validation errors (${formatted.length}):`);
      for (const err of formatted.slice(0, 25)) {
        lines.push(`  - ${err}`);
      }
      if (formatted.length > 25) {
        lines.push(`  … and ${formatted.length - 25} more`);
      }
    }
  }

  const hasValidationDetail = lines.some(
    (l) =>
      l.startsWith("Validation errors") ||
      l.startsWith("Blob error:") ||
      l.startsWith("Transfer error:")
  );
  if (blob.BlobState === "TransferredWithErrors" && !hasValidationDetail) {
    lines.push(
      "Hint: TransferredWithErrors usually means the path already exists on the target with a different item ID or template (e.g. System/Node vs Media folder), or a parent item is missing."
    );
  }

  return lines;
}

function formatValidationErrors(
  errors: TransferValidationError[] | string[] | null | undefined
): string[] {
  if (!errors?.length) return [];
  return errors.map((err) => {
    if (typeof err === "string") return err;
    const path = err.ItemPath || err.itemPath || err.Path || "";
    const id = err.ItemId || err.itemId || "";
    const msg =
      err.Message || err.message || err.Error || err.error || err.Details || JSON.stringify(err);
    const parts = [path && `path ${path}`, id && `id ${id}`, msg].filter(Boolean);
    return parts.join(" — ");
  });
}
