import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ActiveRunRequest, BenchConfig, JsonObject, RequestRecord, RunEvent, RunRequest, RunSummary } from "./types.js";
import { ensureRunDir, writeArtifacts } from "./artifacts.js";
import { authHeaders, loadConfig } from "./config.js";
import { summarizeRecords } from "./metrics.js";
import { redact, redactText } from "./redaction.js";

type Subscriber = (event: RunEvent) => void;

export class RunState {
  runId: string;
  request: ActiveRunRequest;
  runDir: string;
  status = "starting";
  cancelController = new AbortController();
  events: RunEvent[] = [];
  records: RequestRecord[] = [];
  summary: RunSummary | null = null;
  subscribers = new Set<Subscriber>();

  constructor(runId: string, request: RunRequest) {
    this.runId = runId;
    this.request = { ...request, mode: request.mode || "standard" };
    this.runDir = ensureRunDir(runId);
  }

  publish(event: RunEvent): void {
    const payload = redact({
      ts: Date.now() / 1000,
      run_id: this.runId,
      ...event
    }) as RunEvent;
    this.events.push(payload);
    this.subscribers.forEach((subscriber) => subscriber(payload));
  }

  subscribe(subscriber: Subscriber): void {
    this.subscribers.add(subscriber);
  }

  unsubscribe(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
  }
}

export class RunManager {
  runs = new Map<string, RunState>();
  activeRunId: string | null = null;

  start(request: RunRequest): RunState {
    if (this.activeRunId) {
      const active = this.runs.get(this.activeRunId);
      if (active && ["starting", "running"].includes(active.status)) {
        throw new Error("another run is already active");
      }
    }
    const runId = `${timestampId()}-${randomUUID().slice(0, 6)}`;
    const run = new RunState(runId, request);
    this.runs.set(runId, run);
    this.activeRunId = runId;
    void this.execute(run);
    return run;
  }

  cancel(runId: string): RunState {
    const run = this.get(runId);
    run.cancelController.abort();
    run.publish({ type: "log", level: "warn", message: "Cancel requested" });
    return run;
  }

  get(runId: string): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new Error("run not found");
    return run;
  }

  private async execute(run: RunState): Promise<void> {
    run.status = "running";
    const summary: RunSummary = {
      run_id: run.runId,
      mode: run.request.mode,
      status: "running",
      started_at: new Date().toISOString(),
      stages: [],
      security: [],
      service_checks: [],
      artifacts: []
    };

    try {
      const config = loadConfig();
      run.publish({ type: "started", status: "running", mode: run.request.mode });
      if (run.request.mode === "raw-check") {
        await Promise.all([
          runServiceChecksIntoSummary(config, run, summary),
          runSecurityChecksIntoSummary(config, run, summary)
        ]);
      } else if (run.request.mode === "smoke") {
        await runSmoke(config, run, summary);
      } else {
        await runParallelBenchmark(config, run, summary);
      }

      summary.status = run.cancelController.signal.aborted ? "cancelled" : "finished";
      summary.finished_at = new Date().toISOString();
      summary.totals = buildTotals(summary);
      summary.artifacts = writeArtifacts(run.runDir, summary, run.records, run.events);
      run.summary = summary;
      run.status = summary.status;
      run.publish({ type: "artifacts", artifacts: summary.artifacts });
      run.publish({ type: summary.status, status: summary.status, summary });
    } catch (error) {
      run.status = "failed";
      summary.status = "failed";
      summary.error = redactText(error instanceof Error ? error.message : String(error));
      run.summary = summary;
      writeArtifacts(run.runDir, summary, run.records, run.events);
      run.publish({ type: "failed", level: "error", message: summary.error });
    } finally {
      if (this.activeRunId === run.runId) this.activeRunId = null;
    }
  }
}

async function runSmoke(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  run.publish({ type: "stage", stage: "smoke", status: "running" });
  const baseUrl = config.litellm.base_url.replace(/\/$/, "");
  const checks = [
    ["liveliness", "GET", `${baseUrl}/health/liveliness`, true],
    ["readiness", "GET", `${baseUrl}/health/readiness`, true],
    ["models", "GET", `${baseUrl}/v1/models`, false]
  ] as const;

  for (const [name, method, url, admin] of checks) {
    const started = performance.now();
    try {
      const response = await fetchWithTimeout(
        url,
        { method, headers: authHeaders(config, admin) },
        20,
        run.cancelController.signal
      );
      run.publish({
        type: "check",
        stage: "smoke",
        name,
        status: response.status < 400 ? "ok" : "warn",
        status_code: response.status,
        latency_seconds: (performance.now() - started) / 1000
      });
    } catch (error) {
      run.publish({
        type: "check",
        stage: "smoke",
        name,
        status: "error",
        message: errorMessage(error)
      });
    }
  }

  const selected = selectedChatModels(config, run.request).slice(0, 4);
  for (const model of selected.length ? selected : selectedChatModels(config, run.request).slice(0, 1)) {
    if (run.cancelController.signal.aborted) return;
    const record = await sendChatRequest(config, run, {
      model,
      stage: "smoke",
      concurrency: 1,
      maxOutputTokens: run.request.max_output_tokens || 32,
      timeoutSeconds: run.request.request_timeout_seconds || config.thresholds.request_timeout_seconds
    });
    run.records.push(record);
    const metrics = summarizeRecords([record], Math.max(record.e2e_seconds || 0.001, 0.001));
    metrics.endpoint_type = "chat";
    publishStageResult(run, summary, "smoke", model, "chat", 1, metrics, false);
  }
  run.publish({ type: "stage", stage: "smoke", status: "finished" });
}

