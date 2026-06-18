import type { RunMode } from "./types";

export const modeLabels: Record<RunMode, string> = {
  smoke: "快速连通性测试",
  standard: "标准验收测试",
  "max-throughput": "极限吞吐测试",
  "raw-check": "服务接口检查"
};

export const terminalRunEventTypes = ["finished", "failed", "cancelled"];
