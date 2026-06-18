import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact, JsonObject, RequestRecord, RunEvent, RunSummary } from "./types.js";
import { redact } from "./redaction.js";

const csvFields = [
  "endpoint_type",
  "model",
  "stage",
  "concurrency",
  "embedding_batch_size",
  "rerank_document_count",
  "completed_requests",
  "failed_requests",
  "rps",
  "vectors_per_second",
  "embedding_dimension",
  "documents_per_second",
  "rerank_top_hit",
  "context_target_tokens",
  "context_marker_found",
  "input_tokens_per_second",
  "output_tokens_per_second",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "ttft_p95",
  "e2e_p95",
  "error_rate"
];

export function ensureRunDir(runId: string): string {
  const runDir = join("runs", runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

export function writeArtifacts(
  runDir: string,
  summary: RunSummary,
  records: RequestRecord[],
  events: RunEvent[]
): Artifact[] {
  const safeSummary = redact(summary);
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(safeSummary, null, 2), "utf8");
  writeFileSync(
    join(runDir, "requests.jsonl"),
    records.map((record) => JSON.stringify(redact(record))).join("\n") + (records.length ? "\n" : ""),
    "utf8"
  );
  const rows = summaryRows(safeSummary);
  writeFileSync(join(runDir, "summary.csv"), rowsToCsv(rows), "utf8");
  void events;
  return listArtifacts(runDir);
}

export function listArtifacts(runDir: string): Artifact[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .sort()
    .filter((name) => {
      const path = join(runDir, name);
      return statSync(path).isFile() && !name.endsWith(".prom") && name !== "report.html";
    })
    .map((name) => ({
      name,
      path: join(runDir, name),
      url: `/api/artifacts/${runDir.split("/").pop()}/${name}`
    }));
}

export function artifactStream(path: string) {
  return createReadStream(path);
}

export function summaryRows(summary: RunSummary): JsonObject[] {
  return (summary.stages || []).map((stage) => {
    const metrics = stage.metrics || {};
    return {
      endpoint_type: stage.endpoint_type || metrics.endpoint_type || "",
      model: stage.model || "",
      stage: stage.stage || "",
      concurrency: stage.concurrency || "",
      embedding_batch_size: metrics.embedding_batch_size,
      rerank_document_count: metrics.rerank_document_count,
      completed_requests: metrics.completed_requests || 0,
      failed_requests: metrics.failed_requests || 0,
      rps: round(metrics.rps),
      vectors_per_second: round(metrics.vectors_per_second),
      embedding_dimension: metrics.embedding_dimension,
      documents_per_second: round(metrics.documents_per_second),
      rerank_top_hit: round(metrics.rerank_top_hit),
      context_target_tokens: metrics.context_target_tokens,
      context_marker_found: metrics.context_marker_found,
      input_tokens_per_second: round(metrics.input_tokens_per_second),
      output_tokens_per_second: round(metrics.output_tokens_per_second),
      prompt_tokens: metrics.prompt_tokens || 0,
      completion_tokens: metrics.completion_tokens || 0,
      total_tokens: metrics.total_tokens || 0,
      ttft_p95: round(metrics.ttft_p95),
      e2e_p95: round(metrics.e2e_p95),
      error_rate: round(metrics.error_rate)
    };
  });
}

function rowsToCsv(rows: JsonObject[]): string {
  const lines = [csvFields.join(",")];
  rows.forEach((row) => {
    lines.push(csvFields.map((field) => csvEscape(row[field])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function round(value: unknown): unknown {
  return typeof value === "number" ? Number(value.toFixed(4)) : value;
}
