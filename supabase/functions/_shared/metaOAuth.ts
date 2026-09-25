export const META_READ_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
] as const;
const MAX_ACCOUNT_PAGES = 10;
const MAX_ACCOUNT_ITEMS = 1_000;
const META_REQUEST_TIMEOUT_MS = 10_000;
const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const VERSION = /^v[1-9][0-9]*\.[0-9]+$/;

export type MetaAppConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphApiVersion: string;
};

export function readMetaAppConfig(env = Deno.env.toObject()): MetaAppConfig {
  const appId = env.META_APP_ID?.trim() ?? "";
  const appSecret = env.META_APP_SECRET?.trim() ?? "";
  const redirectUri = env.META_OAUTH_REDIRECT_URI?.trim() ?? "";
  const graphApiVersion = env.META_GRAPH_API_VERSION?.trim() ?? "";
  if (!appId || !appSecret || !redirectUri || !VERSION.test(graphApiVersion)) {
    throw new Error("META_APP_NOT_CONFIGURED");
  }
  const url = new URL(redirectUri);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("META_REDIRECT_URI_INVALID");
  }
  return { appId, appSecret, redirectUri, graphApiVersion };
}

/**
 * Safe for UI/status responses: it reveals only whether the server has a
 * complete Meta App configuration, never which value is missing or secret.
 */
