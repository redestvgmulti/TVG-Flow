import { metaCorsHeaders } from "./metaConnection.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

async function rejects(action: () => unknown, expected: string) {
  try { await action(); } catch (error) {
    if (String(error).includes(expected)) return;
    throw error;
  }
  throw new Error(`Expected ${expected}`);
}

function withEnv(values: Record<string, string | undefined>, action: () => unknown | Promise<unknown>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(values)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  return Promise.resolve(action()).finally(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  });
}

Deno.test("Meta CORS permits only an exact configured origin", async () => {
  await withEnv({ APP_ENV: "production", META_ALLOWED_ORIGINS: "https://app.tvg.test,https://admin.tvg.test", FRONTEND_URL: undefined }, () => {
    const headers = metaCorsHeaders(new Request("https://functions.test", { headers: { Origin: "https://admin.tvg.test" } }));
    equal(headers["Access-Control-Allow-Origin"], "https://admin.tvg.test");
  });
});

Deno.test("Meta CORS rejects an unknown origin and missing production configuration", async () => {
  await withEnv({ APP_ENV: "production", META_ALLOWED_ORIGINS: "https://app.tvg.test", FRONTEND_URL: undefined }, () =>
    rejects(() => metaCorsHeaders(new Request("https://functions.test", { headers: { Origin: "https://evil.test" } })), "META_ORIGIN_FORBIDDEN"));
  await withEnv({ APP_ENV: "production", META_ALLOWED_ORIGINS: undefined, FRONTEND_URL: undefined }, () =>
    rejects(() => metaCorsHeaders(new Request("https://functions.test", { headers: { Origin: "https://app.tvg.test" } })), "META_ORIGIN_FORBIDDEN"));
  await withEnv({ APP_ENV: "production", META_ALLOWED_ORIGINS: undefined, FRONTEND_URL: undefined }, () =>
    rejects(() => metaCorsHeaders(new Request("https://functions.test")), "META_ORIGIN_FORBIDDEN"));
});

Deno.test("Meta CORS emits no browser allowance when Origin is absent", async () => {
  await withEnv({ APP_ENV: "production", META_ALLOWED_ORIGINS: "https://app.tvg.test", FRONTEND_URL: undefined }, () => {
    const headers = metaCorsHeaders(new Request("https://functions.test"));
    equal("Access-Control-Allow-Origin" in headers, false);
  });
});

Deno.test("Meta CORS accepts localhost only in an explicit development environment", async () => {
  await withEnv({ APP_ENV: "development", META_ALLOWED_ORIGINS: undefined, FRONTEND_URL: undefined }, () => {
    const headers = metaCorsHeaders(new Request("http://functions.test", { headers: { Origin: "http://localhost:5173" } }));
    equal(headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  });
});
