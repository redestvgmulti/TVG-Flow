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
  try {
    const cors = metaCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, cors);
    const admin = createAdminClient();
    const actor = await requireMetaAdmin(req, admin);
    await cleanupExpiredMetaSelectionSessions(admin);
    const config = readMetaAppConfig();
    const state = createOAuthState();
    const { error } = await admin.schema("ap").from("meta_oauth_states").insert(
      {
        state_hash: await hashOAuthState(state),
        user_id: actor.userId,
        cliente_id: actor.clienteId,
        redirect_target: "/admin/settings/integrations/meta/callback",
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    );
    if (error) throw new Error("META_STATE_STORE_FAILED");
    return json({ authorize_url: buildMetaAuthorizeUrl(config, state) }, 200, cors);
  } catch (error) {
    const code = sanitizeMetaError(error);
    if (code === "META_CONNECTION_FAILED") return authFailure(error);
    return json(
      { error: code },
      code === "META_APP_NOT_CONFIGURED" ? 503 : 400,
    );
  }
});
