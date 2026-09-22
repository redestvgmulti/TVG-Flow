import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authFailure,
  createAdminClient,
  json,
  metaCorsHeaders,
  requireMetaAdmin,
} from "../_shared/metaConnection.ts";
import { sanitizeMetaError } from "../_shared/metaOAuth.ts";

Deno.serve(async (req: Request) => {
  try {
    const cors = metaCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, cors);
    const admin = createAdminClient();
    const actor = await requireMetaAdmin(req, admin);
    const { data, error } = await admin.schema("ap").rpc("disconnect_meta_connection", {
      p_cliente_id: actor.clienteId, p_actor_user_id: actor.userId,
    });
    if (error || !data) throw new Error("META_DISCONNECT_STORE_FAILED");
    // Local tenant disconnect intentionally does not revoke Meta app permissions.
    // Global Meta revocation is a distinct future operation.
    return json(data, 200, cors);
  } catch (error) {
    const code = sanitizeMetaError(error);
    if (code === "META_CONNECTION_FAILED") return authFailure(error);
    return json({ error: code }, 500);
  }
});