async function runParallelBenchmark(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  await Promise.all([
    runSmoke(config, run, summary),
    runChatLoad(config, run, summary),
    runEmbeddingChecks(config, run, summary),
    runRerankChecks(config, run, summary),
    runLongContextChecks(config, run, summary),
    runServiceChecksIntoSummary(config, run, summary),
    runSecurityChecksIntoSummary(config, run, summary)
  ]);
}

export function benchmarkTaskSpecs(config: BenchConfig, request: RunRequest): JsonObject[] {
  return [
    { workload: "smoke", model: "*" },
    ...selectedChatModels(config, request).map((model) => ({ workload: "chat", model })),
    ...config.models.embedding.map((model) => ({ workload: "embedding", model })),
    ...config.models.rerank.map((model) => ({ workload: "rerank", model })),
    ...selectedLongContextModels(config, request).map((model) => ({ workload: "long_context", model })),
    { workload: "service", model: "*" },
    { workload: "security", model: "*" }
  ];
}

function publishStageResult(
  run: RunState,
  summary: RunSummary,
  stage: string,
  model: string,
  endpointType: string,
  concurrency: number,
  metrics: JsonObject,
  final = true
): void {
  summary.stages.push({ stage, model, endpoint_type: endpointType, concurrency, metrics });
  run.publish({
    type: "metrics",
    stage,
    model,
    endpoint_type: endpointType,
    concurrency,
    metrics,
    final
  });
}

async function runServiceChecksIntoSummary(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  summary.service_checks = await runServiceChecks(config, run);
}

async function runSecurityChecksIntoSummary(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  summary.security = await runSecurityChecks(config, run);
}

async function runChatLoad(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  await Promise.all(selectedChatModels(config, run.request).map((model) => runChatModelLoad(config, run, summary, model)));
}

async function runChatModelLoad(config: BenchConfig, run: RunState, summary: RunSummary, model: string): Promise<void> {
  const profile = loadProfile(config, run);
  const steps = configuredSteps(run.request.concurrency_steps, arr(profile.concurrency_steps), [1]);
  const duration = Number(run.request.duration_seconds || profile.duration_seconds || 30);
  const maxOutput = Number(run.request.max_output_tokens || profile.max_output_tokens || 128);
  const timeout = Number(run.request.request_timeout_seconds || config.thresholds.request_timeout_seconds);

  for (const concurrency of steps) {
    if (run.cancelController.signal.aborted) return;
    const stageName = `${model} / c${concurrency}`;
    run.publish({ type: "stage", stage: stageName, model, endpoint_type: "chat", concurrency, status: "running" });
    const records = await runConcurrencyStage(config, run, model, stageName, concurrency, duration, maxOutput, timeout);
    const elapsed = elapsedFromRecords(records);
    const metrics = summarizeRecords(records, elapsed);
    metrics.endpoint_type = "chat";
    publishStageResult(run, summary, stageName, model, "chat", concurrency, metrics);
    run.publish({ type: "stage", stage: stageName, model, endpoint_type: "chat", concurrency, status: "finished" });
    if (shouldStopStage(config, run, metrics)) {
      run.publish({ type: "log", level: "warn", message: `${model} reached stop threshold at concurrency ${concurrency}` });
      break;
    }
  }
}

async function runConcurrencyStage(
  config: BenchConfig,
  run: RunState,
  model: string,
  stage: string,
  concurrency: number,
  durationSeconds: number,
  maxOutputTokens: number,
  timeoutSeconds: number
): Promise<RequestRecord[]> {
  const records: RequestRecord[] = [];
  let stopped = false;
  const started = performance.now();
  const deadline = started + durationSeconds * 1000;

  async function worker(): Promise<void> {
    while (performance.now() < deadline && !run.cancelController.signal.aborted && !stopped) {
      const record = await sendChatRequest(config, run, {
        model,
        stage,
        concurrency,
        maxOutputTokens,
        timeoutSeconds
      });
      records.push(record);
      run.records.push(record);
    }
  }

  async function ticker(): Promise<void> {
    while (performance.now() < deadline && !run.cancelController.signal.aborted && !stopped) {
      await sleep(1000);
      const elapsed = (performance.now() - started) / 1000;
      const metrics = summarizeRecords(records, elapsed);
      metrics.endpoint_type = "chat";
      run.publish({ type: "metrics", stage, model, endpoint_type: "chat", concurrency, elapsed_seconds: elapsed, metrics });
      if (records.length >= Math.max(10, concurrency) && shouldStopStage(config, run, metrics)) {
        stopped = true;
      }
    }
  }

  await Promise.all([...Array.from({ length: concurrency }, worker), ticker()]);
  return records;
}

interface ChatRequestOptions {
  model: string;
  stage: string;
  concurrency: number;
  maxOutputTokens: number;
  timeoutSeconds: number;
  prompt?: string;
  endpointType?: string;
  expectedText?: string;
}

