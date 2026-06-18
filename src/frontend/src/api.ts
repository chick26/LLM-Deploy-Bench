import type { BenchConfig, RunPayload } from "./types";

export async function fetchConfig(): Promise<BenchConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(`config failed: ${response.status}`);
  }
  return response.json();
}

export async function startRun(payload: RunPayload): Promise<{ run_id: string; status: string }> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `start failed: ${response.status}`);
  }
  return response.json();
}

export async function cancelRun(runId: string): Promise<void> {
  await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
}

