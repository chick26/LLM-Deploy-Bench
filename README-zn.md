# LiteLLM Deploy Bench

[English](README.md)

LiteLLM Deploy Bench 是一个基于 React + Node/TypeScript 的本地化部署验收和压测工具。它适合在模型服务刚部署完成后使用：打开本地控制台，选择测试档位，启动一次验收或吞吐测试，然后保存生成的报告数据。

## 快速开始

```bash
cp .env.example .env
npm install
npm run init-config
npm run dev
```

打开 `http://127.0.0.1:5173` 使用控制台。API 服务默认监听 `127.0.0.1:8090`，Vite 开发服务会把 `/api` 请求代理到后端。

## 本地安全配置

真实部署地址和密钥只放在本地 `.env` 或本地 `bench.yaml` 中，不要提交到 GitHub。仓库中的 `.env.example` 和 `bench.yaml.example` 只包含公开安全的占位配置。

推荐在 `.env` 中配置：

```env
LITELLM_BASE_URL=http://your-litellm-host:4000
LITELLM_API_KEY=your-litellm-api-key
LITELLM_MASTER_KEY=your-litellm-master-key
```

环境变量优先级：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `LITELLM_BASE_URL` | LiteLLM 服务地址，会覆盖 `bench.yaml` 中的 `litellm.base_url` | `http://127.0.0.1:4000` |
| `LITELLM_API_KEY` | 普通请求鉴权密钥 | 空 |
| `LITELLM_MASTER_KEY` | 管理接口或健康检查使用的主密钥，缺失时部分检查会退回普通密钥 | 空 |

Shell 中已导出的同名变量优先于 `.env`。如果你在 `bench.yaml` 中改了 `api_key_env`、`master_key_env` 或 `base_url_env`，`.env` 里也要使用相同变量名。

## bench.yaml 配置

运行 `npm run init-config` 会从 `bench.yaml.example` 生成本地 `bench.yaml`。该文件已被 `.gitignore` 忽略，可以放置私有模型名、私有地址和本地压测参数。

主要配置项：

- `litellm.base_url`: LiteLLM 服务地址，可被 `LITELLM_BASE_URL` 覆盖。
- `models.chat`: 普通 `/v1/chat/completions` 压测模型。
- `models.embedding`: `/v1/embeddings` 向量吞吐测试模型。
- `models.rerank`: `/rerank` 文档重排测试模型。
- `models.long_context`: 合成长上下文请求使用的聊天模型。
- `profiles.smoke`: 轻量健康检查和短请求验证。
- `profiles.standard`: 默认验收档位，覆盖 chat、embedding、rerank、long-context、OCR 服务和安全检查。
- `profiles.max-throughput`: 更重的吞吐探索档位。
- `thresholds`: 错误率、超时率和 p95 延迟阈值，超阈值会停止当前模型或工作负载阶段。

## 常用命令

```bash
npm run dev         # 同时启动 API 和前端
npm run server      # 只启动 API 服务
npm run web         # 只启动前端开发服务
npm run init-config # 生成本地 bench.yaml
npm test            # TypeScript 单元测试
npm run build       # 服务端类型检查和前端生产构建
npm run clean       # 删除 dist 输出
```

## 输出文件

每次运行会在 `runs/<timestamp>/` 下生成：

- `summary.json`: 结构化汇总。
- `summary.csv`: 便于表格分析的阶段指标。
- `requests.jsonl`: 单请求级别记录。

`runs/` 已被 Git 忽略，生成报告不会被提交。

## 提交前安全检查

提交到公开仓库前建议检查：

```bash
git status --ignored --short
rg -n --glob '!node_modules/**' --glob '!dist*/**' --glob '!runs/**' '10\.|192\.168\.|LITELLM_API_KEY=|LITELLM_MASTER_KEY=|Bearer '
```

预期结果：

- `.env`、`.env.*`、`bench.yaml`、`runs/`、`dist*/`、`node_modules/` 不会进入提交。
- 仓库源码和文档中不包含真实密钥、私有 LiteLLM 地址或运行结果。
- 报告和事件中的敏感字段会通过 `src/server/redaction.ts` 脱敏。
