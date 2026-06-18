import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { artifactStream, listArtifacts } from "./artifacts.js";
import { initConfig, loadConfig, publicConfig } from "./config.js";
import { RunManager } from "./runner.js";
import type { RunRequest } from "./types.js";

const manager = new RunManager();

export function createAppServer() {
  return createServer(async (request, response) => {
    setCors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      await route(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { detail: message });
    }
  });
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method || "GET";
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const path = url.pathname;

  if (method === "GET" && path === "/api/config") {
    sendJson(response, 200, publicConfig(loadConfig()));
    return;
  }

  if (method === "POST" && path === "/api/runs") {
    let payload: RunRequest;
    try {
      payload = (await readJson(request)) as RunRequest;
    } catch {
      sendJson(response, 400, { detail: "invalid JSON request body" });
      return;
    }
    try {
      const run = manager.start(payload || { mode: "standard" });
      sendJson(response, 200, { run_id: run.runId, status: run.status });
    } catch (error) {
      sendJson(response, 409, { detail: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const eventMatch = path.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (method === "GET" && eventMatch) {
    streamEvents(response, eventMatch[1]);
    return;
  }

  const cancelMatch = path.match(/^\/api\/runs\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    try {
      const run = manager.cancel(cancelMatch[1]);
      sendJson(response, 200, { run_id: run.runId, status: run.status });
    } catch {
      sendJson(response, 404, { detail: "run not found" });
    }
    return;
  }

  const artifactsMatch = path.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
  if (method === "GET" && artifactsMatch) {
    const runId = artifactsMatch[1];
    const runDir = safeRunDir(runId);
    if (!runDir) {
      sendJson(response, 400, { detail: "invalid run id" });
      return;
    }
    if (!existsSync(runDir)) {
      sendJson(response, 404, { detail: "run not found" });
      return;
    }
    sendJson(response, 200, { run_id: runId, artifacts: listArtifacts(runDir) });
    return;
  }

  const artifactMatch = path.match(/^\/api\/artifacts\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && artifactMatch) {
    await sendArtifact(response, artifactMatch[1], artifactMatch[2]);
    return;
  }

  sendJson(response, 404, { detail: "not found" });
}

function streamEvents(response: ServerResponse, runId: string): void {
  let run;
  try {
    run = manager.get(runId);
  } catch {
    sendJson(response, 404, { detail: "run not found" });
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const subscriber = (event: Record<string, unknown>) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
    if (["finished", "failed", "cancelled"].includes(String(event.type))) {
      run.unsubscribe(subscriber);
      response.end();
    }
  };
  run.subscribe(subscriber);
  const snapshot = [...run.events];
  snapshot.forEach((event) => response.write(`data: ${JSON.stringify(event)}\n\n`));
  if (snapshot.some((event) => ["finished", "failed", "cancelled"].includes(String(event.type)))) {
    run.unsubscribe(subscriber);
    response.end();
    return;
  }
  response.on("close", () => run.unsubscribe(subscriber));
}

async function sendArtifact(response: ServerResponse, runId: string, name: string): Promise<void> {
  if (basename(name) !== name || name.includes("..")) {
    sendJson(response, 400, { detail: "invalid artifact name" });
    return;
  }
  const runDir = safeRunDir(runId);
  if (!runDir) {
    sendJson(response, 400, { detail: "invalid run id" });
    return;
  }
  const path = resolve(runDir, name);
  if (!path.startsWith(`${runDir}${sep}`)) {
    sendJson(response, 400, { detail: "invalid artifact path" });
    return;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    sendJson(response, 404, { detail: "artifact not found" });
    return;
  }
  response.writeHead(200, {
    "content-type": contentType(name),
    "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"`
  });
  await pipeline(artifactStream(path), response);
}

function safeRunDir(runId: string): string | null {
  if (basename(runId) !== runId || runId.includes("..")) return null;
  return resolve("runs", runId);
}

function contentType(name: string): string {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".jsonl")) return "application/x-ndjson; charset=utf-8";
  if (name.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

function setCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function runCli(): void {
  const command = process.argv[2] || "serve";
  if (command === "init-config") {
    const pathArgIndex = process.argv.indexOf("--path");
    const path = pathArgIndex >= 0 ? process.argv[pathArgIndex + 1] : "bench.yaml";
    console.log(`config ready: ${initConfig(path)}`);
    return;
  }

  if (command === "serve") {
    const host = valueAfter("--host") || "127.0.0.1";
    const port = Number(valueAfter("--port") || 8090);
    createAppServer().listen(port, host, () => {
      console.log(`LiteLLM Deploy Bench API running on http://${host}:${port}`);
    });
    return;
  }

  console.log("Usage: npm run server -- [serve|init-config] [--host 127.0.0.1] [--port 8090]");
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
