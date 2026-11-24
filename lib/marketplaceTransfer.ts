import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type { DataTree, LogLine } from "./types";

const STATUS_POLL_INTERVAL_MS = 5000;
const STATUS_MAX_ATTEMPTS = 90;
const BLOB_POLL_INTERVAL_MS = 3000;
const BLOB_MAX_ATTEMPTS = 30;
const CALL_TIMEOUT_MS = 120000;

interface SdkResult<T> {
  data?: T;
  error?: unknown;
  response?: Response;
}

interface TransferStatus {
  State: string;
  ChunkSetsMetadata: { ChunkSetId: string; ChunkCount: number; TotalItemCount: number }[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function assertData<T>(result: SdkResult<T> | undefined, action: string): T {
  if (!result) throw new Error(`${action} failed.`);
  if (result.error) throw new Error(`${action} failed: ${describe(result.error)}`);
  if (result.data === undefined) throw new Error(`${action} returned no data.`);
  return result.data;
}

async function mutate<T>(
  client: ClientSDK,
  key: Parameters<ClientSDK["mutate"]>[0],
  params: unknown,
  action: string
): Promise<SdkResult<T>> {
  const result = (await client.mutate(key, {
    params: params as never,
    timeoutMs: CALL_TIMEOUT_MS,
  })) as SdkResult<T>;
  return result ?? { error: `${action} returned no response.` };
}

async function query<T>(
  client: ClientSDK,
  key: Parameters<ClientSDK["query"]>[0],
  params: unknown,
  action: string
): Promise<SdkResult<T>> {
  const wrapped = await client.query(key, {
    params: params as never,
    timeoutMs: CALL_TIMEOUT_MS,
  });
  if (wrapped.isError || wrapped.error) {
    throw new Error(`${action} failed: ${describe(wrapped.error)}`);
  }
  return (wrapped.data as SdkResult<T> | undefined) ?? { error: `${action} returned no response.` };
}

export async function runMarketplaceTransfer(
  client: ClientSDK,
  args: {
    sourceContextId: string;
    targetContextId: string;
    database: string;
    dataTrees: DataTree[];
  },
  onLog: (line: LogLine) => void
) {
  const info = (msg: string) => onLog({ msg, ts: Date.now(), level: "info" });
  const success = (msg: string) => onLog({ msg, ts: Date.now(), level: "success" });
  const warn = (msg: string) => onLog({ msg, ts: Date.now(), level: "warn" });
  const fail = (msg: string) => onLog({ msg, ts: Date.now(), level: "error" });

  const db = args.database || "master";

  try {
    info(`Consignment of ${args.dataTrees.length} item path(s) staged for departure (database: ${db}).`);
    const transferId = crypto.randomUUID();
    info(`Initiating content transfer (TransferId ${transferId})...`);

    const created = await mutate(
      client,
      "xmc.contentTransfer.createContentTransfer",
      {
        body: {
          transferId,
          configuration: {
            dataTrees: args.dataTrees.map((tree) => ({
              itemPath: tree.ItemPath,
              scope: tree.Scope,
              mergeStrategy: tree.MergeStrategy,
            })),
          },
        },
        query: { sitecoreContextId: args.sourceContextId },
      },
      "Creating the transfer"
    );
    if (created.error) throw new Error(`Creating the transfer failed: ${describe(created.error)}`);
    success("Source is packaging content.");

    info("Waiting for the source to finish packaging...");
    let status: TransferStatus | undefined;
    for (let attempt = 1; attempt <= STATUS_MAX_ATTEMPTS; attempt++) {
      await sleep(STATUS_POLL_INTERVAL_MS);
      try {
        const polled = await query<TransferStatus>(
          client,
          "xmc.contentTransfer.getContentTransferStatus",
          { path: { transferId }, query: { sitecoreContextId: args.sourceContextId } },
          "Checking transfer status"
        );
        status = assertData(polled, "Checking transfer status");
      } catch (e) {
        info(`Status not ready yet (attempt ${attempt}/${STATUS_MAX_ATTEMPTS}): ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      info(`Source state: ${status.State}`);
      if (status.State === "Completed") break;
      if (status.State === "Failed") throw new Error("Source reported the transfer packaging as Failed.");
    }
    if (!status || status.State !== "Completed") {
      throw new Error("Timed out waiting for the source environment to finish packaging content.");
    }

    for (const chunkSet of status.ChunkSetsMetadata ?? []) {
      info(
        `Chunk set ${chunkSet.ChunkSetId}: ${chunkSet.ChunkCount} chunk(s), ${chunkSet.TotalItemCount} item(s) total.`
      );
      for (let i = 0; i < chunkSet.ChunkCount; i++) {
        info(`  Downloading chunk ${i + 1}/${chunkSet.ChunkCount} from source...`);
        const downloaded = await query<Blob>(
          client,
          "xmc.contentTransfer.getChunk",
          {
            path: { transferId, chunksetId: chunkSet.ChunkSetId, chunkId: i },
            query: { sitecoreContextId: args.sourceContextId },
          },
          `Downloading chunk ${i + 1}`
        );
        const blob = assertData(downloaded, `Downloading chunk ${i + 1}`);
        const disposition = downloaded.response?.headers?.get("content-disposition") || "";
        const isMedia = /isMedia\s*=\s*true/i.test(disposition);
        info(`  Uploading chunk ${i + 1}/${chunkSet.ChunkCount} to the destination${isMedia ? " (media)" : ""}...`);
        const saved = await mutate(
          client,
          "xmc.contentTransfer.saveChunk",
          {
            body: blob,
            path: { transferId, chunksetId: chunkSet.ChunkSetId, chunkId: i },
            query: { sitecoreContextId: args.targetContextId, isMedia },
          },
          `Uploading chunk ${i + 1}`
        );
        if (saved.error) throw new Error(`Uploading chunk ${i + 1} failed: ${describe(saved.error)}`);
      }

      info("  Marking chunk set complete on the destination...");
      const completed = await mutate<{ ContentTransferFileName: string }>(
        client,
        "xmc.contentTransfer.completeChunkSetTransfer",
        {
          path: { transferId, chunksetId: chunkSet.ChunkSetId },
          query: { sitecoreContextId: args.targetContextId },
        },
        "Completing the chunk set"
      );
      const fileName = assertData(completed, "Completing the chunk set").ContentTransferFileName;
      success(`  Assembled on the destination as ${fileName}`);

      info("  Consuming the package into the destination content tree...");
      const consumed = await query(
        client,
        "xmc.contentTransfer.consumeFile",
        {
          query: {
            databaseName: db,
            fileName,
            sitecoreContextId: args.targetContextId,
          },
        },
        "Consuming the package"
      );
      if (consumed.error) throw new Error(`Consuming the package failed: ${describe(consumed.error)}`);
      success("  Consume accepted.");

      info("  Verifying the package landed...");
      let verified = false;
      for (let attempt = 1; attempt <= BLOB_MAX_ATTEMPTS; attempt++) {
        const blobState = await query<{ status?: string; details?: Record<string, unknown> }>(
          client,
          "xmc.contentTransfer.getBlobState",
          { query: { fileName, sitecoreContextId: args.targetContextId } },
          "Checking package status"
        );
        const state = assertData(blobState, "Checking package status");
        const statusName = state.status || "";
        if (/^(ok|transferred|completed)$/i.test(statusName)) {
          success(`  Package status: ${statusName}`);
          verified = true;
          break;
        }
        if (/error|failed/i.test(statusName)) {
          throw new Error(`Package status: ${statusName}`);
        }
        info(`  Package status: ${statusName || "pending"} (attempt ${attempt}/${BLOB_MAX_ATTEMPTS})...`);
        await sleep(BLOB_POLL_INTERVAL_MS);
      }
      if (!verified) {
        warn("  Could not confirm the package landed within the timeout — check the destination environment.");
      }
    }

    success("Transfer complete. All chunk sets consumed on the destination environment.");
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
