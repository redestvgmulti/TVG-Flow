import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
} from "../_shared/metaConnection.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(input.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

async function verifySignedRequest(signedRequest: string, appSecret: string) {
  const [encodedSignature, encodedPayload, ...rest] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload || rest.length) {
    throw new Error("META_DEAUTHORIZE_INVALID");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(encodedSignature),
    new TextEncoder().encode(encodedPayload),
  );
  if (!valid) throw new Error("META_DEAUTHORIZE_INVALID");
  const payload = JSON.parse(
    new TextDecoder().decode(fromBase64Url(encodedPayload)),
  );
  if (
    !payload || typeof payload.user_id !== "string" ||
    !/^[0-9]+$/.test(payload.user_id)
  ) throw new Error("META_DEAUTHORIZE_INVALID");
  return payload.user_id;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const appSecret = Deno.env.get("META_APP_SECRET");
    if (!appSecret) throw new Error("META_APP_NOT_CONFIGURED");
    const form = await req.formData();
    const facebookUserId = await verifySignedRequest(
      String(form.get("signed_request") || ""),
      appSecret,
    );
    const admin = createAdminClient();
    // Phase 1 is transactional and comes before cleanup: Meta has already
    // revoked the external authorization, so no affected tenant may remain
    // functionally connected even when Vault is temporarily unavailable.
    const { data: ids, error } = await admin.schema("ap").rpc(
      "mark_meta_connections_revoked",
      { p_facebook_user_id: facebookUserId },
    );
    if (error || !Array.isArray(ids)) throw new Error("META_DEAUTHORIZE_FAILED");
    for (const id of ids.filter((value): value is string => typeof value === "string")) {
      const { error: cleanupError } = await admin.schema("ap").rpc(
        "cleanup_revoked_meta_connection",
        { p_connection_id: id },
      );
      if (cleanupError) {
        await admin.schema("ap").rpc("record_meta_secret_cleanup_failure", {
          p_connection_id: id,
          p_error_code: "META_SECRET_DELETE_FAILED",
        });
      }
    }
    return json({ success: true });
  } catch {
    return json({ error: "META_DEAUTHORIZE_INVALID" }, 400);
  }
});
