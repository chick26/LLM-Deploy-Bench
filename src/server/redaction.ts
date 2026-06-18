const sensitiveKeys = new Set([
  "authorization",
  "api_key",
  "apikey",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-litellm-key",
  "litellm_api_key",
  "litellm_master_key",
  "token"
]);

const secretPatterns = [/Bearer\s+sk-[A-Za-z0-9._-]+/gi, /sk-[A-Za-z0-9._-]{8,}/g];

export function redactText(value: string): string {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

export function redact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as T;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      output[key] = sensitiveKeys.has(key.toLowerCase()) ? "[REDACTED]" : redact(item);
    });
    return output as T;
  }
  if (typeof value === "string") {
    return redactText(value) as T;
  }
  return value;
}
