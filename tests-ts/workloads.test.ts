import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeArtifacts } from "../src/server/artifacts.js";
import type { RequestRecord, RunSummary } from "../src/server/types.js";
import {
  buildEmbeddingPayload,
  buildLongContextPrompt,
  buildRerankPayload,
  configuredPositiveInts,
  estimateTokens,
  rerankTopHit,
  summarizeEmbeddingStage,
  summarizeRerankStage
} from "../src/server/runner.js";

test("embedding payload and summary include input scale", () => {
  const payload = buildEmbeddingPayload("emb-model", 2);
  assert.equal(payload.model, "emb-model");
  assert.equal((payload.input as string[]).length, 2);

  const records: RequestRecord[] = [
    {
      run_id: "r1",
      stage: "embedding",
      model: "emb-model",
      endpoint_type: "embedding",
      concurrency: 2,
      started_at: 0,
      ended_at: 1,
      success: true,
      e2e_seconds: 1,
      prompt_tokens: 7,
      total_tokens: 7,
      usage_source: "provider"
    }
  ];
  const metrics = summarizeEmbeddingStage(records, [{ embedding_batch_size: 2, vector_count: 2, embedding_dimension: 2560 }], 1);

  assert.equal(metrics.completed_requests, 1);
  assert.equal(metrics.embedding_batch_size, 2);
  assert.equal(metrics.vectors_per_second, 2);
  assert.equal(metrics.embedding_dimension, 2560);
});

test("rerank payload and summary include document scale", () => {
  const [payload, expectedIndex] = buildRerankPayload("rerank-model", 5);
  assert.equal(payload.model, "rerank-model");
  assert.equal((payload.documents as string[]).length, 5);
  assert.equal(expectedIndex, 4);
  assert.equal(rerankTopHit([{ index: 4 }], payload.documents as string[], expectedIndex), true);

  const records: RequestRecord[] = [
    {
      run_id: "r1",
      stage: "rerank",
      model: "rerank-model",
      endpoint_type: "rerank",
      concurrency: 2,
      started_at: 0,
      ended_at: 1,
      success: true,
      e2e_seconds: 1
    }
  ];
  const metrics = summarizeRerankStage(records, [{ rerank_document_count: 5, document_count: 5, result_count: 3, top_hit: 1 }], 1);

  assert.equal(metrics.completed_requests, 1);
  assert.equal(metrics.rerank_document_count, 5);
  assert.equal(metrics.documents_per_second, 5);
  assert.equal(metrics.rerank_top_hit, 1);
});

test("configuredPositiveInts prefers list values over legacy scalar", () => {
  assert.deepEqual(
    configuredPositiveInts(undefined, undefined, { batch_sizes: [32, 16, 32], batch_size: 8 }, "batch_sizes", "batch_size", 3),
    [16, 32]
  );
  assert.deepEqual(
    configuredPositiveInts([64, 16], 8, { batch_sizes: [32], batch_size: 4 }, "batch_sizes", "batch_size", 3),
    [16, 64]
  );
  assert.deepEqual(
    configuredPositiveInts([], undefined, { batch_sizes: [24, 12], batch_size: 4 }, "batch_sizes", "batch_size", 3),
    [12, 24]
  );
});

test("long context prompt reaches target with tail marker", () => {
  for (const target of [8192, 32768, 131072, 262144]) {
    const [prompt, marker] = buildLongContextPrompt(target);
    assert.equal(prompt.slice(-220).includes(marker), true);
    assert.equal(estimateTokens(prompt) >= target, true);
    assert.equal(estimateTokens(prompt) <= target + 64, true);
  }
});

test("summary csv includes embedding and rerank scale columns", () => {
  const runDir = mkdtempSync(join(tmpdir(), "llm-bench-run-"));
  const summary: RunSummary = {
    run_id: "r1",
    mode: "standard",
    status: "finished",
    stages: [
      {
        endpoint_type: "embedding",
        model: "emb-model",
        stage: "embedding / emb-model / b16 / c2",
        concurrency: 2,
        metrics: { embedding_batch_size: 16, completed_requests: 1 }
      },
      {
        endpoint_type: "rerank",
        model: "rerank-model",
        stage: "rerank / rerank-model / d64 / c2",
        concurrency: 2,
        metrics: { rerank_document_count: 64, completed_requests: 1 }
      }
    ],
    security: [],
    service_checks: [],
    artifacts: [],
    totals: {}
  };

  writeArtifacts(runDir, summary, [], []);
  const csvText = readFileSync(join(runDir, "summary.csv"), "utf8");

  assert.equal(csvText.includes("embedding_batch_size"), true);
  assert.equal(csvText.includes("rerank_document_count"), true);
  assert.equal(csvText.includes("16"), true);
  assert.equal(csvText.includes("64"), true);
});
