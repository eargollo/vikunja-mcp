// The only network egress factory for vikunja-mcp. Injected fetch keeps every
// branch (4xx/5xx, empty body, bad JSON, FormData, timeout, network errors)
// unit-testable without starting the MCP server or reaching Vikunja.

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BODY_BYTES = 1_048_576; // 1 MiB

// Non-2xx bodies from these endpoints can contain secrets — never log them.
const SENSITIVE_ERROR_PATHS = [/^PUT \/tokens/, /^PUT \/projects\/\d+\/shares/];

export function isSensitiveErrorPath(method, path) {
  return SENSITIVE_ERROR_PATHS.some((re) => re.test(`${method} ${path}`));
}

export function classifyFetchError(err) {
  const code = err?.cause?.code ?? err?.code;
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timed out";
  if (typeof code === "string" && code.startsWith("ERR_SSL")) return "TLS error";
  if (typeof code === "string" && code.includes("CERT")) return "TLS error";
  return "network error";
}

export async function readResponseText(res, maxBytes = MAX_RESPONSE_BODY_BYTES) {
  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`response body exceeds ${maxBytes} byte limit`);
  }
  const text = await res.text();
  if (text.length > maxBytes) {
    throw new Error(`response body exceeds ${maxBytes} byte limit`);
  }
  return text;
}

export function makeApi({
  base,
  token,
  fetch: fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BODY_BYTES,
  logError = console.error,
} = {}) {
  return async function api(method, path, body) {
    const isForm = body instanceof FormData;
    let res;
    try {
      res = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isForm ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        throw new Error(`Vikunja ${method} ${path} -> request timed out after ${timeoutMs}ms`);
      }
      throw new Error(`Vikunja ${method} ${path} -> request failed: ${classifyFetchError(err)}`);
    }

    const text = await readResponseText(res, maxResponseBytes);
    if (!res.ok) {
      if (!isSensitiveErrorPath(method, path)) {
        const detail = text.slice(0, 400);
        logError(`vikunja-mcp: ${method} ${path} -> ${res.status}: ${detail}`);
      } else {
        logError(`vikunja-mcp: ${method} ${path} -> ${res.status}: (body omitted — may contain secrets)`);
      }
      if (res.status >= 500) {
        throw new Error(`Vikunja ${method} ${path} -> ${res.status}: server error`);
      }
      const detail = isSensitiveErrorPath(method, path) ? "request failed" : text.slice(0, 400);
      throw new Error(`Vikunja ${method} ${path} -> ${res.status}: ${detail}`);
    }

    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Vikunja ${method} ${path} -> invalid JSON response`);
      }
    }
    return { data, headers: res.headers };
  };
}