async function sendChatRequest(config: BenchConfig, run: RunState, options: ChatRequestOptions): Promise<RequestRecord> {
  const baseUrl = config.litellm.base_url.replace(/\/$/, "");
  const url = `${baseUrl}/v1/chat/completions`;
  const startedWall = Date.now() / 1000;
  const started = performance.now();
  const textParts: string[] = [];
  const chunkTimes: number[] = [];
  let usage: JsonObject | null = null;
  let statusCode: number | null = null;
  const requestPrompt = options.prompt || buildPrompt();
  const endpointType = options.endpointType || "chat";
  const payload = {
    model: options.model,
    messages: [
      { role: "system", content: "You are a concise deployment validation assistant." },
      { role: "user", content: requestPrompt }
    ],
    temperature: 0.2,
    max_tokens: options.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true }
  };

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { ...authHeaders(config), "content-type": "application/json" },
        body: JSON.stringify(payload)
      },
      options.timeoutSeconds,
      run.cancelController.signal
    );
    statusCode = response.status;
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    for await (const line of readSseLines(response)) {
      if (!line.startsWith("data:")) continue;
      const data = line.replace(/^data:\s*/, "").trim();
      if (data === "[DONE]") break;
      const now = performance.now();
      try {
        const item = JSON.parse(data) as JsonObject;
        if (item.usage && typeof item.usage === "object") usage = item.usage as JsonObject;
        const content = extractDeltaText(item);
        if (content) {
          textParts.push(content);
          chunkTimes.push(now);
        }
      } catch {
        // Ignore malformed stream chunks from proxies.
      }
    }
  } catch (error) {
    const timedOut = isAbortError(error) && !run.cancelController.signal.aborted;
    return makeRecord(
      run,
      options.stage,
      options.model,
      options.concurrency,
      startedWall,
      started,
      false,
      statusCode,
      timedOut ? `timeout: ${errorMessage(error)}` : errorMessage(error),
      timedOut,
      requestPrompt,
      "",
      usage,
      chunkTimes,
      endpointType,
      null
    );
  }

  const completion = textParts.join("");
  const contextMarkerFound = options.expectedText ? completion.includes(options.expectedText) : null;
  return makeRecord(
    run,
    options.stage,
    options.model,
    options.concurrency,
    startedWall,
    started,
    true,
    statusCode,
    null,
    false,
    requestPrompt,
    completion,
    usage,
    chunkTimes,
    endpointType,
    contextMarkerFound
  );
}

function makeRecord(
  run: RunState,
  stage: string,
  model: string,
  concurrency: number,
  startedWall: number,
  startedPerf: number,
  success: boolean,
  statusCode: number | null,
  error: string | null,
  timedOut: boolean,
  prompt: string,
  completion: string,
  usage: JsonObject | null,
  chunkTimes: number[],
  endpointType: string,
  contextMarkerFound: boolean | null
): RequestRecord {
  const endedPerf = performance.now();
  const ttft = chunkTimes.length ? (chunkTimes[0] - startedPerf) / 1000 : null;
  const itl = chunkTimes.slice(1).map((time, index) => (time - chunkTimes[index]) / 1000);
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let usageSource = "unknown";

  if (usage) {
    promptTokens = Number(usage.prompt_tokens || 0);
    completionTokens = Number(usage.completion_tokens || 0);
    totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
    usageSource = "provider";
  } else if (success) {
    promptTokens = estimateTokens(prompt);
    completionTokens = estimateTokens(completion);
    totalTokens = promptTokens + completionTokens;
    usageSource = "estimated";
  }

  return {
    run_id: run.runId,
    stage,
    model,
    endpoint_type: endpointType,
    concurrency,
    started_at: startedWall,
    ended_at: Date.now() / 1000,
    success,
    status_code: statusCode,
    error: error ? redactText(error) : null,
    timed_out: timedOut,
    ttft_seconds: ttft,
    e2e_seconds: (endedPerf - startedPerf) / 1000,
    itl_seconds: itl,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    usage_source: usageSource,
    context_marker_found: contextMarkerFound
  };
}

async function runEmbeddingChecks(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  await Promise.all(config.models.embedding.map((model) => runEmbeddingModelChecks(config, run, summary, model)));
}

export async function runEmbeddingModelChecks(
  config: BenchConfig,
  run: RunState,
  summary: RunSummary,
  model: string
): Promise<void> {
  const rootProfile = loadProfile(config, run);
  const profile = obj(rootProfile.embedding);
  const steps = configuredSteps(run.request.embedding_concurrency_steps, arr(profile.concurrency_steps), [1]);
  const duration = Number(profile.duration_seconds || rootProfile.duration_seconds || 30);
  const batchSizes = configuredPositiveInts(
    run.request.embedding_batch_sizes,
    run.request.embedding_batch_size,
    profile,
    "batch_sizes",
    "batch_size",
    3
  );
  const timeout = Number(run.request.request_timeout_seconds || config.thresholds.request_timeout_seconds);

  for (const batchSize of batchSizes) {
    for (const concurrency of steps) {
      if (run.cancelController.signal.aborted) return;
      const stageName = `embedding / ${model} / b${batchSize} / c${concurrency}`;
      run.publish({ type: "stage", stage: stageName, model, endpoint_type: "embedding", concurrency, status: "running" });
      const [records, extras] = await runTimedWorkloadStage(
        config,
        run,
        stageName,
        model,
        "embedding",
        concurrency,
        duration,
        () => sendEmbeddingRequest(config, run, model, stageName, concurrency, batchSize, timeout),
        summarizeEmbeddingStage
      );
      const metrics = summarizeEmbeddingStage(records, extras, elapsedFromRecords(records));
      publishStageResult(run, summary, stageName, model, "embedding", concurrency, metrics);
      run.publish({ type: "stage", stage: stageName, model, endpoint_type: "embedding", concurrency, status: "finished" });
      if (shouldStopStage(config, run, metrics)) {
        run.publish({
          type: "log",
          level: "warn",
          message: `${model} embedding reached stop threshold at batch ${batchSize} concurrency ${concurrency}`
        });
        break;
      }
    }
  }
}

