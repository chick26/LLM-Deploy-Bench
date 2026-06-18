import { CheckCircleOutlined, ClockCircleOutlined, DownloadOutlined } from "@ant-design/icons";
import { Button, Space, Table, Tag, Typography } from "antd";
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
import type { Artifact, RunSummary } from "../types";
import type { StageRow, ThroughputGroup } from "../viewTypes";
import {
  numberValue,
  renderBoolean,
  renderNumber,
  renderPercent,
  statusColor,
  sumMetric
} from "../utils/format";
import { buildConcurrencyThroughputGroups } from "../utils/metrics";

const { Text } = Typography;

type FinalReportProps = {
  artifacts: Artifact[];
  rows: StageRow[];
  runId: string | null;
  summary: RunSummary | null;
};

export function FinalReport({ artifacts, rows, runId, summary }: FinalReportProps) {
  const totals = summary?.totals;
  const completed = totals?.completed_requests ?? sumMetric(rows, "completed_requests");
  const failed = totals?.failed_requests ?? sumMetric(rows, "failed_requests");
  const bestRps = totals?.best_rps ?? Math.max(0, ...rows.map((row) => numberValue(row.rps)));
  const bestOutputTps =
    totals?.best_output_tokens_per_second ??
    Math.max(0, ...rows.map((row) => numberValue(row.output_tokens_per_second)));
  const throughputGroups = buildConcurrencyThroughputGroups(rows);

  if (!summary && !rows.length && !artifacts.length) {
    return <div className="empty">还没有可展示的最终报告</div>;
  }

  return (
    <div className="report-stack">
      <div className="report-cards">
        <ReportCard label="完成请求" value={completed} />
        <ReportCard label="失败请求" value={failed} />
        <ReportCard label="最佳 RPS" value={bestRps} precision={2} />
        <ReportCard label="最佳输出 tok/s" value={bestOutputTps} precision={2} />
      </div>

      <div className="chart-shell compact">
        <div className="chart-header">
          <div>
            <Text className="overview-kicker">Report Chart</Text>
            <h2>并发吞吐曲线</h2>
          </div>
          <Tag color={statusColor(summary?.status || "idle")}>{summary?.status || "preview"}</Tag>
        </div>
        {throughputGroups.length ? (
          <ThroughputCharts groups={throughputGroups} />
        ) : (
          <div className="empty">报告里暂无可绘制的吞吐数据</div>
        )}
      </div>

      <div className="table-panel">
        <div className="chart-header">
          <div>
            <Text className="overview-kicker">Model Matrix</Text>
            <h2>模型结果表</h2>
          </div>
          {summary?.finished_at && <Text type="secondary">{new Date(summary.finished_at).toLocaleString()}</Text>}
        </div>
        <ModelTable rows={rows} />
      </div>

      <ArtifactButtons artifacts={artifacts} runId={runId} />
    </div>
  );
}

function ThroughputCharts({ groups }: { groups: ThroughputGroup[] }) {
  return (
    <div className="throughput-grid">
      {groups.map((group) => (
        <div className="throughput-card" key={group.workload}>
          <div className="throughput-card-header">
            <div>
              <Text className="overview-kicker">{group.metricName}</Text>
              <strong>{group.title}</strong>
            </div>
            <Tag>{group.unit}</Tag>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={group.data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d8e1ea" />
              <XAxis dataKey="label" stroke="#637183" minTickGap={18} />
              <YAxis stroke="#637183" />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #d8e1ea" }} />
              <Legend />
              {group.series.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.color}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  strokeWidth={2}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}

function ReportCard({
  label,
  value,
  precision = 0
}: {
  label: string;
  value: number;
  precision?: number;
}) {
  return (
    <div className="report-card">
      <Text type="secondary">{label}</Text>
      <strong>{value.toFixed(precision)}</strong>
    </div>
  );
}

function ModelTable({ rows }: { rows: StageRow[] }) {
  return (
    <Table
      className="model-table"
      size="small"
      tableLayout="fixed"
      pagination={{
        pageSize: 8,
        showSizeChanger: false,
        hideOnSinglePage: false,
        position: ["bottomCenter"],
        showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`
      }}
      dataSource={rows}
      columns={[
        { title: "类型", dataIndex: "endpoint_type", fixed: "left", width: 78, ellipsis: true },
        { title: "模型", dataIndex: "model", fixed: "left", width: 150, ellipsis: true },
        { title: "阶段", dataIndex: "stage", width: 116, ellipsis: true },
        { title: "并发", dataIndex: "concurrency", width: 68 },
        { title: "Batch", dataIndex: "embedding_batch_size", width: 78 },
        { title: "候选数", dataIndex: "rerank_document_count", width: 78 },
        { title: "完成", dataIndex: "completed_requests", width: 72 },
        { title: "失败", dataIndex: "failed_requests", width: 72 },
        { title: "RPS", dataIndex: "rps", width: 86, render: renderNumber },
        { title: "Vectors/s", dataIndex: "vectors_per_second", width: 104, render: renderNumber },
        { title: "维度", dataIndex: "embedding_dimension", width: 76 },
        { title: "Docs/s", dataIndex: "documents_per_second", width: 90, render: renderNumber },
        { title: "Top Hit", dataIndex: "rerank_top_hit", width: 90, render: renderPercent },
        { title: "上下文", dataIndex: "context_target_tokens", width: 96 },
        { title: "Marker", dataIndex: "context_marker_found", width: 88, render: renderBoolean },
        { title: "输入 tok", dataIndex: "prompt_tokens", width: 90 },
        { title: "总 tok", dataIndex: "total_tokens", width: 86 },
        { title: "输出 tok/s", dataIndex: "output_tokens_per_second", width: 104, render: renderNumber },
        { title: "TTFT p95", dataIndex: "ttft_p95", width: 96, render: renderNumber },
        { title: "E2E p95", dataIndex: "e2e_p95", width: 96, render: renderNumber },
        { title: "错误率", dataIndex: "error_rate", width: 86, render: renderPercent }
      ]}
      scroll={{ x: 1840, y: 360 }}
    />
  );
}

function ArtifactButtons({ artifacts, runId }: { artifacts: Artifact[]; runId: string | null }) {
  const downloadableArtifacts = artifacts.filter((artifact) => artifact.name !== "report.html");
  if (!downloadableArtifacts.length) {
    return (
      <div className="artifact-bar muted">
        <ClockCircleOutlined /> {runId ? `Run ${runId} 仍在生成报告` : "暂无测试结果"}
      </div>
    );
  }
  return (
    <div className="artifact-bar">
      <CheckCircleOutlined className="ok" />
      <span>报告已生成</span>
      <Space wrap>
        {downloadableArtifacts.map((artifact) => (
          <Button key={artifact.name} icon={<DownloadOutlined />} href={artifact.url} target="_blank">
            {artifact.name}
          </Button>
        ))}
      </Space>
    </div>
  );
}
