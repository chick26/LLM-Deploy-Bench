import assert from "node:assert/strict";
import test from "node:test";
import { percentile, summarizeRecords } from "../src/server/metrics.js";
import type { RequestRecord } from "../src/server/types.js";

test("percentile interpolates", () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([], 95), null);
});

test("summarizeRecords calculates totals and rates", () => {
  const records: RequestRecord[] = [
    {
      run_id: "r1",
      stage: "s1",
      model: "m1",
      endpoint_type: "chat",
      concurrency: 1,
      started_at: 0,
      ended_at: 1,
      success: true,
      ttft_seconds: 0.2,
      e2e_seconds: 1,
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      usage_source: "provider"
    },
    {
      run_id: "r1",
      stage: "s1",
      model: "m1",
      endpoint_type: "chat",
      concurrency: 1,
      started_at: 1,
      ended_at: 2,
      success: false,
      error: "boom"
    }
  ];

  const summary = summarizeRecords(records, 2);

  assert.equal(summary.completed_requests, 1);
  assert.equal(summary.failed_requests, 1);
  assert.equal(summary.error_rate, 0.5);
  assert.equal(summary.output_tokens_per_second, 5);
});