async function runRerankChecks(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  await Promise.all(config.models.rerank.map((model) => runRerankModelChecks(config, run, summary, model)));
}

export async function runRerankModelChecks(
  config: BenchConfig,
  run: RunState,
  summary: RunSummary,
  model: string
): Promise<void> {
  const rootProfile = loadProfile(config, run);
  const profile = obj(rootProfile.rerank);
  const steps = configuredSteps(run.request.rerank_concurrency_steps, arr(profile.concurrency_steps), [1]);
  const duration = Number(profile.duration_seconds || rootProfile.duration_seconds || 30);
  const documentCounts = configuredPositiveInts(
    run.request.rerank_document_counts,
    run.request.rerank_document_count,
    profile,
    "document_counts",
    "document_count",
    4
  );
  const timeout = Number(run.request.request_timeout_seconds || config.thresholds.request_timeout_seconds);

  for (const documentCount of documentCounts) {
    for (const concurrency of steps) {
      if (run.cancelController.signal.aborted) return;
      const stageName = `rerank / ${model} / d${documentCount} / c${concurrency}`;
      run.publish({ type: "stage", stage: stageName, model, endpoint_type: "rerank", concurrency, status: "running" });
      const [records, extras] = await runTimedWorkloadStage(
        config,
        run,
        stageName,
        model,
        "rerank",
        concurrency,
        duration,
        () => sendRerankRequest(config, run, model, stageName, concurrency, documentCount, timeout),
        summarizeRerankStage
      );
      const metrics = summarizeRerankStage(records, extras, elapsedFromRecords(records));
      publishStageResult(run, summary, stageName, model, "rerank", concurrency, metrics);
      run.publish({ type: "stage", stage: stageName, model, endpoint_type: "rerank", concurrency, status: "finished" });
      if (shouldStopStage(config, run, metrics)) {
        run.publish({
          type: "log",
          level: "warn",
          message: `${model} rerank reached stop threshold at documents ${documentCount} concurrency ${concurrency}`
        });
        break;
      }
    }
  }
}

async function runLongContextChecks(config: BenchConfig, run: RunState, summary: RunSummary): Promise<void> {
  await Promise.all(selectedLongContextModels(config, run.request).map((model) => runLongContextModelChecks(config, run, summary, model)));
}

async function runLongContextModelChecks(config: BenchConfig, run: RunState, summary: RunSummary, model: string): Promise<void> {
  const profile = obj(loadProfile(config, run).long_context);
  const baseTargets = configuredSteps(run.request.long_context_token_targets, arr(profile.token_targets), []);
  const extremeTargets = positiveInts(arr(profile.extreme_token_targets) || []);
  const targets = Array.from(new Set([...baseTargets, ...(run.request.include_extreme_context ? extremeTargets : [])])).sort((a, b) => a - b);
  if (!targets.length) return;
  const steps = configuredSteps(undefined, arr(profile.concurrency_steps), [1]);
  const maxOutput = Number(profile.max_output_tokens || run.request.max_output_tokens || 256);
  const timeout = Number(profile.request_timeout_seconds || run.request.request_timeout_seconds || config.thresholds.request_timeout_seconds);

  for (const target of targets) {
    const [prompt, marker] = buildLongContextPrompt(target);
    for (const concurrency of steps) {
      if (run.cancelController.signal.aborted) return;
      const stageName = `long_context ${target} / ${model} / c${concurrency}`;
      run.publish({ type: "stage", stage: stageName, model, endpoint_type: "long_context", concurrency, status: "running" });
      const records = await runFixedChatStage(config, run, model, stageName, concurrency, maxOutput, timeout, prompt, "long_context", marker);
      const metrics = summarizeRecords(records, elapsedFromRecords(records));
      metrics.endpoint_type = "long_context";
      metrics.context_target_tokens = target;
      publishStageResult(run, summary, stageName, model, "long_context", concurrency, metrics);
      run.publish({ type: "stage", stage: stageName, model, endpoint_type: "long_context", concurrency, status: "finished" });
    }
  }
}

async function runTimedWorkloadStage(
  config: BenchConfig,
  run: RunState,
  stage: string,
  model: string,
  endpointType: string,
  concurrency: number,
  durationSeconds: number,
  sendOnce: () => Promise<[RequestRecord, JsonObject]>,
  buildMetrics: (records: RequestRecord[], extras: JsonObject[], elapsedSeconds: number) => JsonObject
): Promise<[RequestRecord[], JsonObject[]]> {
  const records: RequestRecord[] = [];
  const extras: JsonObject[] = [];
  let stopped = false;
  const started = performance.now();
  const deadline = started + durationSeconds * 1000;

  async function worker(): Promise<void> {
    while (performance.now() < deadline && !run.cancelController.signal.aborted && !stopped) {
      const [record, extra] = await sendOnce();
      records.push(record);
      extras.push(extra);
      run.records.push(record);
    }
  }

  async function ticker(): Promise<void> {
    while (performance.now() < deadline && !run.cancelController.signal.aborted && !stopped) {
      await sleep(1000);
      const elapsed = (performance.now() - started) / 1000;
      const metrics = buildMetrics(records, extras, elapsed);
      run.publish({ type: "metrics", stage, model, endpoint_type: endpointType, concurrency, elapsed_seconds: elapsed, metrics });
      if (records.length >= Math.max(10, concurrency) && shouldStopStage(config, run, metrics)) stopped = true;
    }
  }

  await Promise.all([...Array.from({ length: concurrency }, worker), ticker()]);
  return [records, extras];
}

