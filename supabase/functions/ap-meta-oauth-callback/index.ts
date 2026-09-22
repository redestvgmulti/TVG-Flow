import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  capabilitiesFromScopes,
  exchangeMetaOAuthCode,
  hashOAuthState,
  readMetaAppConfig,
  sanitizeMetaError,
} from "../_shared/metaOAuth.ts";
import {
  appRedirect,
  cleanupExpiredMetaSelectionSessions,
  createAdminClient,
  createVaultSecret,
  deleteVaultSecret,
} from "../_shared/metaConnection.ts";

async function persistConnection(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    clienteId: string;
    userId: string;
    graphVersion: string;
    facebookUserId: string;
    grantedScopes: string[];
    expiresAt: string | null;
    oauthStartedAt: string;
    page: {
      pageId: string;
      pageName: string;
      pageAccessToken: string;
      instagramUserId: string;
      instagramUsername: string;
    };
    userTokenSecretRef: string;
  },
) {
  const pageSecret = await createVaultSecret(
    admin,
    params.page.pageAccessToken,
    `ap_meta_page_${crypto.randomUUID().replaceAll("-", "")}`,
    "Meta Page access token",
  );
  let persisted = false;
  try {
    const { error } = await admin.schema("ap").rpc("reconnect_meta_connection", {
      p_cliente_id: params.clienteId,
      p_actor_user_id: params.userId,
      p_facebook_user_id: params.facebookUserId,
      p_instagram_user_id: params.page.instagramUserId,
      p_instagram_username: params.page.instagramUsername,
      p_facebook_page_id: params.page.pageId,
      p_facebook_page_name: params.page.pageName,
      p_page_secret_ref: pageSecret,
      p_user_secret_ref: params.userTokenSecretRef,
      p_granted_scopes: params.grantedScopes,
      p_capabilities: capabilitiesFromScopes(params.grantedScopes),
      p_graph_api_version: params.graphVersion,
      p_expires_at: params.expiresAt,
      p_oauth_started_at: params.oauthStartedAt,
    });
    if (error) throw new Error("META_CONNECTION_STORE_FAILED");
    persisted = true;
  } finally {
    // The RPC either commits both the new reference and the old-secret cleanup,
    // or rolls everything back. Only an unpersisted new Page token is ours to delete.
    if (!persisted) await deleteVaultSecret(admin, pageSecret, { allowMissing: true });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  let redirectTarget = "/admin/settings/integrations/meta/callback";
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let userTokenSecretRef: string | null = null;
  let userTokenStillTemporary = false;
  let temporaryPageSecretRefs: string[] = [];
  try {
    const query = new URL(req.url).searchParams;
    const state = query.get("state") || "";
    const code = query.get("code") || "";
    if (!state || !code) throw new Error("META_OAUTH_CALLBACK_INVALID");
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
    userTokenSecretRef = await createVaultSecret(
      admin,
      exchange.userAccessToken,
      `ap_meta_user_${crypto.randomUUID().replaceAll("-", "")}`,
      "Meta OAuth user token used only for disconnect",
    );
    userTokenStillTemporary = true;
    if (exchange.pages.length === 1) {
      await persistConnection(admin, {
        clienteId: stateRow.cliente_id,
        userId: stateRow.user_id,
        graphVersion: config.graphApiVersion,
        facebookUserId: exchange.facebookUserId,
        grantedScopes: exchange.grantedScopes,
        expiresAt: exchange.expiresAt,
        oauthStartedAt: stateRow.created_at,
        page: exchange.pages[0],
        userTokenSecretRef,
      });
      userTokenStillTemporary = false;
      return appRedirect(redirectTarget, "connected", { tenant: stateRow.cliente_id });
    }
    const candidates: Array<{
      facebook_page_id: string;
      facebook_page_name: string;
      instagram_user_id: string;
      instagram_username: string;
      page_token_secret_ref: string;
    }> = [];
    for (const page of exchange.pages) {
      const pageTokenSecretRef = await createVaultSecret(
        admin,
        page.pageAccessToken,
        `ap_meta_page_${crypto.randomUUID().replaceAll("-", "")}`,
        "Temporary Meta Page access token",
      );
      temporaryPageSecretRefs.push(pageTokenSecretRef);
      candidates.push({
        facebook_page_id: page.pageId,
        facebook_page_name: page.pageName,
        instagram_user_id: page.instagramUserId,
        instagram_username: page.instagramUsername,
        page_token_secret_ref: pageTokenSecretRef,
      });
    }
    // All references already exist in Vault, then this single RPC either
    // stores the ready session plus every candidate or stores nothing.
    const { error: sessionError } = await admin.schema("ap").rpc(
      "create_meta_oauth_selection_session",
      {
        p_user_id: stateRow.user_id,
        p_cliente_id: stateRow.cliente_id,
        p_graph_api_version: config.graphApiVersion,
        p_facebook_user_id: exchange.facebookUserId,
        p_user_token_secret_ref: userTokenSecretRef,
        p_user_token_expires_at: exchange.expiresAt,
        p_granted_scopes: exchange.grantedScopes,
        p_oauth_started_at: stateRow.created_at,
        p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        p_candidates: candidates,
      },
    );
    if (sessionError) throw new Error("META_SELECTION_STORE_FAILED");
    temporaryPageSecretRefs = [];
    userTokenStillTemporary = false;
    return appRedirect(redirectTarget, "select", { tenant: stateRow.cliente_id });
  } catch (error) {
    if (admin) {
      for (const secretRef of temporaryPageSecretRefs) {
        await deleteVaultSecret(admin, secretRef);
      }
      if (userTokenSecretRef && userTokenStillTemporary) {
        await deleteVaultSecret(admin, userTokenSecretRef);
      }
    }
    return appRedirect(redirectTarget, "error", {
      code: sanitizeMetaError(error),
    });
  }
});
