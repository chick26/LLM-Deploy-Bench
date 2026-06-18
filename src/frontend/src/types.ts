export type RunMode = "smoke" | "standard" | "max-throughput" | "raw-check";

export interface PaddleOCRLayoutParsingCheck {
  name: string;
  path?: string;
  url?: string;
  method?: string;
  file?: string;
  file_path?: string;
  file_type?: number;
  return_markdown_images?: boolean;
  visualize?: boolean;
}

export interface BenchConfig {
  litellm: {
    base_url: string;
    base_url_env?: string;
    api_key_present: boolean;
    master_key_present: boolean;
    api_key_env: string;
    master_key_env: string;
  };
  models: {
    chat: string[];
    embedding: string[];
    rerank: string[];
    long_context?: string[];
  };
  profiles: Record<
    string,
    {
      duration_seconds: number;
      concurrency_steps: number[];
      max_output_tokens: number;
      embedding?: {
        duration_seconds: number;
        concurrency_steps: number[];
        batch_sizes?: number[];
        batch_size?: number;
      };
      rerank?: {
        duration_seconds: number;
        concurrency_steps: number[];
        document_counts?: number[];
        document_count?: number;
      };
      long_context?: {
        token_targets: number[];
        extreme_token_targets?: number[];
        concurrency_steps: number[];
        max_output_tokens: number;
        request_timeout_seconds: number;
      };
    }
  >;
  thresholds: {
    error_rate: number;
    timeout_rate: number;
    p95_e2e_seconds: number;
    request_timeout_seconds: number;
  };
  paddleocr?: {
    layout_parsing?: PaddleOCRLayoutParsingCheck[];
  };
  runtime?: Record<string, unknown>;
}

export interface Metrics {
  endpoint_type?: string;
  total_requests?: number;
  completed_requests?: number;
  failed_requests?: number;
  timeout_requests?: number;
  error_rate?: number;
  timeout_rate?: number;
  rps?: number;
  input_tokens_per_second?: number;
  output_tokens_per_second?: number;
  total_tokens_per_second?: number;
  ttft_avg?: number | null;
  ttft_p50?: number | null;
  ttft_p95?: number | null;
  ttft_p99?: number | null;
  e2e_avg?: number | null;
  e2e_p50?: number | null;
  e2e_p95?: number | null;
  e2e_p99?: number | null;
  itl_avg?: number | null;
  itl_p95?: number | null;
  vectors_per_second?: number;
  embedding_batch_size?: number | null;
  embedding_dimension?: number | null;
  documents_per_second?: number;
  rerank_document_count?: number | null;
  rerank_top_hit?: number;
  context_target_tokens?: number;
  context_marker_found?: boolean | null;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface Artifact {
  name: string;
  path: string;
  url: string;
}

export interface StageResult {
  stage?: string;
  model?: string;
  endpoint_type?: string;
  concurrency?: number;
  metrics?: Metrics;
}

export interface CheckResult {
  name?: string;
  status?: string;
  status_code?: number;
  latency_seconds?: number;
  detail?: string;
  path?: string;
  url?: string;
  level?: string;
  message?: string;
}

export interface RunSummary {
  run_id?: string;
  mode?: RunMode;
  status?: string;
  started_at?: string;
  finished_at?: string;
  stages?: StageResult[];
  service_checks?: CheckResult[];
  security?: CheckResult[];
  totals?: Record<string, number>;
  artifacts?: Artifact[];
  error?: string;
}

export interface RunEvent {
  ts: number;
  run_id: string;
  type: string;
  level?: "info" | "warn" | "error";
  stage?: string;
  model?: string;
  endpoint_type?: string;
  concurrency?: number;
  status?: string;
  status_code?: number;
  name?: string;
  message?: string;
  detail?: string;
  latency_seconds?: number;
  elapsed_seconds?: number;
  metrics?: Metrics;
  final?: boolean;
  artifacts?: Artifact[];
  summary?: RunSummary;
}

export interface RunPayload {
  mode: RunMode;
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
