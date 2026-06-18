import type { BenchConfig, RunEvent, RunMode, StageResult } from "../types";
import type { StageRow, ThroughputGroup, WorkloadAggregate } from "../viewTypes";
import {
  formatTokenTarget,
  metricValue,
  normalizeWorkload,
  numberValue,
  round,
  workloadLabel
} from "./format";

export function buildModeOverview(config: BenchConfig | null, mode: RunMode) {
  if (!config) return ["读取 bench.yaml"];
  if (mode === "raw-check") {
    return [`服务检查 ${config.paddleocr?.layout_parsing?.length || 0}`, "安全检查", "不跑压测"];
  }

  const profile = config.profiles[profileKeyForMode(mode)];
  if (!profile) return ["模板未配置"];

  const longTargets = profile.long_context?.token_targets || [];
  const embeddingBatchSizes =
    profile.embedding?.batch_sizes || (profile.embedding?.batch_size ? [profile.embedding.batch_size] : []);
  const rerankDocumentCounts =
    profile.rerank?.document_counts || (profile.rerank?.document_count ? [profile.rerank.document_count] : []);

  return [
    `Chat ${config.models.chat.length} 模型`,
    `Chat 并发 ${profile.concurrency_steps.join("/")}`,
    `Embedding ${config.models.embedding.length} 模型`,
    `Embedding batch ${embeddingBatchSizes.join("/") || "未配置"}`,
    `Rerank ${config.models.rerank.length} 模型`,
    `Rerank docs ${rerankDocumentCounts.join("/") || "未配置"}`,
    `长上下文 ${longTargets.map(formatTokenTarget).join("/") || "未配置"}`,
    `OCR ${config.paddleocr?.layout_parsing?.length || 0}`
  ];
}

export function metricsEventToRow(event: RunEvent, index: number): StageRow {
  return {
    key: `${event.stage || "stage"}-${event.model || "model"}-${event.concurrency ?? index}-${index}`,
    stage: event.stage,
    model: event.model,
    endpoint_type: event.endpoint_type || event.metrics?.endpoint_type,
    concurrency: event.concurrency,
    ...event.metrics
  };
}

export function stagesToRows(stages: StageResult[] = []): StageRow[] {
  return stages.map((stage, index) => ({
    key: `${stage.stage || "stage"}-${stage.model || "model"}-${stage.concurrency ?? index}-${index}`,
    stage: stage.stage,
    model: stage.model,
    endpoint_type: stage.endpoint_type || stage.metrics?.endpoint_type,
    concurrency: stage.concurrency,
    ...stage.metrics
  }));
}

export function buildConcurrencyThroughputGroups(rows: StageRow[]): ThroughputGroup[] {
  const workloadRows = new Map<string, StageRow[]>();
  rows.forEach((row) => {
    const workload = normalizeWorkload(String(row.endpoint_type || row.stage || "unknown"));
    const group = workloadRows.get(workload) || [];
    group.push(row);
    workloadRows.set(workload, group);
  });

  const order = ["chat", "embedding", "rerank", "long_context"];
  return Array.from(workloadRows.entries())
    .sort(([a], [b]) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    })
    .map(([workload, groupRows]) => buildThroughputGroup(workload, groupRows))
    .filter((group): group is ThroughputGroup => Boolean(group));
}

