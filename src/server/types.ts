export type RunMode = "smoke" | "standard" | "max-throughput" | "raw-check";

export type JsonObject = Record<string, unknown>;

export interface RunRequest {
  mode?: RunMode;
  models?: string[];
  concurrency_steps?: number[];
  duration_seconds?: number;
  max_output_tokens?: number;
  request_timeout_seconds?: number;
  embedding_concurrency_steps?: number[];
  embedding_batch_sizes?: number[];
  embedding_batch_size?: number;
  rerank_concurrency_steps?: number[];
  rerank_document_counts?: number[];
  rerank_document_count?: number;
  long_context_token_targets?: number[];
  include_extreme_context?: boolean;
  error_rate_threshold?: number;
  timeout_rate_threshold?: number;
  p95_e2e_threshold_seconds?: number;
}

export interface BenchConfig {
  litellm: {
    base_url: string;
    base_url_env?: string;
    api_key_env: string;
    master_key_env: string;
  };
  models: {
    chat: string[];
    embedding: string[];
    rerank: string[];
    long_context?: string[];
  };
  profiles: Record<string, JsonObject>;
  thresholds: {
    error_rate: number;
    timeout_rate: number;
    p95_e2e_seconds: number;
    request_timeout_seconds: number;
  };
  paddleocr?: JsonObject;
  runtime?: JsonObject;
}

export interface RequestRecord {
  run_id: string;
  stage: string;
  model: string;
  endpoint_type: string;
  concurrency: number;
  started_at: number;
  ended_at: number;
  success: boolean;
  status_code?: number | null;
  error?: string | null;
  timed_out?: boolean;
  ttft_seconds?: number | null;
  e2e_seconds?: number | null;
  itl_seconds?: number[];
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  usage_source?: string;
  context_marker_found?: boolean | null;
}

export interface StageResult {
  stage: string;
  model: string;
  endpoint_type: string;
  concurrency: number;
  metrics: JsonObject;
}

export interface Artifact {
  name: string;
  path: string;
  url: string;
}

export interface RunSummary {
  run_id: string;
  mode: RunMode;
  status: string;
  started_at?: string;
  finished_at?: string;
  stages: StageResult[];
  security: JsonObject[];
  service_checks: JsonObject[];
  artifacts: Artifact[];
  totals?: JsonObject;
  error?: string;
}

export interface RunEvent extends JsonObject {
  ts?: number;
  run_id?: string;
  type: string;
}

export type ActiveRunRequest = RunRequest & { mode: RunMode };