async function runFixedChatStage(
  config: BenchConfig,
  run: RunState,
  model: string,
  stage: string,
  concurrency: number,
  maxOutputTokens: number,
  timeoutSeconds: number,
  prompt: string,
  endpointType: string,
  expectedText: string
): Promise<RequestRecord[]> {
  const started = performance.now();
  const records: RequestRecord[] = [];
  type PendingChat = Promise<{ record: RequestRecord; task: PendingChat }>;
  const pending = new Set<PendingChat>();

  for (let index = 0; index < concurrency; index += 1) {
    const task = sendChatRequest(config, run, {
      model,
      stage,
      concurrency,
      maxOutputTokens,
      timeoutSeconds,
      prompt,
      endpointType,
      expectedText
    }).then((record) => ({ record, task })) as PendingChat;
    pending.add(task);
  }

  while (pending.size) {
    if (run.cancelController.signal.aborted) break;
    const { record, task } = await Promise.race(pending);
    pending.delete(task);
    records.push(record);
    run.records.push(record);
    const elapsed = Math.max((performance.now() - started) / 1000, 0.001);
    const metrics = summarizeRecords(records, elapsed);
    metrics.endpoint_type = endpointType;
    run.publish({ type: "metrics", stage, model, endpoint_type: endpointType, concurrency, elapsed_seconds: elapsed, metrics });
  }
  return records;
}

async function sendEmbeddingRequest(
  config: BenchConfig,
  run: RunState,
  model: string,
  stage: string,
  concurrency: number,
  batchSize: number,
  timeoutSeconds: number
): Promise<[RequestRecord, JsonObject]> {
  const url = `${config.litellm.base_url.replace(/\/$/, "")}/v1/embeddings`;
  const payload = buildEmbeddingPayload(model, batchSize);
  const startedWall = Date.now() / 1000;
  const started = performance.now();
  let statusCode: number | null = null;
  let usage: JsonObject | null = null;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { ...authHeaders(config), "content-type": "application/json" },
        body: JSON.stringify(payload)
      },
      timeoutSeconds,
      run.cancelController.signal
    );
    statusCode = response.status;
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const data = (await response.json()) as JsonObject;
    usage = typeof data.usage === "object" && data.usage ? (data.usage as JsonObject) : null;
    const vectors = Array.isArray(data.data) ? data.data : [];
    const dimension = embeddingDimension(vectors);
    const vectorCount = vectors.length;
    const success = vectorCount === (payload.input as string[]).length && dimension !== null;
    const error = success ? null : `expected ${(payload.input as string[]).length} embeddings, got ${vectorCount}`;
    const record = makeEndpointRecord(run, stage, model, "embedding", concurrency, startedWall, started, success, statusCode, error, false, usage);
    return [record, { embedding_batch_size: batchSize, vector_count: success ? vectorCount : 0, embedding_dimension: dimension }];
  } catch (error) {
    const timedOut = isAbortError(error) && !run.cancelController.signal.aborted;
    return [
      makeEndpointRecord(
        run,
        stage,
        model,
        "embedding",
        concurrency,
        startedWall,
        started,
        false,
        statusCode,
        timedOut ? `timeout: ${errorMessage(error)}` : errorMessage(error),
        timedOut,
        usage
      ),
      { embedding_batch_size: batchSize, vector_count: 0, embedding_dimension: null }
    ];
  }
}

async function sendRerankRequest(
  config: BenchConfig,
  run: RunState,
  model: string,
  stage: string,
  concurrency: number,
  documentCount: number,
  timeoutSeconds: number
): Promise<[RequestRecord, JsonObject]> {
  const url = `${config.litellm.base_url.replace(/\/$/, "")}/rerank`;
  const [payload, expectedIndex] = buildRerankPayload(model, documentCount);
  const startedWall = Date.now() / 1000;
  const started = performance.now();
  let statusCode: number | null = null;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { ...authHeaders(config), "content-type": "application/json" },
        body: JSON.stringify(payload)
      },
      timeoutSeconds,
      run.cancelController.signal
    );
    statusCode = response.status;
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const data = (await response.json()) as JsonObject;
    const results = Array.isArray(data.results) ? data.results : [];
    const topHit = rerankTopHit(results, payload.documents as string[], expectedIndex);
    const success = Boolean(results.length && topHit);
    const error = success ? null : "top rerank result did not match the LiteLLM document";
    const record = makeEndpointRecord(run, stage, model, "rerank", concurrency, startedWall, started, success, statusCode, error, false, null);
    return [
      record,
      {
        rerank_document_count: (payload.documents as string[]).length,
        document_count: success ? (payload.documents as string[]).length : 0,
        result_count: results.length,
        top_hit: topHit ? 1 : 0
      }
    ];
  } catch (error) {
    const timedOut = isAbortError(error) && !run.cancelController.signal.aborted;
    return [
      makeEndpointRecord(
        run,
        stage,
        model,
        "rerank",
        concurrency,
        startedWall,
        started,
        false,
        statusCode,
        timedOut ? `timeout: ${errorMessage(error)}` : errorMessage(error),
        timedOut,
        null
      ),
      { rerank_document_count: documentCount, document_count: 0, result_count: 0, top_hit: 0 }
    ];
  }
}

