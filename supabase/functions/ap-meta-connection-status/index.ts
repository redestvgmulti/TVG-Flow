import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authFailure,
  createAdminClient,
  json,
  metaCorsHeaders,
  requireMetaAdmin,
} from "../_shared/metaConnection.ts";
import { isMetaAppConfigured } from "../_shared/metaOAuth.ts";

type MetaSelectionCandidateResponse = {
  id: string;
  page_name: string;
  username: string;
};

Deno.serve(async (req: Request) => {
  try {
    const cors = metaCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405, cors);
    const admin = createAdminClient();
    const actor = await requireMetaAdmin(req, admin);
    const [
      { data: connection, error: connectionError },
      { data: session, error: sessionError },
    ] = await Promise.all([
      admin.schema("ap").from("instagram_connections")
        .select(
          "status,instagram_username,facebook_page_name,capabilities,granted_scopes,last_validated_at,expires_at,last_error_code",
        )
        .eq("cliente_id", actor.clienteId).eq("is_primary", true).order(
          "updated_at",
          { ascending: false },
        ).maybeSingle(),
      admin.schema("ap").from("meta_oauth_selection_sessions")
        .select("id").eq("cliente_id", actor.clienteId).eq(
          "user_id",
          actor.userId,
        )
        .is("consumed_at", null).gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).maybeSingle(),
    ]);
    if (connectionError || sessionError) throw new Error("META_STATUS_FAILED");
    let selectionCandidates: MetaSelectionCandidateResponse[] = [];
    if (session?.id) {
      const { data, error } = await admin.schema("ap").from(
        "meta_oauth_selection_candidates",
      )
        .select("id,facebook_page_name,instagram_username").eq(
          "session_id",
          session.id,
        ).order("facebook_page_name");
      if (error) throw new Error("META_STATUS_FAILED");
      selectionCandidates = (data ?? []).map((candidate) => ({
        id: candidate.id,
        page_name: candidate.facebook_page_name,
        username: candidate.instagram_username,
      }));
    }
    const expired = connection?.status === "connected" && connection.expires_at &&
      new Date(connection.expires_at).getTime() <= Date.now();
    return json({
      oauth_available: isMetaAppConfigured(),
      connected: connection?.status === "connected" && !expired,
      status: expired ? "expired" : (connection?.status ?? "disconnected"),
      username: connection?.instagram_username ?? null,
      page_name: connection?.facebook_page_name ?? null,
      capabilities: expired ? {} : (connection?.capabilities ?? {}),
      granted_scopes: expired ? [] : (connection?.granted_scopes ?? []),
      last_validated_at: connection?.last_validated_at ?? null,
      expires_at: connection?.expires_at ?? null,
      error_code: connection?.last_error_code ?? null,
      selection_session_id: session?.id ?? null,
      selection_candidates: selectionCandidates,
    }, 200, cors);
  } catch (error) {
    return authFailure(error);
  }
});
