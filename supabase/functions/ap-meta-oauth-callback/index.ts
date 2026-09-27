import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  exchangeMetaOAuthCode,
  hashOAuthState,
  readMetaAppConfig,
  sanitizeMetaError,
} from "../_shared/metaOAuth.ts";
import {
  appRedirect,
  cleanupExpiredMetaSelectionSessions,
  createAdminClient,
} from "../_shared/metaConnection.ts";
import {
  MetaCallbackIngressError,
  parseMetaCallbackIngress,
} from "../_shared/metaCallbackIngress.ts";

function throwRpcFailure(error: unknown, fallback: string): never {
  const detail = error instanceof Error ? error.message : JSON.stringify(error);
  if (detail.includes("META_AUTHORIZATION_REVOKED_DURING_FLOW")) {
    throw new Error("META_AUTHORIZATION_REVOKED_DURING_FLOW");
  }
  throw new Error(fallback);
}

Deno.serve(async (req: Request) => {
  let code: string;
  let state: string;
  try {
    ({ code, state } = await parseMetaCallbackIngress(
      req,
      Deno.env.get("META_CALLBACK_INGRESS_SECRET"),
    ));
  } catch (error) {
    const status = error instanceof MetaCallbackIngressError ? error.status : 400;
    return new Response("Callback rejected", {
      status,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  let redirectTarget = "/admin/settings/integrations/meta/callback";
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
    const { data: stateRow, error: stateError } = await admin.schema("ap").rpc(
      "consume_meta_oauth_state",
      {
        p_state_hash: await hashOAuthState(state),
      },
    );
    if (stateError || !stateRow) throw new Error("META_OAUTH_STATE_INVALID");
    redirectTarget = stateRow.redirect_target;
    await cleanupExpiredMetaSelectionSessions(admin);
    const { data: actorStillAuthorized, error: actorError } = await admin.schema("ap")
      .rpc("revalidate_meta_connection_actor", {
        p_user_id: stateRow.user_id,
        p_cliente_id: stateRow.cliente_id,
      });
    if (actorError || actorStillAuthorized !== true) {
      throw new Error("META_OAUTH_ACTOR_NO_LONGER_AUTHORIZED");
    }
    const config = readMetaAppConfig();
    const exchange = await exchangeMetaOAuthCode(config, code);
    if (!exchange.pages.length) {
      throw new Error("META_NO_ELIGIBLE_INSTAGRAM_ACCOUNT");
    }
    const flowStartedAt = stateRow.flow_started_at;
    if (typeof flowStartedAt !== "string") {
      throw new Error("META_OAUTH_STATE_INVALID");
    }
    const { data: epochData, error: epochError } = await admin.schema("ap").rpc(
      "capture_meta_authorization_epoch",
      {
        p_facebook_user_id: exchange.facebookUserId,
        p_flow_started_at: flowStartedAt,
      },
    );
    if (epochError) throwRpcFailure(epochError, "META_AUTHORIZATION_GUARD_FAILED");
    const authorizationEpoch = typeof epochData === "string"
      ? Number.parseInt(epochData, 10)
      : epochData;
    if (!Number.isSafeInteger(authorizationEpoch) || authorizationEpoch < 0) {
      throw new Error("META_AUTHORIZATION_GUARD_FAILED");
    }
    if (exchange.pages.length === 1) {
      const page = exchange.pages[0];
      const { error: connectionError } = await admin.schema("ap").rpc(
        "complete_meta_oauth_connection",
        {
          p_user_id: stateRow.user_id,
          p_cliente_id: stateRow.cliente_id,
          p_graph_api_version: config.graphApiVersion,
          p_facebook_user_id: exchange.facebookUserId,
          p_user_access_token: exchange.userAccessToken,
          p_user_token_expires_at: exchange.expiresAt,
          p_granted_scopes: exchange.grantedScopes,
          p_flow_started_at: flowStartedAt,
          p_authorization_epoch: authorizationEpoch,
          p_page: {
            facebook_page_id: page.pageId,
            facebook_page_name: page.pageName,
            instagram_user_id: page.instagramUserId,
            instagram_username: page.instagramUsername,
            page_access_token: page.pageAccessToken,
          },
        },
      );
      if (connectionError) {
        throwRpcFailure(connectionError, "META_CONNECTION_STORE_FAILED");
      }
      return appRedirect(redirectTarget, "connected");
    }
    const candidates: Array<{
      facebook_page_id: string;
      facebook_page_name: string;
      instagram_user_id: string;
      instagram_username: string;
      page_access_token: string;
    }> = [];
    for (const page of exchange.pages) {
      candidates.push({
        facebook_page_id: page.pageId,
        facebook_page_name: page.pageName,
        instagram_user_id: page.instagramUserId,
        instagram_username: page.instagramUsername,
        page_access_token: page.pageAccessToken,
      });
    }
    // Vault secrets, session ownership, candidates, and the authorization
    // guard commit together. A failure rolls all credential writes back.
    const { error: sessionError } = await admin.schema("ap").rpc(
      "create_meta_oauth_selection_session",
      {
        p_user_id: stateRow.user_id,
        p_cliente_id: stateRow.cliente_id,
        p_graph_api_version: config.graphApiVersion,
        p_facebook_user_id: exchange.facebookUserId,
        p_user_access_token: exchange.userAccessToken,
        p_user_token_expires_at: exchange.expiresAt,
        p_granted_scopes: exchange.grantedScopes,
        p_flow_started_at: flowStartedAt,
        p_authorization_epoch: authorizationEpoch,
        p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        p_candidates: candidates,
      },
    );
    if (sessionError) throwRpcFailure(sessionError, "META_SELECTION_STORE_FAILED");
    return appRedirect(redirectTarget, "select");
  } catch (error) {
    return appRedirect(redirectTarget, "error", {
      code: sanitizeMetaError(error),
    });
  }
});
