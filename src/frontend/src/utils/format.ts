import type { Metrics, RunSummary } from "../types";
import type { StageRow, WorkloadAggregate } from "../viewTypes";

export function sumMetric(rows: StageRow[], field: string) {
  return rows.reduce((total, row) => total + numberValue(row[field]), 0);
}

export function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function metricValue(metrics: Metrics, field: keyof Metrics) {
  return numberValue(metrics[field]);
}

export function elapsedRuntimeSeconds(startedAt: number | null, summary: RunSummary | null, now: number) {
  if (summary?.started_at && summary.finished_at) {
    const started = new Date(summary.started_at).getTime();
    const finished = new Date(summary.finished_at).getTime();
    if (Number.isFinite(started) && Number.isFinite(finished)) {
      return Math.max(0, Math.floor((finished - started) / 1000));
    }
  }
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function formatTokenTarget(value: number) {
  if (value >= 1024) return `${Math.round(value / 1024)}k`;
  return String(value);
}

export function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

export function renderNumber(value: unknown) {
  return typeof value === "number" ? value.toFixed(2) : value == null ? "-" : String(value);
}

export function renderPercent(value: unknown) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : value == null ? "-" : String(value);
}

export function renderBoolean(value: unknown) {
  if (typeof value === "boolean") return value ? "命中" : "未命中";
  return value == null ? "-" : String(value);
}

export function round(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

export function statusColor(status: string) {
  if (["ok", "success", "finished", "ready"].includes(status)) return "success";
  if (["warn", "warning", "skipped", "cancelling", "preview"].includes(status)) return "warning";
  if (["error", "failed"].includes(status)) return "error";
  if (["running", "starting", "processing"].includes(status)) return "processing";
  return "default";
}

export function normalizeWorkload(workload: string) {
  if (workload === "long-context") return "long_context";
  return workload;
}

export function workloadLabel(workload: string) {
  const labels: Record<string, string> = {
    chat: "Chat",
    long_context: "Long Context",
    embedding: "Embedding",
    rerank: "Rerank",
    service: "Service",
    security: "Security",
    unknown: "Other"
  };
  return labels[workload] || workload;
}

export function formatThroughputPrimary(workload: WorkloadAggregate) {
  if (workload.vectors > 0) return `${workload.vectors.toFixed(2)} vec/s`;
  if (workload.docs > 0) return `${workload.docs.toFixed(2)} doc/s`;
  return `${workload.rps.toFixed(2)} req/s`;
}

export function formatThroughputSecondary(workload: WorkloadAggregate) {
  const parts = [`RPS ${workload.rps.toFixed(2)}`];
  if (workload.outputTps > 0) parts.push(`${workload.outputTps.toFixed(2)} tok/s`);
  parts.push(`p95 ${workload.p95.toFixed(2)}s`);
  return parts.join(" · ");
}
