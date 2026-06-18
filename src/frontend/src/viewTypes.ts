export type StageRow = Record<string, unknown> & {
  key: string;
  stage?: string;
  model?: string;
  endpoint_type?: string;
  concurrency?: number;
};

export type MetricPoint = {
  t: string;
  rps: number;
  outputTps: number;
  p95: number;
  vectors: number;
  docs: number;
  workload: string;
  model: string;
};

export type MetricItem = {
  label: string;
  value: number | string;
  suffix?: string;
  precision?: number;
};

export type WorkloadAggregate = {
  workload: string;
  label: string;
  models: number;
  rps: number;
  outputTps: number;
  vectors: number;
  docs: number;
  p95: number;
  errorRate: number;
};

export type ThroughputSeries = {
  key: string;
  label: string;
  color: string;
};

export type ThroughputGroup = {
  workload: string;
  title: string;
  unit: string;
  metricName: string;
  series: ThroughputSeries[];
  data: Array<Record<string, number | string>>;
};
