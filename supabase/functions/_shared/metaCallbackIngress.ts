const MAX_BODY_BYTES = 8_192;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class MetaCallbackIngressError extends Error {
  constructor(public readonly status: number) {
    super("META_CALLBACK_INGRESS_REJECTED");
  }
}

function secretMatches(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(actual);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) throw new MetaCallbackIngressError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new MetaCallbackIngressError(413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function parseMetaCallbackIngress(
  request: Request,
  expectedSecret: string | undefined,
): Promise<{ code: string; state: string }> {
  if (request.method !== "POST") throw new MetaCallbackIngressError(405);
  if (new URL(request.url).search) throw new MetaCallbackIngressError(400);
  if (!expectedSecret || expectedSecret.length < 32) {
    throw new MetaCallbackIngressError(503);
  }
  const receivedSecret = request.headers.get("x-meta-callback-ingress-secret") ?? "";
  if (receivedSecret.length > 256 || !secretMatches(receivedSecret, expectedSecret)) {
    throw new MetaCallbackIngressError(403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new MetaCallbackIngressError(415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new MetaCallbackIngressError(413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedBody(request));
  } catch (error) {
    if (error instanceof MetaCallbackIngressError) throw error;
    throw new MetaCallbackIngressError(400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new MetaCallbackIngressError(400);
  }
  const { code, state } = payload as Record<string, unknown>;
  if (
    typeof code !== "string" || code.length < 1 || code.length > 4096 ||
    typeof state !== "string" || !STATE_PATTERN.test(state)
  ) {
    throw new MetaCallbackIngressError(400);
  }
  return { code, state };
}