export function isMetaAppConfigured(env = Deno.env.toObject()): boolean {
  try {
    readMetaAppConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function createOAuthState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(
    /\//g,
    "_",
  ).replace(/=+$/g, "");
}

export async function hashOAuthState(state: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function buildMetaAuthorizeUrl(config: MetaAppConfig, state: string) {
  const url = new URL(
    `https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`,
  );
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_READ_SCOPES.join(","));
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type MetaPageCandidate = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramUserId: string;
  instagramUsername: string;
};

export type MetaOAuthExchange = {
  facebookUserId: string;
  userAccessToken: string;
  expiresAt: string | null;
  grantedScopes: string[];
  /** False means Graph did not prove the grants; every capability must fail closed. */
  permissionsVerified: boolean;
  pages: MetaPageCandidate[];
};

export type MetaInstagramDiscoveryTelemetry = {
  pages_seen: number;
  pages_with_access_token: number;
  pages_with_instagram_account_id: number;
  pages_with_username: number;
  eligible_pages: number;
};

type MetaInstagramDiscoveryLogger = (
  event: "META_INSTAGRAM_DISCOVERY",
  counts: MetaInstagramDiscoveryTelemetry,
) => void;

export async function exchangeMetaOAuthCode(
  config: MetaAppConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
  logDiscovery: MetaInstagramDiscoveryLogger = console.info,
): Promise<MetaOAuthExchange> {
  if (!code || code.length > 4096) throw new Error("META_OAUTH_CODE_INVALID");
  const exchangeUrl = new URL(
    `https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`,
  );
  exchangeUrl.searchParams.set("client_id", config.appId);
  exchangeUrl.searchParams.set("client_secret", config.appSecret);
  exchangeUrl.searchParams.set("redirect_uri", config.redirectUri);
  exchangeUrl.searchParams.set("code", code);
  const tokenResponse = await fetchImpl(exchangeUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
  });
  const tokenJson = asRecord(await tokenResponse.json());
  const shortToken = stringValue(tokenJson.access_token);
  if (!tokenResponse.ok || !shortToken) {
    throw new Error("META_TOKEN_EXCHANGE_FAILED");
  }

  const longUrl = new URL(
    `https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`,
  );
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", config.appId);
  longUrl.searchParams.set("client_secret", config.appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  const longResponse = await fetchImpl(longUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
  });
  const longJson = asRecord(await longResponse.json());
  const userAccessToken = stringValue(longJson.access_token);
  if (!longResponse.ok || !userAccessToken) {
    throw new Error("META_TOKEN_RENEWAL_FAILED");
  }
  const expiresIn = Number(longJson.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const graphGetWithToken = async (
    path: string,
    fields: string,
    accessToken: string,
    params: Record<string, string> = {},
  ) => {
    const url = new URL(
      `/${config.graphApiVersion}/${path}`,
      META_GRAPH_ORIGIN,
    );
    url.searchParams.set("fields", fields);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    });
    const json = asRecord(await response.json());
    if (!response.ok || json.error) {
      throw new Error("META_ACCOUNT_DISCOVERY_FAILED");
    }
    return json;
  };
  const graphGet = (
    path: string,
    fields: string,
    params: Record<string, string> = {},
  ) => graphGetWithToken(path, fields, userAccessToken, params);
  const [me, permissionResult] = await Promise.all([
    graphGet("me", "id"),
    graphGet("me/permissions", "permission,status").then(
      (permissions) => ({ permissions, verified: true }),
      () => ({ permissions: {}, verified: false }),
    ),
  ]);
  const facebookUserId = stringValue(me.id);
  if (!facebookUserId) throw new Error("META_ACCOUNT_DISCOVERY_FAILED");
  const permissionPayload = asRecord(permissionResult.permissions);
  const permissionRows: unknown[] = Array.isArray(permissionPayload.data)
    ? permissionPayload.data
    : [];
  const grantedScopes: string[] = permissionResult.verified
    ? permissionRows.map(asRecord).filter((
      permission: Record<string, unknown>,
    ) => permission.status === "granted").map((
      permission: Record<string, unknown>,
    ) => stringValue(permission.permission)).filter((
      scope: string | null,
    ): scope is string => Boolean(scope))
    : [];

  const pagesById = new Map<string, MetaPageCandidate>();
  const telemetry: MetaInstagramDiscoveryTelemetry = {
    pages_seen: 0,
    pages_with_access_token: 0,
    pages_with_instagram_account_id: 0,
    pages_with_username: 0,
    eligible_pages: 0,
  };
  let sawManagedPage = false;
  let sawLinkedInstagram = false;
  let sawProfileLookupFailure = false;
  const seenCursors = new Set<string>();
  let after: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_ACCOUNT_PAGES; pageNumber++) {
    let accounts: Record<string, unknown>;
    try {
      accounts = await graphGet(
        "me/accounts",
        "id,name,access_token,tasks,instagram_business_account",
        after ? { after } : {},
      );
    } catch (error) {
      if (pageNumber > 0) {
        throw new Error("META_ACCOUNT_DISCOVERY_PARTIAL_FAILED");
      }
      throw error;
    }
    const rawPages = Array.isArray(accounts.data) ? accounts.data : [];
    for (const rawPage of rawPages) {
      sawManagedPage = true;
      telemetry.pages_seen += 1;
      const page = asRecord(rawPage);
      const instagram = asRecord(page.instagram_business_account);
      const candidate = {
        pageId: stringValue(page.id),
        pageName: stringValue(page.name),
        pageAccessToken: stringValue(page.access_token),
        instagramUserId: stringValue(instagram.id),
        instagramUsername: stringValue(instagram.username),
      };
      if (candidate.pageAccessToken) telemetry.pages_with_access_token += 1;
      if (candidate.instagramUserId) {
        sawLinkedInstagram = true;
        telemetry.pages_with_instagram_account_id += 1;
      }
      if (
        candidate.pageId && candidate.pageName && candidate.pageAccessToken &&
        candidate.instagramUserId
      ) {
        if (!candidate.instagramUsername) {
          try {
            const profile = await graphGetWithToken(
              candidate.instagramUserId,
              "username",
              candidate.pageAccessToken,
            );
            candidate.instagramUsername = stringValue(profile.username);
          } catch {
            sawProfileLookupFailure = true;
          }
        }
        if (candidate.instagramUsername) {
          telemetry.pages_with_username += 1;
          telemetry.eligible_pages += 1;
          pagesById.set(candidate.pageId, candidate as MetaPageCandidate);
        } else {
          sawProfileLookupFailure = true;
        }
      }
      if (pagesById.size > MAX_ACCOUNT_ITEMS) {
        throw new Error("META_ACCOUNT_DISCOVERY_LIMIT_REACHED");
      }
    }
    const paging = asRecord(accounts.paging);
    const cursors = asRecord(paging.cursors);
    const nextAfter = stringValue(cursors.after);
    if (!nextAfter) break;
    if (seenCursors.has(nextAfter)) {
      throw new Error("META_ACCOUNT_DISCOVERY_PARTIAL_FAILED");
    }
    seenCursors.add(nextAfter);
    after = nextAfter;
    if (pageNumber + 1 === MAX_ACCOUNT_PAGES) {
      throw new Error("META_ACCOUNT_DISCOVERY_LIMIT_REACHED");
    }
  }
  logDiscovery("META_INSTAGRAM_DISCOVERY", telemetry);
  if (!sawManagedPage) throw new Error("META_NO_MANAGED_PAGE");
  if (!sawLinkedInstagram) {
    throw new Error("META_NO_LINKED_PROFESSIONAL_INSTAGRAM");
  }
  if (!pagesById.size && sawProfileLookupFailure) {
    throw new Error("META_INSTAGRAM_PROFILE_LOOKUP_FAILED");
  }
  if (!pagesById.size) throw new Error("META_NO_ELIGIBLE_INSTAGRAM_ACCOUNT");
  return {
    facebookUserId,
    userAccessToken,
    expiresAt,
    grantedScopes: [...new Set(grantedScopes)].sort(),
    permissionsVerified: permissionResult.verified,
    pages: [...pagesById.values()],
  };
}

export function capabilitiesFromScopes(scopes: string[]) {
  const granted = new Set(scopes);
  const radarRead = [
    "pages_show_list",
    "pages_read_engagement",
    "instagram_basic",
  ].every((scope) => granted.has(scope));
  return {
    radar_read: radarRead,
    publishing: granted.has("instagram_content_publish"),
    comments: granted.has("instagram_manage_comments"),
    messages: granted.has("instagram_manage_messages"),
  };
}

export function sanitizeMetaError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error || "");
  return /^META_[A-Z_]+$/.test(code) ? code : "META_CONNECTION_FAILED";
}
