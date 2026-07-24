// Unit tests for api.js — every network branch without a live Vikunja or MCP server.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeApi,
  classifyFetchError,
  isSensitiveErrorPath,
  readResponseText,
  MAX_RESPONSE_BODY_BYTES,
} from "../api.js";

const BASE = "http://vikunja.test/api/v1";
const TOKEN = "test-token";

function mockResponse({ status = 200, body = "", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => body,
  };
}

test("classifyFetchError maps common network codes", () => {
  assert.equal(classifyFetchError({ cause: { code: "ECONNREFUSED" } }), "connection refused");
  assert.equal(classifyFetchError({ code: "ENOTFOUND" }), "host not found");
  assert.equal(classifyFetchError({ code: "ETIMEDOUT" }), "timed out");
  assert.equal(classifyFetchError({ code: "ERR_SSL_WRONG_VERSION_NUMBER" }), "TLS error");
  assert.equal(classifyFetchError({ code: "CERT_HAS_EXPIRED" }), "TLS error");
  assert.equal(classifyFetchError(new Error("boom")), "network error");
});

test("isSensitiveErrorPath flags token, share, and CalDAV-token endpoints", () => {
  assert.ok(isSensitiveErrorPath("PUT", "/tokens"));
  assert.ok(isSensitiveErrorPath("PUT", "/projects/42/shares"));
  assert.ok(isSensitiveErrorPath("PUT", "/user/settings/token/caldav"));
  assert.ok(!isSensitiveErrorPath("GET", "/tokens"));
  assert.ok(!isSensitiveErrorPath("GET", "/user/settings/token/caldav"));
  assert.ok(!isSensitiveErrorPath("PUT", "/projects/42/tasks"));
});

test("readResponseText rejects oversized bodies", async () => {
  const res = mockResponse({ body: "x".repeat(100) });
  await assert.rejects(() => readResponseText(res, 50), /exceeds 50 byte limit/);
});

test("readResponseText rejects when Content-Length exceeds limit", async () => {
  const res = mockResponse({ body: "ok", headers: { "content-length": String(MAX_RESPONSE_BODY_BYTES + 1) } });
  await assert.rejects(() => readResponseText(res), /exceeds/);
});

test("readResponseText accepts a body exactly at the limit (inclusive boundary)", async () => {
  // Pins the > vs >= boundary on both the Content-Length pre-check and the
  // actual text-length check: a body of exactly maxBytes must be allowed.
  const res = mockResponse({ body: "x".repeat(50), headers: { "content-length": "50" } });
  assert.equal(await readResponseText(res, 50), "x".repeat(50));
});

test("makeApi returns parsed JSON on 2xx", async () => {
  const fetch = async (url, opts) => {
    assert.equal(url, `${BASE}/projects`);
    assert.equal(opts.method, "GET");
    assert.equal(opts.headers.Authorization, `Bearer ${TOKEN}`);
    return mockResponse({ body: JSON.stringify([{ id: 1 }]) });
  };
  const api = makeApi({ base: BASE, token: TOKEN, fetch });
  const { data } = await api("GET", "/projects");
  assert.deepEqual(data, [{ id: 1 }]);
});

test("makeApi accepts empty 2xx body as null data", async () => {
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    fetch: async () => mockResponse({ body: "" }),
  });
  const { data } = await api("DELETE", "/tasks/1");
  assert.equal(data, null);
});

test("makeApi throws on 4xx with body detail", async () => {
  const logs = [];
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    fetch: async () => mockResponse({ status: 404, body: "not found" }),
    logError: (...args) => logs.push(args.join(" ")),
  });
  await assert.rejects(() => api("GET", "/tasks/99"), /404: not found/);
  assert.match(logs[0], /404: not found/);
});

test("makeApi throws generic message on 5xx", async () => {
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    fetch: async () => mockResponse({ status: 500, body: "internal stack trace" }),
    logError: () => {},
  });
  await assert.rejects(() => api("GET", "/projects"), /500: server error/);
});

test("makeApi surfaces 401/403 as an authentication error", async () => {
  for (const status of [401, 403]) {
    const api = makeApi({
      base: BASE,
      token: TOKEN,
      fetch: async () => mockResponse({ status, body: "invalid token" }),
      logError: () => {},
    });
    await assert.rejects(() => api("GET", "/projects"), /authentication failed — check VIKUNJA_API_TOKEN/);
  }
});

test("makeApi omits sensitive 4xx bodies from logs and thrown detail", async () => {
  const logs = [];
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    fetch: async () => mockResponse({ status: 400, body: "secret-token-value" }),
    logError: (...args) => logs.push(args.join(" ")),
  });
  await assert.rejects(() => api("PUT", "/tokens", {}), /400: request failed/);
  assert.match(logs[0], /body omitted/);
  assert.doesNotMatch(logs[0], /secret-token-value/);
});

test("makeApi throws on invalid JSON", async () => {
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    fetch: async () => mockResponse({ body: "not-json" }),
    logError: () => {},
  });
  await assert.rejects(() => api("GET", "/projects"), /invalid JSON response/);
});

test("makeApi passes FormData without Content-Type header", async () => {
  const form = new FormData();
  form.append("file", new File(["hi"], "a.txt"));
  let seenHeaders;
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    fetch: async (_url, opts) => {
      seenHeaders = opts.headers;
      assert.ok(opts.body instanceof FormData);
      return mockResponse({ body: JSON.stringify({ id: 1 }) });
    },
  });
  await api("PUT", "/tasks/1/attachments", form);
  assert.equal(seenHeaders["Content-Type"], undefined);
});

test("makeApi normalizes fetch rejections without leaking the URL", async () => {
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    fetch: async () => {
      const err = new TypeError("fetch failed");
      err.cause = { code: "ECONNREFUSED" };
      throw err;
    },
  });
  await assert.rejects(() => api("GET", "/projects"), /request failed: connection refused/);
  await assert.rejects(() => api("GET", "/projects"), (err) => !String(err).includes(BASE));
});

test("makeApi maps AbortSignal timeout to a clear error", async () => {
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    timeoutMs: 5,
    fetch: async (_url, opts) => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    },
  });
  await assert.rejects(() => api("GET", "/projects"), /timed out after 5ms/);
});

test("makeApi wraps a timeout that fires during the response-body read", async () => {
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    timeoutMs: 5,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      // the abort signal also aborts the body stream, so text() can reject
      text: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    }),
  });
  await assert.rejects(() => api("GET", "/projects"), /timed out after 5ms/);
});

test("makeApi surfaces the size-cap error cleanly (not as a network error)", async () => {
  const api = makeApi({
    base: BASE,
    token: TOKEN,
    maxResponseBytes: 4,
    fetch: async () => mockResponse({ body: "way too long" }),
  });
  await assert.rejects(() => api("GET", "/projects"), /byte limit/);
});
