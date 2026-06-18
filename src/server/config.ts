import { existsSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import YAML from "yaml";
import type { BenchConfig, JsonObject } from "./types.js";

export const defaultConfig: BenchConfig = {
  litellm: {
    base_url: "http://127.0.0.1:4000",
    base_url_env: "LITELLM_BASE_URL",
    api_key_env: "LITELLM_API_KEY",
    master_key_env: "LITELLM_MASTER_KEY"
  },
  models: {
    chat: ["qwen3-32b", "qwen3-vl-32b", "qwen3.6-27b-npu", "qwen3.6-27b"],
    embedding: ["qwen3-embedding-4b"],
    rerank: ["qwen3-reranker-4b"],
    long_context: ["qwen3.6-27b-npu", "qwen3.6-27b"]
  },
  profiles: {
    smoke: {
      duration_seconds: 10,
      concurrency_steps: [1],
      max_output_tokens: 32
    },
    standard: {
      duration_seconds: 30,
      concurrency_steps: [1, 2, 4, 8, 16],
      max_output_tokens: 128,
      embedding: {
        duration_seconds: 30,
        concurrency_steps: [1, 2, 4, 8, 16, 32],
        batch_sizes: [16, 32, 64, 128]
      },
      rerank: {
        duration_seconds: 30,
        concurrency_steps: [1, 2, 4, 8, 16, 32],
        document_counts: [16, 32, 64, 100]
      },
      long_context: {
        token_targets: [8192, 32768, 131072],
        extreme_token_targets: [262144],
        concurrency_steps: [1],
        max_output_tokens: 256,
        request_timeout_seconds: 300
      }
    },
    "max-throughput": {
      duration_seconds: 60,
      concurrency_steps: [1, 2, 4, 8, 16, 32, 64, 128],
      max_output_tokens: 256,
      embedding: {
        duration_seconds: 60,
        concurrency_steps: [1, 2, 4, 8, 16, 32, 64],
        batch_sizes: [16, 32, 64, 128]
      },
      rerank: {
        duration_seconds: 60,
        concurrency_steps: [1, 2, 4, 8, 16, 32, 64],
        document_counts: [16, 32, 64, 100]
      },
      long_context: {
        token_targets: [8192, 32768, 131072],
        extreme_token_targets: [262144],
        concurrency_steps: [1, 2],
        max_output_tokens: 512,
        request_timeout_seconds: 600
      }
    }
  },
  thresholds: {
    error_rate: 0.05,
    timeout_rate: 0.01,
    p95_e2e_seconds: 120,
    request_timeout_seconds: 180
  },
  paddleocr: {
    layout_parsing: [
      {
        name: "paddleocr-vl",
        path: "/layout-parsing",
        method: "POST",
        file: "https://paddle-model-ecology.bj.bcebos.com/paddlex/imgs/demo_image/paddleocr_vl_demo.png",
        file_type: 1,
        return_markdown_images: false,
        visualize: false
      }
    ]
  },
  runtime: { run_location: "mac" }
};

export function deepMerge<T extends JsonObject>(base: T, override: JsonObject): T {
  const merged: JsonObject = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key] as JsonObject, value as JsonObject);
    } else {
      merged[key] = value;
    }
  });
  return merged as T;
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function loadConfig(path = "bench.yaml"): BenchConfig {
  const configPath = resolve(path);
  loadDotenv({ path: resolve(dirname(configPath), ".env"), override: false });
  const loaded = existsSync(configPath) ? ((YAML.parse(readFileSync(configPath, "utf8")) || {}) as JsonObject) : {};
  return applyEnvironmentOverrides(deepMerge(defaultConfig as unknown as JsonObject, loaded) as unknown as BenchConfig);
}

export function initConfig(path = "bench.yaml"): string {
  const target = resolve(path);
  if (existsSync(target)) {
    return target;
  }
  const example = resolve("bench.yaml.example");
  if (existsSync(example)) {
    copyFileSync(example, target);
  } else {
    writeFileSync(target, YAML.stringify(defaultConfig), "utf8");
  }
  return target;
}

export function publicConfig(config: BenchConfig): JsonObject {
  const baseUrlEnv = config.litellm.base_url_env || "LITELLM_BASE_URL";
  const apiKeyEnv = config.litellm.api_key_env || "LITELLM_API_KEY";
  const masterKeyEnv = config.litellm.master_key_env || "LITELLM_MASTER_KEY";
  return {
    litellm: {
      base_url: config.litellm.base_url,
      base_url_env: baseUrlEnv,
      api_key_present: Boolean(process.env[apiKeyEnv]),
      master_key_present: Boolean(process.env[masterKeyEnv]),
      api_key_env: apiKeyEnv,
      master_key_env: masterKeyEnv
    },
    models: config.models,
    profiles: config.profiles,
    thresholds: config.thresholds,
    paddleocr: config.paddleocr || {},
    runtime: config.runtime || {}
  };
}

export function authHeaders(config: BenchConfig, admin = false): Record<string, string> {
  const envName = admin ? config.litellm.master_key_env : config.litellm.api_key_env;
  const fallbackName = config.litellm.api_key_env || "LITELLM_API_KEY";
  const value = process.env[envName] || (admin ? process.env[fallbackName] : undefined);
  return value ? { Authorization: `Bearer ${value}` } : {};
}

function applyEnvironmentOverrides(config: BenchConfig): BenchConfig {
  const baseUrlEnv = config.litellm.base_url_env || "LITELLM_BASE_URL";
  const baseUrl = process.env[baseUrlEnv]?.trim();
  return {
    ...config,
    litellm: {
      ...config.litellm,
      base_url: baseUrl || config.litellm.base_url,
      base_url_env: baseUrlEnv
    }
  };
}
