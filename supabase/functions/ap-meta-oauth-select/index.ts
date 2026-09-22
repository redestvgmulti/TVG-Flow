import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authFailure,
  cleanupExpiredMetaSelectionSessions,
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
    const body = await req.json();
    const candidateId = typeof body?.candidate_id === "string" ? body.candidate_id : "";
    if (!candidateId) return json({ error: "META_SELECTION_INVALID" }, 400);
    const admin = createAdminClient();
    const actor = await requireMetaAdmin(req, admin);
    await cleanupExpiredMetaSelectionSessions(admin);
    const { data, error } = await admin.schema("ap").rpc("select_meta_oauth_candidate", {
      p_candidate_id: candidateId,
      p_actor_user_id: actor.userId,
      p_cliente_id: actor.clienteId,
    });
    if (error || !data) {
      const message = error?.message || "META_SELECTION_INVALID";
      if (message.includes("META_SELECTION_ALREADY_CONSUMED")) {
        return json({ error: "META_SELECTION_ALREADY_CONSUMED" }, 409);
      }
      if (message.includes("META_SELECTION_EXPIRED")) {
        return json({ error: "META_SELECTION_EXPIRED" }, 409);
      }
      throw new Error("META_SELECTION_INVALID");
    }
    return json({ connected: true }, 200, cors);
  } catch (error) {
    const code = sanitizeMetaError(error);
    if (code === "META_CONNECTION_FAILED") return authFailure(error);
    return json({ error: code }, 400);
  }
});
