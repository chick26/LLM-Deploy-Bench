import type { JsonObject, RequestRecord } from "./types.js";

export function percentile(values: Array<number | null | undefined>, pct: number): number | null {
  const ordered = values.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (!ordered.length) return null;
  if (ordered.length === 1) return ordered[0];
  const rank = (pct / 100) * (ordered.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.min(lower + 1, ordered.length - 1);
  const fraction = rank - lower;
  return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function summarizeRecords(records: RequestRecord[], elapsedSeconds: number): JsonObject {
  const elapsed = Math.max(elapsedSeconds, 0.001);
  const successes = records.filter((record) => record.success);
  const failures = records.filter((record) => !record.success);
  const timeouts = records.filter((record) => record.timed_out);
  const e2e = successes
    .map((record) => record.e2e_seconds)
    .filter((value): value is number => typeof value === "number");
  const ttft = successes
    .map((record) => record.ttft_seconds)
    .filter((value): value is number => typeof value === "number");
  const itl = successes.flatMap((record) => record.itl_seconds || []);
  const promptTokens = successes.reduce((total, record) => total + (record.prompt_tokens || 0), 0);
  const completionTokens = successes.reduce((total, record) => total + (record.completion_tokens || 0), 0);
  const totalTokens = successes.reduce((total, record) => total + (record.total_tokens || 0), 0);
  const markerValues = records
    .map((record) => record.context_marker_found)
    .filter((value): value is boolean => typeof value === "boolean");

  const summary: JsonObject = {
    total_requests: records.length,
    completed_requests: successes.length,
    failed_requests: failures.length,
    timeout_requests: timeouts.length,
    error_rate: records.length ? failures.length / records.length : 0,
    timeout_rate: records.length ? timeouts.length / records.length : 0,
    rps: successes.length / elapsed,
    input_tokens_per_second: promptTokens / elapsed,
    output_tokens_per_second: completionTokens / elapsed,
    total_tokens_per_second: totalTokens / elapsed,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    ttft_avg: mean(ttft),
    ttft_p50: percentile(ttft, 50),
    ttft_p95: percentile(ttft, 95),
    ttft_p99: percentile(ttft, 99),
    e2e_avg: mean(e2e),
    e2e_p50: percentile(e2e, 50),
    e2e_p95: percentile(e2e, 95),
    e2e_p99: percentile(e2e, 99),
    itl_avg: mean(itl),
    itl_p95: percentile(itl, 95),
    usage_estimated_requests: successes.filter((record) => record.usage_source === "estimated").length
  };
  if (markerValues.length) {
    summary.context_marker_found = markerValues.every(Boolean);
  }
  return summary;
}
