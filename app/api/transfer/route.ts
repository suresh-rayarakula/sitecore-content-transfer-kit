import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import * as sc from "@/lib/sitecoreTransfer";
import type { LogLine, TransferRequestBody, TransferStatusResponse } from "@/lib/types";

// This route makes many sequential, sometimes slow (chunked/polling) calls
// to Sitecore, so it needs the Node.js runtime (not Edge) and a generous
// duration ceiling. maxDuration beyond 60s requires a Vercel Pro plan or
// higher — see README for what to do on Hobby / other hosts.
export const runtime = "nodejs";
export const maxDuration = 300;

const STATUS_POLL_INTERVAL_MS = 5000;
const STATUS_MAX_ATTEMPTS = 90; // ~7.5 minutes
const BLOB_POLL_INTERVAL_MS = 3000;
const BLOB_MAX_ATTEMPTS = 30; // ~1.5 minutes

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as TransferRequestBody;
  const { source, target, dataTrees, database } = payload;

  if (!source?.host || !target?.host) {
    return new Response(JSON.stringify({ error: "Source and target environments are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!dataTrees?.length) {
    return new Response(JSON.stringify({ error: "At least one item path is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const write = (line: LogLine) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      const info = (msg: string) => write({ msg, ts: Date.now(), level: "info" });
      const success = (msg: string) => write({ msg, ts: Date.now(), level: "success" });
      const warn = (msg: string) => write({ msg, ts: Date.now(), level: "warn" });
      const fail = (msg: string) => write({ msg, ts: Date.now(), level: "error" });

      const db = database || "master";

      try {
        info(
          `Consignment of ${dataTrees.length} item path(s) staged for departure (database: ${db}).`
        );

        info("Authenticating with source environment...");
        const sourceToken = await sc.getAccessToken(source);
        success("Source authentication OK.");

        const transferId = randomUUID();
        info(`Initiating Content Transfer (TransferId ${transferId})...`);
        await sc.initiateTransfer(source, sourceToken, transferId, dataTrees, db);
        success("Source is packaging content.");

        info("Waiting for source to finish packaging (this can take a few minutes for large trees)...");
        let status: TransferStatusResponse | undefined;
        for (let attempt = 1; attempt <= STATUS_MAX_ATTEMPTS; attempt++) {
          await sleep(STATUS_POLL_INTERVAL_MS);
          try {
            status = await sc.getTransferStatus(source, sourceToken, transferId);
          } catch (e) {
            // The status endpoint can 404 for a short window right after
            // initiating (known behavior at time of writing) — keep polling.
            info(`Status not ready yet (attempt ${attempt}/${STATUS_MAX_ATTEMPTS}), retrying...`);
            continue;
          }
          info(`Source state: ${status.State}`);
          if (status.State === "Completed") break;
          if (status.State === "Failed") throw new Error("Source reported the transfer packaging as Failed.");
        }
        if (!status || status.State !== "Completed") {
          throw new Error("Timed out waiting for the source environment to finish packaging content.");
        }

        info("Authenticating with target environment...");
        const targetToken = await sc.getAccessToken(target);
        success("Target authentication OK.");

        for (const chunkSet of status.ChunkSetsMetadata) {
          info(
            `Chunk set ${chunkSet.ChunkSetId}: ${chunkSet.ChunkCount} chunk(s), ${chunkSet.TotalItemCount} item(s) total.`
          );

          for (let i = 0; i < chunkSet.ChunkCount; i++) {
            info(`  Downloading chunk ${i + 1}/${chunkSet.ChunkCount} from source...`);
            const { buffer, isMedia } = await sc.downloadChunk(
              source,
              sourceToken,
              transferId,
              chunkSet.ChunkSetId,
              i
            );
            info(
              `  Uploading chunk ${i + 1}/${chunkSet.ChunkCount} to target (${
                isMedia ? "media, compressed" : "content, encrypted"
              }, ${buffer.length.toLocaleString()} bytes)...`
            );
            await sc.uploadChunk(target, targetToken, transferId, chunkSet.ChunkSetId, i, buffer, isMedia);
          }

          info("  Marking chunk set complete on target...");
          const blobName = await sc.completeChunkSet(target, targetToken, transferId, chunkSet.ChunkSetId);
          success(`  Assembled on target as ${blobName}`);

          info("  Consuming transfer package into target content tree...");
          const location = await sc.consumeTransfer(target, targetToken, db, blobName);
          success(`  Consume accepted.${location ? ` Location: ${location}` : ""}`);

          info("  Verifying blob transfer status...");
          let verified = false;
          for (let attempt = 1; attempt <= BLOB_MAX_ATTEMPTS; attempt++) {
            const blob = await sc.verifyBlob(target, targetToken, blobName);
            if (blob.BlobState === "Transferred") {
              success(`  BlobState: Transferred (source: ${blob.SourceName})`);
              verified = true;
              break;
            }
            if (blob.Error) {
              throw new Error(`Blob transfer reported an error: ${blob.Error}`);
            }
            info(`  BlobState: ${blob.BlobState} (attempt ${attempt}/${BLOB_MAX_ATTEMPTS})...`);
            await sleep(BLOB_POLL_INTERVAL_MS);
          }
          if (!verified) {
            warn("  Could not confirm 'Transferred' state within the timeout window — check the target environment manually.");
          }
        }

        success("Transfer complete. All chunk sets consumed on the target environment.");
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