function makeEndpointRecord(
  run: RunState,
  stage: string,
  model: string,
  endpointType: string,
  concurrency: number,
  startedWall: number,
  startedPerf: number,
  success: boolean,
  statusCode: number | null,
  error: string | null,
  timedOut: boolean,
  usage: JsonObject | null
): RequestRecord {
  let promptTokens = 0;
  let totalTokens = 0;
  let usageSource = "unknown";
  if (usage) {
    promptTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
    totalTokens = Number(usage.total_tokens || promptTokens);
    usageSource = "provider";
  }
  return {
    run_id: run.runId,
    stage,
    model,
    endpoint_type: endpointType,
    concurrency,
    started_at: startedWall,
    ended_at: Date.now() / 1000,
    success,
    status_code: statusCode,
    error: error ? redactText(error) : null,
    timed_out: timedOut,
    e2e_seconds: (performance.now() - startedPerf) / 1000,
    prompt_tokens: promptTokens,
    completion_tokens: 0,
    total_tokens: totalTokens,
    usage_source: usageSource
  };
}

export function buildEmbeddingInputs(batchSize: number): string[] {
  return Array.from({ length: Math.max(1, Math.trunc(batchSize)) }, (_, index) =>
    `deployment benchmark embedding sample ${index}: LiteLLM proxy latency and vector throughput`
  );
}

export function buildEmbeddingPayload(model: string, batchSize: number): JsonObject {
  return { model, input: buildEmbeddingInputs(batchSize) };
}

function embeddingDimension(vectors: unknown[]): number | null {
  const first = vectors[0];
  if (!first || typeof first !== "object") return null;
  const embedding = (first as JsonObject).embedding;
  return Array.isArray(embedding) ? embedding.length : null;
}

export function buildRerankDocuments(documentCount: number): [string[], number] {
  const count = Math.max(1, Math.trunc(documentCount));
  const documents = Array.from({ length: count }, (_, index) => `Document ${index}: general deployment note about capacity planning and observability.`);
  const expectedIndex = count - 1;
  documents[expectedIndex] = "Document target: LiteLLM can proxy OpenAI-compatible model endpoints and is the relevant answer for this rerank validation.";
  return [documents, expectedIndex];
}

export function buildRerankPayload(model: string, documentCount: number): [JsonObject, number] {
  const [documents, expectedIndex] = buildRerankDocuments(documentCount);
  return [
    {
      model,
      query: "Which document is about LiteLLM proxy endpoints?",
      documents,
      top_n: Math.min(3, documents.length)
    },
    expectedIndex
  ];
}

export function rerankTopHit(results: unknown[], documents: string[], expectedIndex: number): boolean {
  if (!results.length || !results[0] || typeof results[0] !== "object") return false;
  const first = results[0] as JsonObject;
  const index = first.index;
  if (index === expectedIndex) return true;
  const document = first.document && typeof first.document === "object" ? (first.document as JsonObject) : {};
  let text = typeof document.text === "string" ? document.text : null;
  if (!text && typeof index === "number" && index >= 0 && index < documents.length) text = documents[index];
  return Boolean(text && text.includes("LiteLLM"));
}

export function summarizeEmbeddingStage(records: RequestRecord[], extras: JsonObject[], elapsedSeconds: number): JsonObject {
  const metrics = summarizeRecords(records, elapsedSeconds);
  const vectorCount = extras.reduce((total, extra) => total + Number(extra.vector_count || 0), 0);
  const dimensions = extras.map((extra) => extra.embedding_dimension).filter((value): value is number => typeof value === "number");
  const batchSizes = extras.map((extra) => extra.embedding_batch_size).filter((value): value is number => typeof value === "number");
  return {
    ...metrics,
    endpoint_type: "embedding",
    embedding_batch_size: batchSizes[0] ?? null,
    vectors_per_second: vectorCount / Math.max(elapsedSeconds, 0.001),
    embedding_dimension: dimensions[0] ?? null
  };
}

export function summarizeRerankStage(records: RequestRecord[], extras: JsonObject[], elapsedSeconds: number): JsonObject {
  const metrics = summarizeRecords(records, elapsedSeconds);
  const documentCount = extras.reduce((total, extra) => total + Number(extra.document_count || 0), 0);
  const topHits = extras.reduce((total, extra) => total + Number(extra.top_hit || 0), 0);
  const configuredCounts = extras.map((extra) => extra.rerank_document_count).filter((value): value is number => typeof value === "number");
  const total = Number(metrics.total_requests || 0);
  return {
    ...metrics,
    endpoint_type: "rerank",
    rerank_document_count: configuredCounts[0] ?? null,
    documents_per_second: documentCount / Math.max(elapsedSeconds, 0.001),
    rerank_top_hit: total ? topHits / total : 0
  };
}

async function runServiceChecks(config: BenchConfig, run: RunState): Promise<JsonObject[]> {
  const results: JsonObject[] = [];
  run.publish({ type: "stage", stage: "service-check", status: "running" });
  const endpoints = arr(obj(config.paddleocr).layout_parsing) || [];
  for (const endpointRaw of endpoints) {
    const endpoint = obj(endpointRaw);
    const result = await checkPaddleocrLayoutParsing(config, run, endpoint);
    results.push(result);
    run.publish({ type: "service_result", ...result });
  }
  run.publish({ type: "stage", stage: "service-check", status: "finished" });
  return results;
}

