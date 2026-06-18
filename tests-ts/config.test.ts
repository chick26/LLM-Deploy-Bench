import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authHeaders, loadConfig, publicConfig } from "../src/server/config.js";

test("loadConfig reads .env next to bench.yaml", () => {
  const root = mkdtempSync(join(tmpdir(), "llm-bench-"));
  writeFileSync(
    join(root, "bench.yaml"),
    "litellm:\n  api_key_env: CUSTOM_API_KEY\n  master_key_env: CUSTOM_MASTER_KEY\n",
    "utf8"
  );
  writeFileSync(
    join(root, ".env"),
    "CUSTOM_API_KEY=test-env-file\nCUSTOM_MASTER_KEY=test-master-env-file\n",
    "utf8"
  );
  delete process.env.CUSTOM_API_KEY;
  delete process.env.CUSTOM_MASTER_KEY;

  const config = loadConfig(join(root, "bench.yaml"));
  const publicView = publicConfig(config);

  assert.equal(publicView.litellm && (publicView.litellm as Record<string, unknown>).api_key_present, true);
  assert.deepEqual(authHeaders(config), { Authorization: "Bearer test-env-file" });
  assert.deepEqual(authHeaders(config, true), { Authorization: "Bearer test-master-env-file" });
});

test("dotenv does not override exported environment", () => {
  const root = mkdtempSync(join(tmpdir(), "llm-bench-"));
  const previous = process.env.LITELLM_API_KEY;
  writeFileSync(join(root, "bench.yaml"), "", "utf8");
  writeFileSync(join(root, ".env"), "LITELLM_API_KEY=test-env-file\n", "utf8");
  process.env.LITELLM_API_KEY = "test-shell";

  try {
    const config = loadConfig(join(root, "bench.yaml"));

    assert.deepEqual(authHeaders(config), { Authorization: "Bearer test-shell" });
  } finally {
    if (previous === undefined) delete process.env.LITELLM_API_KEY;
    else process.env.LITELLM_API_KEY = previous;
  }
});

test("LITELLM_BASE_URL overrides configured base url", () => {
  const root = mkdtempSync(join(tmpdir(), "llm-bench-"));
  const previous = process.env.LITELLM_BASE_URL;
  delete process.env.LITELLM_BASE_URL;
  writeFileSync(join(root, "bench.yaml"), "litellm:\n  base_url: http://private.example:4000\n", "utf8");
  writeFileSync(join(root, ".env"), "LITELLM_BASE_URL=http://env.example:4000\n", "utf8");

  try {
    const config = loadConfig(join(root, "bench.yaml"));
    const publicView = publicConfig(config);

    assert.equal(config.litellm.base_url, "http://env.example:4000");
    assert.equal(publicView.litellm && (publicView.litellm as Record<string, unknown>).base_url_env, "LITELLM_BASE_URL");
  } finally {
    if (previous === undefined) delete process.env.LITELLM_BASE_URL;
    else process.env.LITELLM_BASE_URL = previous;
  }
});