export function buildWorkloadAggregates(events: RunEvent[]): WorkloadAggregate[] {
  const latestByModel = new Map<string, RunEvent>();
  events
    .filter((event) => event.type === "metrics" && event.metrics)
    .forEach((event) => {
      const workload = normalizeWorkload(
        event.endpoint_type || event.metrics?.endpoint_type || event.stage || "unknown"
      );
      const key = `${workload}:${event.model || "default"}`;
      latestByModel.set(key, event);
    });

  const groups = new Map<string, WorkloadAggregate>();
  latestByModel.forEach((event) => {
    const metrics = event.metrics || {};
    const workload = normalizeWorkload(event.endpoint_type || metrics.endpoint_type || event.stage || "unknown");
    const current =
      groups.get(workload) ||
      ({
        workload,
        label: workloadLabel(workload),
        models: 0,
        rps: 0,
        outputTps: 0,
        vectors: 0,
        docs: 0,
        p95: 0,
        errorRate: 0
      } satisfies WorkloadAggregate);
    current.models += 1;
    current.rps += metricValue(metrics, "rps");
    current.outputTps += metricValue(metrics, "output_tokens_per_second");
    current.vectors += metricValue(metrics, "vectors_per_second");
    current.docs += metricValue(metrics, "documents_per_second");
    current.p95 = Math.max(current.p95, metricValue(metrics, "e2e_p95"));
    current.errorRate = Math.max(current.errorRate, metricValue(metrics, "error_rate"));
    groups.set(workload, current);
  });

  const order = ["chat", "long_context", "embedding", "rerank", "service", "security", "unknown"];
  return Array.from(groups.values()).sort((a, b) => {
    const aIndex = order.indexOf(a.workload);
    const bIndex = order.indexOf(b.workload);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
}

export function aggregateWorkloadMetrics(workloads: WorkloadAggregate[]) {
  return workloads.reduce(
    (total, workload) => ({
      rps: total.rps + workload.rps,
      outputTps: total.outputTps + workload.outputTps,
      vectors: total.vectors + workload.vectors,
      docs: total.docs + workload.docs,
      p95: Math.max(total.p95, workload.p95),
      errorRate: Math.max(total.errorRate, workload.errorRate)
    }),
    { rps: 0, outputTps: 0, vectors: 0, docs: 0, p95: 0, errorRate: 0 }
  );
}

function profileKeyForMode(mode: RunMode) {
  if (mode === "max-throughput") return "max-throughput";
  if (mode === "smoke") return "smoke";
  return "standard";
}

function buildThroughputGroup(workload: string, rows: StageRow[]): ThroughputGroup | null {
  const benchmarkRows = rows.some((row) => row.stage !== "smoke")
    ? rows.filter((row) => row.stage !== "smoke")
    : rows;
  const metric = throughputMetricForWorkload(workload);
  const usableRows = benchmarkRows.filter((row) => numberValue(row[metric.field]) > 0);
  if (!usableRows.length) return null;

  const models = Array.from(new Set(usableRows.map((row) => String(row.model || "default"))));
  const series = models.map((model, index) => ({
    key: `series_${index}`,
    label: model,
    color: lineColor(index)
  }));
  const modelToKey = new Map(series.map((item) => [item.label, item.key]));
  const points = new Map<string, Record<string, number | string>>();
  const pointOrder = new Map<string, number>();

  usableRows.forEach((row) => {
    const x = throughputXAxis(row, workload);
    const model = String(row.model || "default");
    const seriesKey = modelToKey.get(model);
    if (!seriesKey) return;
    const current = points.get(x.label) || { label: x.label };
    const value = round(numberValue(row[metric.field]));
    current[seriesKey] = Math.max(numberValue(current[seriesKey]), value);
    points.set(x.label, current);
    pointOrder.set(x.label, Math.min(pointOrder.get(x.label) ?? x.order, x.order));
  });

  const data = Array.from(points.values()).sort(
    (a, b) => (pointOrder.get(String(a.label)) || 0) - (pointOrder.get(String(b.label)) || 0)
  );

  return {
    workload,
    title: `${workloadLabel(workload)} 并发吞吐`,
    unit: metric.unit,
    metricName: metric.name,
    series,
    data
  };
}

function throughputMetricForWorkload(workload: string): {
  field: string;
  name: string;
  unit: string;
} {
  if (workload === "embedding") {
    return { field: "vectors_per_second", name: "Vectors per second", unit: "vec/s" };
  }
  if (workload === "rerank") {
    return { field: "documents_per_second", name: "Documents per second", unit: "doc/s" };
  }
  if (workload === "chat" || workload === "long_context") {
    return { field: "output_tokens_per_second", name: "Output tokens per second", unit: "tok/s" };
  }
  return { field: "rps", name: "Requests per second", unit: "req/s" };
}

function throughputXAxis(row: StageRow, workload: string) {
  const concurrency = Number(row.concurrency || 1);
  if (workload === "long_context") {
    const target = numberValue(row.context_target_tokens);
    const targetLabel = target ? formatTokenTarget(target) : "ctx";
    return {
      label: `${targetLabel}/c${concurrency}`,
      order: target * 1000 + concurrency
    };
  }
  if (workload === "embedding") {
    const batchSize = numberValue(row.embedding_batch_size);
    return {
      label: `${batchSize ? `b${batchSize}` : "batch"}/c${concurrency}`,
      order: batchSize * 1000 + concurrency
    };
  }
  if (workload === "rerank") {
    const documentCount = numberValue(row.rerank_document_count);
    return {
      label: `${documentCount ? `d${documentCount}` : "docs"}/c${concurrency}`,
      order: documentCount * 1000 + concurrency
    };
  }
  return {
    label: `c${concurrency}`,
    order: concurrency
  };
}

function lineColor(index: number) {
  const colors = [
    "#00a88e",
    "#6750e8",
    "#f0a429",
    "#df4e5b",
    "#2f80ed",
    "#9b51e0",
    "#0f766e",
    "#b7791f"
  ];
  return colors[index % colors.length];
}