async function checkPaddleocrLayoutParsing(config: BenchConfig, run: RunState, endpoint: JsonObject): Promise<JsonObject> {
  const url = serviceUrl(config, endpoint);
  const started = performance.now();
  try {
    const payload = buildPaddleocrLayoutPayload(endpoint);
    const response = await fetchWithTimeout(
      url,
      {
        method: String(endpoint.method || "POST"),
        headers: { ...authHeaders(config), "content-type": "application/json" },
        body: JSON.stringify(payload)
      },
      Number(endpoint.timeout_seconds || 180),
      run.cancelController.signal
    );
    const [detail, valid] = await summarizePaddleocrResponse(response);
    return {
      name: endpoint.name,
      url,
      status: response.status < 400 && valid ? "ok" : "warn",
      status_code: response.status,
      latency_seconds: (performance.now() - started) / 1000,
      detail
    };
  } catch (error) {
    return {
      name: endpoint.name,
      url,
      status: "error",
      latency_seconds: (performance.now() - started) / 1000,
      detail: errorMessage(error)
    };
  }
}

function serviceUrl(config: BenchConfig, endpoint: JsonObject): string {
  if (endpoint.url) return String(endpoint.url);
  const baseUrl = config.litellm.base_url.replace(/\/$/, "");
  const path = String(endpoint.path || "/layout-parsing").replace(/^\//, "");
  return `${baseUrl}/${path}`;
}

function buildPaddleocrLayoutPayload(endpoint: JsonObject): JsonObject {
  if (typeof endpoint.payload_file === "string" && existsSync(endpoint.payload_file)) {
    return JSON.parse(readFileSync(endpoint.payload_file, "utf8")) as JsonObject;
  }
  const payload = { ...(obj(endpoint.payload) || {}) };
  let fileValue = endpoint.file;
  if (fileValue === undefined && typeof endpoint.file_path === "string") {
    fileValue = readFileSync(endpoint.file_path).toString("base64");
  }
  if (fileValue === undefined) throw new Error("PaddleOCR-VL layout parsing check requires `file` or `file_path`");
  payload.file = payload.file || fileValue;
  if (endpoint.file_type !== undefined) payload.fileType = payload.fileType || endpoint.file_type;
  payload.returnMarkdownImages = payload.returnMarkdownImages ?? Boolean(endpoint.return_markdown_images);
  payload.visualize = payload.visualize ?? Boolean(endpoint.visualize);
  const mapping: Record<string, string> = {
    use_doc_orientation_classify: "useDocOrientationClassify",
    use_doc_unwarping: "useDocUnwarping",
    use_layout_detection: "useLayoutDetection",
    use_chart_recognition: "useChartRecognition",
    use_seal_recognition: "useSealRecognition",
    use_ocr_for_image_block: "useOcrForImageBlock",
    max_new_tokens: "maxNewTokens",
    restructure_pages: "restructurePages",
    output_formats: "outputFormats"
  };
  Object.entries(mapping).forEach(([configKey, payloadKey]) => {
    if (endpoint[configKey] !== undefined && payload[payloadKey] === undefined) payload[payloadKey] = endpoint[configKey];
  });
  return payload;
}

async function summarizePaddleocrResponse(response: Response): Promise<[string, boolean]> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as JsonObject;
    const errorCode = data.errorCode;
    const result = obj(data.result);
    const layoutResults = Array.isArray(result.layoutParsingResults) ? result.layoutParsingResults : [];
    const pages = layoutResults.length;
    const valid = (errorCode === 0 || errorCode === null || errorCode === undefined) && pages > 0;
    let detail = `errorCode=${errorCode}; pages=${pages}`;
    const first = obj(layoutResults[0]);
    const markdown = obj(first.markdown);
    if (typeof markdown.text === "string") detail += `; markdown_chars=${markdown.text.length}`;
    if (!valid) detail += `; body=${redactText(text.slice(0, 300))}`;
    return [detail, valid];
  } catch {
    return [redactText(text.slice(0, 300)), false];
  }
}

async function runSecurityChecks(config: BenchConfig, run: RunState): Promise<JsonObject[]> {
  const results: JsonObject[] = [];
  const baseUrl = config.litellm.base_url.replace(/\/$/, "");
  const model = selectedChatModels(config, run.request)[0] || config.models.chat[0] || "";
  const checks = [
    {
      name: "unauthorized chat",
      method: "POST",
      url: `${baseUrl}/v1/chat/completions`,
      json: { model, messages: [{ role: "user", content: "security check" }], max_tokens: 1 },
      expect_protected: true
    },
    { name: "metrics exposure", method: "GET", url: `${baseUrl}/metrics`, expect_protected: true },
    { name: "health detail exposure", method: "GET", url: `${baseUrl}/health`, expect_protected: false }
  ];

  for (const check of checks) {
    const started = performance.now();
    try {
      const response = await fetchWithTimeout(
        check.url,
        {
          method: check.method,
          headers: { "content-type": "application/json" },
          body: check.json ? JSON.stringify(check.json) : undefined
        },
        20,
        run.cancelController.signal
      );
      const text = await response.text();
      const protectedStatus = [401, 403].includes(response.status);
      const detailExposed = /(192\.168\.|10\.|127\.0\.0\.1|103\.239\.)/.test(text);
      let status = "ok";
      if (check.expect_protected && !protectedStatus) status = "warn";
      if (check.name === "health detail exposure" && detailExposed) status = "warn";
      const result = {
        name: check.name,
        status,
        status_code: response.status,
        latency_seconds: (performance.now() - started) / 1000,
        detail: protectedStatus ? "protected" : redactText(text.slice(0, 300))
      };
      results.push(result);
      run.publish({ type: "security_result", ...result });
    } catch (error) {
      const result = {
        name: check.name,
        status: "error",
        latency_seconds: (performance.now() - started) / 1000,
        detail: errorMessage(error)
      };
      results.push(result);
      run.publish({ type: "security_result", ...result });
    }
  }
  return results;
}

