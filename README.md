# LiteLLM Deploy Bench

[中文说明](README-zn.md)

LiteLLM Deploy Bench is a local React + Node/TypeScript acceptance and load testing console for LiteLLM model deployments. It is designed for the moment after a model service is deployed: open the local UI, choose a profile, start one validation run, and keep the generated data-first report.

## Quick Start

```bash
cp .env.example .env
npm install
npm run init-config
npm run dev
```

Open `http://127.0.0.1:5173`. The API server listens on `127.0.0.1:8090` by default, and the Vite dev server proxies `/api` to it.

## Local Secrets And Configuration

Keep real deployment URLs and keys only in local `.env` or local `bench.yaml`. Do not commit them to GitHub. The committed `.env.example` and `bench.yaml.example` files contain public-safe placeholders only.

Recommended `.env`:

```env
LITELLM_BASE_URL=http://your-litellm-host:4000
LITELLM_API_KEY=your-litellm-api-key
LITELLM_MASTER_KEY=your-litellm-master-key
```

Environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `LITELLM_BASE_URL` | LiteLLM base URL. Overrides `litellm.base_url` from `bench.yaml`. | `http://127.0.0.1:4000` |
| `LITELLM_API_KEY` | API key for normal requests. | empty |
| `LITELLM_MASTER_KEY` | Master/admin key for admin or health checks. Some checks fall back to the API key when missing. | empty |

Exported shell variables take priority over `.env`. If you change `api_key_env`, `master_key_env`, or `base_url_env` in `bench.yaml`, use the same variable names in `.env`.

## bench.yaml

Run `npm run init-config` to create a local `bench.yaml` from `bench.yaml.example`. The local file is ignored by Git, so it can contain private model names, private service URLs, and machine-specific load settings.

Important fields:

- `litellm.base_url`: LiteLLM service URL, overridable by `LITELLM_BASE_URL`.
- `models.chat`: models tested through `/v1/chat/completions`.
- `models.embedding`: models tested through `/v1/embeddings`.
- `models.rerank`: models tested through `/rerank`.
- `models.long_context`: chat models used for synthetic long-context requests.
- `profiles.smoke`: lightweight health and short-request validation.
- `profiles.standard`: default acceptance profile covering chat, embedding, rerank, long-context, OCR service, and security checks.
- `profiles.max-throughput`: heavier profile for saturation exploration.
- `thresholds`: error-rate, timeout-rate, and p95 latency limits. Crossing a limit stops that model or workload stage.

## Commands

```bash
npm run dev         # API plus frontend
npm run server      # API only
npm run web         # frontend only
npm run init-config # create local bench.yaml
npm test            # TypeScript unit tests
npm run build       # server typecheck plus frontend production build
npm run clean       # remove dist outputs
```

## Outputs

Each run is saved under `runs/<timestamp>/`:

- `summary.json`: structured summary.
- `summary.csv`: stage metrics for spreadsheet analysis.
- `requests.jsonl`: request-level records.

`runs/` is ignored by Git, so generated reports are not committed.

## Pre-Commit Safety Check

Before publishing to a public repository, check:

```bash
git status --ignored --short
rg -n --glob '!node_modules/**' --glob '!dist*/**' --glob '!runs/**' '10\.|192\.168\.|LITELLM_API_KEY=|LITELLM_MASTER_KEY=|Bearer '
```

Expected state:

- `.env`, `.env.*`, `bench.yaml`, `runs/`, `dist*/`, and `node_modules/` are not committed.
- Source and docs do not contain real keys, private LiteLLM URLs, or generated run artifacts.
- Report and event payloads redact sensitive fields through `src/server/redaction.ts`.
