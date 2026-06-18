import { useEffect, useRef, useState } from "react";
import { cancelRun, fetchConfig, startRun } from "../api";
import { terminalRunEventTypes } from "../constants";
import type { Artifact, BenchConfig, Metrics, RunEvent, RunMode, RunPayload, RunSummary } from "../types";
import type { MetricPoint } from "../viewTypes";
import { round } from "../utils/format";

type MessageApi = {
  error: (content: string) => void;
  warning: (content: string) => void;
};

export function useBenchRun(message: MessageApi) {
  const [config, setConfig] = useState<BenchConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<RunMode>("standard");
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState("idle");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [latestMetrics, setLatestMetrics] = useState<Metrics>({});
  const [metricSeries, setMetricSeries] = useState<MetricPoint[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);

  const running = ["starting", "running", "cancelling"].includes(runStatus);

  useEffect(() => {
    fetchConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
        if (!nextConfig.profiles.standard && nextConfig.profiles.smoke) {
          setMode("smoke");
        }
      })
      .catch((error) => message.error(error.message))
      .finally(() => setLoading(false));
  }, [message]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function handleStart() {
    const payload: RunPayload = { mode };
    try {
      eventSourceRef.current?.close();
      setEvents([]);
      setMetricSeries([]);
      setArtifacts([]);
      setRunSummary(null);
      setLatestMetrics({});
      setRunStartedAt(Date.now());
      setRunStatus("starting");

      const run = await startRun(payload);
      setRunId(run.run_id);
      setRunStatus(run.status);

      const source = new EventSource(`/api/runs/${run.run_id}/events`);
      eventSourceRef.current = source;
      source.onmessage = (incoming) => {
        const event = JSON.parse(incoming.data) as RunEvent;
        setEvents((current) => [...current, event]);

        if (event.type === "started") {
          setRunStatus(event.status || "running");
          setRunStartedAt(event.ts * 1000);
        }

        if (event.type === "metrics" && event.metrics) {
          const metrics = event.metrics;
          setLatestMetrics(metrics);
          setMetricSeries((current) => [
            ...current.slice(-180),
            {
              t: new Date(event.ts * 1000).toLocaleTimeString(),
              rps: round(metrics.rps),
              outputTps: round(metrics.output_tokens_per_second),
              p95: round(metrics.e2e_p95),
              vectors: round(metrics.vectors_per_second),
              docs: round(metrics.documents_per_second),
              workload: event.endpoint_type || metrics.endpoint_type || event.stage || "-",
              model: event.model || "-"
            }
          ]);
        }

        if (event.type === "artifacts" && event.artifacts) {
          setArtifacts(event.artifacts);
        }

        if (terminalRunEventTypes.includes(event.type)) {
          setRunStatus(event.type);
          if (event.summary) {
            setRunSummary(event.summary);
          }
          if (event.summary?.artifacts) {
            setArtifacts(event.summary.artifacts);
          }
          source.close();
        }
      };
      source.onerror = () => {
        message.warning("实时连接中断，可在 runs 目录查看已生成内容");
        source.close();
      };
    } catch (error) {
      setRunStatus("idle");
      setRunStartedAt(null);
      message.error(error instanceof Error ? error.message : "启动失败");
    }
  }

  async function handleCancel() {
    if (!runId) return;
    await cancelRun(runId);
    setRunStatus("cancelling");
  }

  return {
    artifacts,
    config,
    events,
    handleCancel,
    handleStart,
    latestMetrics,
    loading,
    metricSeries,
    mode,
    runId,
    runStartedAt,
    running,
    runStatus,
    runSummary,
    setMode,
    tick
  };
}
