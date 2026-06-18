import { Alert, App as AntApp, Layout, Space, Tabs, Tag, Typography } from "antd";
import { useMemo } from "react";
import { modeLabels } from "../constants";
import { useBenchRun } from "../hooks/useBenchRun";
import type { MetricItem } from "../viewTypes";
import {
  elapsedRuntimeSeconds,
  metricValue,
  sumMetric
} from "../utils/format";
import {
  aggregateWorkloadMetrics,
  buildModeOverview,
  buildWorkloadAggregates,
  metricsEventToRow,
  stagesToRows
} from "../utils/metrics";
import { FinalReport } from "./FinalReport";
import { LiveDashboard } from "./LiveDashboard";
import { MetricRail } from "./MetricRail";
import { TopBar } from "./TopBar";

const { Sider, Content } = Layout;
const { Text } = Typography;

export function BenchConsole() {
  const { message } = AntApp.useApp();
  const run = useBenchRun(message);

  const liveRows = useMemo(
    () =>
      run.events
        .filter((event) => event.type === "metrics" && event.final)
        .map((event, index) => metricsEventToRow(event, index)),
    [run.events]
  );

  const reportRows = useMemo(() => {
    if (run.runSummary?.stages?.length) {
      return stagesToRows(run.runSummary.stages);
    }
    return liveRows;
  }, [liveRows, run.runSummary]);

  const overview = useMemo(() => buildModeOverview(run.config, run.mode), [run.config, run.mode]);
  const totals = run.runSummary?.totals;
  const completedRequests =
    totals?.completed_requests ??
    (sumMetric(liveRows, "completed_requests") || metricValue(run.latestMetrics, "completed_requests"));
  const failedRequests =
    totals?.failed_requests ??
    (sumMetric(liveRows, "failed_requests") || metricValue(run.latestMetrics, "failed_requests"));
  const elapsedSeconds = elapsedRuntimeSeconds(run.runStartedAt, run.runSummary, run.tick);
  const activePoint = run.metricSeries.length ? run.metricSeries[run.metricSeries.length - 1] : undefined;
  const workloadAggregates = useMemo(() => buildWorkloadAggregates(run.events), [run.events]);
  const aggregateMetrics = useMemo(
    () => aggregateWorkloadMetrics(workloadAggregates),
    [workloadAggregates]
  );

  const metricItems: MetricItem[] = [
    { label: "完成请求", value: completedRequests, precision: 0 },
    { label: "失败请求", value: failedRequests, precision: 0 },
    { label: "总 RPS", value: aggregateMetrics.rps, suffix: "req/s", precision: 2 },
    { label: "最差 p95", value: aggregateMetrics.p95, suffix: "s", precision: 2 }
  ];

  return (
    <Layout className="shell">
      <TopBar
        config={run.config}
        loading={run.loading}
        mode={run.mode}
        runId={run.runId}
        running={run.running}
        runStatus={run.runStatus}
        onCancel={run.handleCancel}
        onModeChange={run.setMode}
        onStart={run.handleStart}
      />

      <div className="overview-strip">
        <div>
          <Text className="overview-kicker">当前模板</Text>
          <strong>{modeLabels[run.mode]}</strong>
        </div>
        <Space size={[8, 8]} wrap>
          {overview.map((item) => (
            <Tag key={item} color="default">
              {item}
            </Tag>
          ))}
        </Space>
      </div>

      <Layout className="workspace">
        <Sider width={292} className="sidebar">
          <MetricRail
            items={metricItems}
            runId={run.runId}
            activePoint={activePoint}
            elapsedSeconds={elapsedSeconds}
            workloads={workloadAggregates}
          />
        </Sider>

        <Content className="content">
          {!run.config?.litellm.api_key_present && (
            <Alert
              className="banner"
              type="warning"
              showIcon
              message={`未检测到 ${run.config?.litellm.api_key_env || "LITELLM_API_KEY"}`}
            />
          )}

          <div className="console-panel">
            <Tabs
              defaultActiveKey="live"
              items={[
                {
                  key: "live",
                  label: "实时",
                  children: (
                    <LiveDashboard
                      data={run.metricSeries}
                      latestMetrics={run.latestMetrics}
                      activePoint={activePoint}
                    />
                  )
                },
                {
                  key: "report",
                  label: "最后报告",
                  children: (
                    <FinalReport
                      summary={run.runSummary}
                      rows={reportRows}
                      artifacts={run.artifacts}
                      runId={run.runId}
                    />
                  )
                }
              ]}
            />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