export function selectedChatModels(config: BenchConfig, request: RunRequest): string[] {
  const chatModels = config.models.chat || [];
  if (request.models?.length) {
    const selected = request.models.filter((model) => chatModels.includes(model));
    return selected.length ? selected : chatModels;
  }
  return chatModels;
}

function selectedLongContextModels(config: BenchConfig, request: RunRequest): string[] {
  const selected = selectedChatModels(config, request);
  const configured = config.models.long_context?.length ? config.models.long_context : selected;
  const filtered = configured.filter((model) => selected.includes(model));
  return filtered.length ? filtered : selected;
}

function loadProfile(config: BenchConfig, run: RunState): JsonObject {
  const name = run.request.mode === "standard" ? "standard" : "max-throughput";
  return obj(config.profiles[name]);
}

export function configuredPositiveInts(
  requestValues: number[] | undefined,
  requestValue: number | undefined,
  profile: JsonObject,
  listKey: string,
  scalarKey: string,
  defaultValue: number
): number[] {
  const requestList = positiveInts(requestValues || []);
  if (requestList.length) return Array.from(new Set(requestList)).sort((a, b) => a - b);
  const profileList = positiveInts(arr(profile[listKey]) || []);
  if (profileList.length) return Array.from(new Set(profileList)).sort((a, b) => a - b);
  const value = Number(requestValue ?? profile[scalarKey] ?? defaultValue);
  return [Math.max(1, Math.trunc(Number.isFinite(value) ? value : defaultValue))];
}

function configuredSteps(
  requestValues: number[] | undefined,
  profileValues: unknown[] | undefined,
  fallback: number[]
): number[] {
  const requestList = positiveInts(requestValues || []);
  if (requestList.length) return requestList;
  const profileList = positiveInts(profileValues || []);
  return profileList.length ? profileList : fallback;
}

function elapsedFromRecords(records: RequestRecord[]): number {
  if (!records.length) return 0.001;
  const ended = Math.max(...records.map((record) => record.ended_at));
  const started = Math.min(...records.map((record) => record.started_at));
  return Math.max(ended - started, 0.001);
}

function shouldStopStage(config: BenchConfig, run: RunState, metrics: JsonObject): boolean {
  const errorLimit = run.request.error_rate_threshold ?? config.thresholds.error_rate;
  const timeoutLimit = run.request.timeout_rate_threshold ?? config.thresholds.timeout_rate;
  const p95Limit = run.request.p95_e2e_threshold_seconds ?? config.thresholds.p95_e2e_seconds;
  return (
    Number(metrics.error_rate || 0) > errorLimit ||
    Number(metrics.timeout_rate || 0) > timeoutLimit ||
    Number(metrics.e2e_p95 || 0) > p95Limit
  );
}

function buildTotals(summary: RunSummary): JsonObject {
  const metrics = summary.stages.map((stage) => stage.metrics || {});
  return {
    completed_requests: metrics.reduce((total, item) => total + Number(item.completed_requests || 0), 0),
    failed_requests: metrics.reduce((total, item) => total + Number(item.failed_requests || 0), 0),
    best_rps: Math.max(0, ...metrics.map((item) => Number(item.rps || 0))),
    best_output_tokens_per_second: Math.max(0, ...metrics.map((item) => Number(item.output_tokens_per_second || 0))),
    best_vectors_per_second: Math.max(0, ...metrics.map((item) => Number(item.vectors_per_second || 0))),
    best_documents_per_second: Math.max(0, ...metrics.map((item) => Number(item.documents_per_second || 0)))
  };
}

export function buildLongContextPrompt(targetTokens: number): [string, string] {
  const marker = `TAIL_MARKER_${targetTokens}_END`;
  const intro = "Long context validation. Read all blocks and answer with a concise acknowledgement.\n";
  const tail = `\nThe final required marker is ${marker}. Return a short response.\n`;
  const filler = "context block: LiteLLM deployment benchmark capacity validation signal.\n";
  let prompt = intro;
  while (estimateTokens(prompt + tail) < targetTokens) {
    prompt += filler;
  }
  return [prompt + tail, marker];
}

function buildPrompt(): string {
  return "Reply with one sentence confirming that the LiteLLM deployment benchmark request succeeded.";
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractDeltaText(item: JsonObject): string {
  const choices = Array.isArray(item.choices) ? item.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const delta = (first as JsonObject).delta;
  if (!delta || typeof delta !== "object") return "";
  return typeof (delta as JsonObject).content === "string" ? String((delta as JsonObject).content) : "";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutSeconds: number,
  cancelSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const abortFromCancel = () => controller.abort(cancelSignal?.reason);
  if (cancelSignal?.aborted) abortFromCancel();
  else cancelSignal?.addEventListener("abort", abortFromCancel, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    cancelSignal?.removeEventListener("abort", abortFromCancel);
  }
}

async function* readSseLines(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trimEnd();
      buffer = buffer.slice(index + 1);
      if (line) yield line;
      index = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

function timestampId(): string {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function positiveInts(values: unknown[]): number[] {
  return values.map(Number).filter((value) => Number.isFinite(value) && value > 0).map((value) => Math.trunc(value));
}

function arr(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function obj(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
