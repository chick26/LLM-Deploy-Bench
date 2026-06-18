import { Space, Tag, Typography } from "antd";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { Metrics } from "../types";
import type { MetricPoint } from "../viewTypes";
import { metricValue } from "../utils/format";

const { Text } = Typography;

type LiveDashboardProps = {
  activePoint?: MetricPoint;
  data: MetricPoint[];
  latestMetrics: Metrics;
};

export function LiveDashboard({ activePoint, data, latestMetrics }: LiveDashboardProps) {
  return (
    <div className="live-stack">
      <div className="chart-header">
        <div>
          <Text className="overview-kicker">Live Telemetry</Text>
          <h2>实时吞吐与延迟</h2>
        </div>
        <Space wrap>
          <Tag color="cyan">{activePoint?.workload || latestMetrics.endpoint_type || "workload"}</Tag>
          <Tag color="purple">{activePoint?.model || "model"}</Tag>
        </Space>
      </div>
      <div className="chart-shell">
        {data.length ? (
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d8e1ea" />
              <XAxis dataKey="t" minTickGap={36} stroke="#637183" />
              <YAxis stroke="#637183" />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #d8e1ea" }} />
              <Legend />
              <Line type="monotone" dataKey="rps" name="RPS" stroke="#00a88e" dot={false} strokeWidth={2} />
              <Line
                type="monotone"
                dataKey="outputTps"
                name="输出 tok/s"
                stroke="#f0a429"
                dot={false}
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="p95"
                name="E2E p95"
                stroke="#6750e8"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty">启动测试后实时曲线会显示在这里</div>
        )}
      </div>
      <div className="signal-grid">
        <Signal label="最近 RPS" value={metricValue(latestMetrics, "rps")} suffix="req/s" />
        <Signal
          label="输出 tok/s"
          value={metricValue(latestMetrics, "output_tokens_per_second")}
          suffix="tok/s"
        />
        <Signal label="Vectors/s" value={metricValue(latestMetrics, "vectors_per_second")} suffix="vec/s" />
        <Signal label="Docs/s" value={metricValue(latestMetrics, "documents_per_second")} suffix="doc/s" />
      </div>
    </div>
  );
}

function Signal({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="signal-card">
      <Text type="secondary">{label}</Text>
      <strong>
        {value.toFixed(2)} <span>{suffix}</span>
      </strong>
    </div>
  );
}
