import { ThunderboltOutlined } from "@ant-design/icons";
import { Statistic, Typography } from "antd";
import type { MetricItem, MetricPoint, WorkloadAggregate } from "../viewTypes";
import {
  formatDuration,
  formatThroughputPrimary,
  formatThroughputSecondary
} from "../utils/format";

const { Text } = Typography;

type MetricRailProps = {
  activePoint?: MetricPoint;
  elapsedSeconds: number;
  items: MetricItem[];
  runId: string | null;
  workloads: WorkloadAggregate[];
};

export function MetricRail({ activePoint, elapsedSeconds, items, runId, workloads }: MetricRailProps) {
  return (
    <aside className="metric-rail">
      <div className="rail-heading">
        <ThunderboltOutlined />
        <div>
          <Text className="rail-kicker">Realtime Signals</Text>
          <strong>实时指标</strong>
        </div>
      </div>
      <div className="metric-list">
        {items.map((item) => (
          <div className="metric-tile" key={item.label}>
            <Statistic
              title={item.label}
              value={item.value}
              precision={typeof item.value === "number" ? item.precision : undefined}
              suffix={item.suffix}
            />
          </div>
        ))}
      </div>
      <div className="run-card">
        <Text type="secondary">当前事件</Text>
        <strong>{activePoint?.workload || "等待数据"}</strong>
        <Text ellipsis>{activePoint?.model || runId || "尚未启动"}</Text>
        <span>{formatDuration(elapsedSeconds)}</span>
      </div>
      <WorkloadPanel workloads={workloads} />
    </aside>
  );
}

function WorkloadPanel({ workloads }: { workloads: WorkloadAggregate[] }) {
  return (
    <div className="workload-panel">
      <div className="workload-panel-title">
        <Text className="rail-kicker">Recent Stage Sum</Text>
        <strong>吞吐汇总</strong>
      </div>
      {workloads.length ? (
        <div className="workload-list">
          {workloads.map((workload) => (
            <div className="workload-row" key={workload.workload}>
              <div>
                <strong>{workload.label}</strong>
                <Text type="secondary">{workload.models} 模型</Text>
              </div>
              <div className="workload-values">
                <span>{formatThroughputPrimary(workload)}</span>
                <Text type="secondary">{formatThroughputSecondary(workload)}</Text>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="workload-empty">等待指标</div>
      )}
    </div>
  );
}
