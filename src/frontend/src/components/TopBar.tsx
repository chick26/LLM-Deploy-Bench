import {
  ApiOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined
} from "@ant-design/icons";
import { Button, Layout, Select, Space, Tag, Typography } from "antd";
import { modeLabels } from "../constants";
import type { BenchConfig, RunMode } from "../types";
import { statusColor } from "../utils/format";

const { Header } = Layout;
const { Title } = Typography;

type TopBarProps = {
  config: BenchConfig | null;
  loading: boolean;
  mode: RunMode;
  runId: string | null;
  running: boolean;
  runStatus: string;
  onCancel: () => void;
  onModeChange: (mode: RunMode) => void;
  onStart: () => void;
};

export function TopBar({
  config,
  loading,
  mode,
  runId,
  running,
  runStatus,
  onCancel,
  onModeChange,
  onStart
}: TopBarProps) {
  return (
    <Header className="topbar">
      <div className="brand-block">
        <Title level={3} className="brand">
          LiteLLM Deploy Bench
        </Title>
        <Space size={8} wrap>
          <Tag icon={<ApiOutlined />} color="processing">
            {config?.litellm.base_url || "loading"}
          </Tag>
          <Tag color={config?.litellm.api_key_present ? "success" : "warning"}>
            API Key {config?.litellm.api_key_present ? "ready" : "missing"}
          </Tag>
          <Tag color={config?.litellm.master_key_present ? "success" : "default"}>
            Master Key {config?.litellm.master_key_present ? "ready" : "optional"}
          </Tag>
          <Tag color={statusColor(runStatus)}>{runStatus}</Tag>
          {runId && <Tag>Run {runId}</Tag>}
        </Space>
      </div>

      <div className="run-controls">
        <Select
          className="mode-select"
          disabled={loading || running}
          value={mode}
          onChange={onModeChange}
          options={(Object.keys(modeLabels) as RunMode[]).map((value) => ({
            value,
            label: modeLabels[value]
          }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
          刷新
        </Button>
        <Button danger icon={<StopOutlined />} disabled={!running} onClick={onCancel}>
          停止
        </Button>
        <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={onStart}>
          开始测试
        </Button>
      </div>
    </Header>
  );
}
