import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  buildMetaAuthorizeUrl,
  createOAuthState,
  hashOAuthState,
  readMetaAppConfig,
  sanitizeMetaError,
} from "../_shared/metaOAuth.ts";
import {
  authFailure,
  cleanupExpiredMetaSelectionSessions,
  createAdminClient,
  json,
  metaCorsHeaders,
  requireMetaAdmin,
} from "../_shared/metaConnection.ts";

Deno.serve(async (req: Request) => {
  // Keep a validated CORS policy for every later error response. The Meta App
  // configuration is intentionally allowed to be absent before the first real
  // connection, and that 503 must still be readable by the authorized UI.
  let cors: Record<string, string> = {};
  try {
    cors = metaCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, cors);
    const admin = createAdminClient();
    const actor = await requireMetaAdmin(req, admin);
    await cleanupExpiredMetaSelectionSessions(admin);
    const config = readMetaAppConfig();
    const state = createOAuthState();
    const { error } = await admin.schema("ap").rpc("create_meta_oauth_state", {
      p_state_hash: await hashOAuthState(state),
      p_user_id: actor.userId,
      p_cliente_id: actor.clienteId,
      p_redirect_target: "/admin/settings/integrations/meta/callback",
    });
    if (error) throw new Error("META_STATE_STORE_FAILED");
    return json({ authorize_url: buildMetaAuthorizeUrl(config, state) }, 200, cors);
  } catch (error) {
    const code = sanitizeMetaError(error);
    if (code === "META_CONNECTION_FAILED") return authFailure(error, cors);
    return json(
      { error: code },
      code === "META_APP_NOT_CONFIGURED" ? 503 : 400,
      cors,
    );
  }
});
