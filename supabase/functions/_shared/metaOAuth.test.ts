import {
  buildMetaAuthorizeUrl,
  capabilitiesFromScopes,
  createOAuthState,
  exchangeMetaOAuthCode,
  hashOAuthState,
  isMetaAppConfigured,
  readMetaAppConfig,
  sanitizeMetaError,
} from "./metaOAuth.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}
function assertMatch(actual: string, expected: RegExp) {
  if (!expected.test(actual)) {
    throw new Error(`Expected ${actual} to match ${expected}`);
  }
}
async function assertRejects(
  action: () => unknown | Promise<unknown>,
  expectedMessage: string,
) {
  try {
    await action();
  } catch (error) {
    if (String(error).includes(expectedMessage)) return;
    throw error;
  }
  throw new Error(`Expected rejection: ${expectedMessage}`);
}

const env = {
  META_APP_ID: "123456",
  META_APP_SECRET: "fixture-app-secret",
  META_OAUTH_REDIRECT_URI:
    "https://callback.example.test/meta/oauth/callback",
  META_GRAPH_API_VERSION: "v99.0",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.test("OAuth authorization URL is Meta HTTPS, configured-version and state-bound", () => {
  const state = createOAuthState();
  assertMatch(state, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(buildMetaAuthorizeUrl(readMetaAppConfig(env), state));
  assertEquals(url.origin, "https://www.facebook.com");
  assertEquals(url.pathname, "/v99.0/dialog/oauth");
  assertEquals(url.searchParams.get("state"), state);
  assertEquals(
    url.searchParams.get("scope"),
    "pages_show_list,pages_read_engagement,instagram_basic",
  );
  assertEquals(url.searchParams.has("client_secret"), false);
});

Deno.test("state hashes are stable and raw values are not database-shaped", async () => {
  const state = createOAuthState();
  assertMatch(await hashOAuthState(state), /^[a-f0-9]{64}$/);
  assertEquals(await hashOAuthState(state), await hashOAuthState(state));
});

Deno.test("Meta application configuration is complete, HTTPS and version-configured", async () => {
  assertEquals(readMetaAppConfig(env).graphApiVersion, "v99.0");
  assertEquals(isMetaAppConfigured(env), true);
  assertEquals(isMetaAppConfigured({}), false);
  for (
    const bad of [
      {},
      { ...env, META_GRAPH_API_VERSION: "latest" },
      { ...env, META_GRAPH_API_VERSION: "v1" },
      { ...env, META_OAUTH_REDIRECT_URI: "http://example.test/callback" },
    ]
  ) {
    await assertRejects(
      async () => readMetaAppConfig(bad as typeof env),
      "META_",
    );
  }
});

Deno.test("token exchange discovers one eligible Page and never puts tokens in URLs after exchange", async () => {
  const calls: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (
      url.pathname.endsWith("/oauth/access_token") &&
      url.searchParams.get("grant_type") !== "fb_exchange_token"
    ) return json({ access_token: "short-token" });
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({ access_token: "long-token", expires_in: 5184000 });
    }
    if (url.pathname.endsWith("/me")) {
      return json({
        id: "111",
        permissions: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "pages_show_list", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "instagram_content_publish", status: "declined" },
        ],
      });
    }
    return json({
      data: [{
        id: "page-1",
        name: "Página TVG",
        access_token: "page-token",
        instagram_business_account: { id: "ig-1", username: "tvgmulti" },
      }],
    });
  };
  const result = await exchangeMetaOAuthCode(
    readMetaAppConfig(env),
    "code-fixture",
    fetchImpl,
  );
  assertEquals(result.facebookUserId, "111");
  assertEquals(result.pages[0].instagramUsername, "tvgmulti");
  assertEquals(
    calls.some((url) =>
      url.pathname.endsWith("/me/accounts") &&
      url.searchParams.get("fields") ===
        "id,name,access_token,tasks,instagram_business_account"
    ),
    true,
  );
  assertEquals(
    result.grantedScopes.includes("instagram_content_publish"),
    false,
  );
  assertEquals(calls[2].searchParams.has("access_token"), false);
  assertEquals(calls[3].searchParams.has("access_token"), false);
});

Deno.test("Page with an IG id but no nested username resolves username with its Page token", async () => {
  const calls: Array<{ url: URL; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type") ? "long" : "short",
      });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "user-1" });
    if (url.pathname.endsWith("/me/permissions")) {
      return json({ data: META_GRANTED_PERMISSIONS });
    }
    if (url.pathname.endsWith("/ig-1")) {
      return json({ username: "tvgdescubra" });
    }
    return json({
      data: [{
        id: "page-1",
        name: "TVG Descubra",
        access_token: "page-token",
        instagram_business_account: { id: "ig-1" },
      }],
    });
  };
  const result = await exchangeMetaOAuthCode(
    readMetaAppConfig(env),
    "code",
    fetchImpl,
  );
  assertEquals(result.pages[0].instagramUsername, "tvgdescubra");
  const profileCall = calls.find(({ url }) => url.pathname.endsWith("/ig-1"));
  assertEquals(profileCall?.url.searchParams.get("fields"), "username");
  assertEquals(profileCall?.authorization, "Bearer page-token");
});

Deno.test("linked Instagram absence, managed Page absence, token failures and Meta errors stay deterministic", async () => {
  const pagesOnly = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (
      url.pathname.endsWith("/oauth/access_token") &&
      !url.searchParams.get("grant_type")
    ) return json({ access_token: "short" });
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({ access_token: "long" });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "1", permissions: [] });
    return json({
      data: [{
        id: "page-without-ig",
        name: "Página sem Instagram",
        access_token: "page-token",
      }],
    });
  };
  await assertRejects(
    () =>
      exchangeMetaOAuthCode(
        readMetaAppConfig(env),
        "code",
        pagesOnly as typeof fetch,
      ),
    "META_NO_LINKED_PROFESSIONAL_INSTAGRAM",
  );
  const noPages: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type") ? "long" : "short",
      });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "1" });
    return json({ data: [] });
  };
  await assertRejects(
    () => exchangeMetaOAuthCode(readMetaAppConfig(env), "code", noPages),
    "META_NO_MANAGED_PAGE",
  );
  await assertRejects(
    () =>
      exchangeMetaOAuthCode(
        readMetaAppConfig(env),
        "code",
        async () => json({ error: { code: 190 } }, 400),
      ),
    "META_TOKEN_EXCHANGE_FAILED",
  );
  await assertRejects(
    () =>
      exchangeMetaOAuthCode(
        readMetaAppConfig(env),
        "",
        pagesOnly as typeof fetch,
      ),
    "META_OAUTH_CODE_INVALID",
  );
});

Deno.test("IG profile lookup failure is distinguished from no linked professional Instagram", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type") ? "long" : "short",
      });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "user-1" });
    if (url.pathname.endsWith("/me/permissions")) {
      return json({ data: META_GRANTED_PERMISSIONS });
    }
    if (url.pathname.endsWith("/ig-1")) {
      return json({ error: { code: 10 } }, 400);
    }
    return json({
      data: [{
        id: "page-1",
        name: "TVG Descubra",
        access_token: "page-token",
        instagram_business_account: { id: "ig-1" },
      }],
    });
  };
  await assertRejects(
    () => exchangeMetaOAuthCode(readMetaAppConfig(env), "code", fetchImpl),
    "META_INSTAGRAM_PROFILE_LOOKUP_FAILED",
  );
});

Deno.test("discovery telemetry contains only aggregate counts", async () => {
  const events: Array<{ event: string; counts: unknown }> = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type")
          ? "long-secret-token"
          : "short-secret-token",
      });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "facebook-user-id" });
    if (url.pathname.endsWith("/me/permissions")) {
      return json({ data: META_GRANTED_PERMISSIONS });
    }
    if (url.pathname.endsWith("/instagram-id")) {
      return json({ username: "private-username" });
    }
    return json({
      data: [{
        id: "page-id",
        name: "Private Page",
        access_token: "page-secret-token",
        instagram_business_account: { id: "instagram-id" },
      }],
    });
  };
  await exchangeMetaOAuthCode(
    readMetaAppConfig(env),
    "oauth-code-secret",
    fetchImpl,
    (event, counts) => events.push({ event, counts }),
  );
  assertEquals(events, [{
    event: "META_INSTAGRAM_DISCOVERY",
    counts: {
      pages_seen: 1,
      pages_with_access_token: 1,
      pages_with_instagram_account_id: 1,
      pages_with_username: 1,
      eligible_pages: 1,
    },
  }]);
  const logged = JSON.stringify(events);
  for (
    const sensitiveValue of [
      "oauth-code-secret",
      "short-secret-token",
      "long-secret-token",
      "page-secret-token",
      "facebook-user-id",
      "instagram-id",
      "private-username",
    ]
  ) {
    assertEquals(logged.includes(sensitiveValue), false);
  }
});

Deno.test("account discovery includes eligible Pages beyond the first response page", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type")
          ? "long-token"
          : "short-token",
      });
    }
    if (url.pathname.endsWith("/me")) {
      return json({ id: "111", permissions: META_GRANTED_PERMISSIONS });
    }
    const page = url.searchParams.get("after") === "next-page" ? "2" : "1";
    return json({
      data: [{
        id: `page-${page}`,
        name: `Page ${page}`,
        access_token: `page-token-${page}`,
        instagram_business_account: {
          id: `ig-${page}`,
          username: `account${page}`,
        },
      }],
      ...(page === "1" ? { paging: { cursors: { after: "next-page" } } } : {}),
    });
  };
  const result = await exchangeMetaOAuthCode(
    readMetaAppConfig(env),
    "code",
    fetchImpl,
  );
  assertEquals(result.pages.map((page) => page.instagramUserId), [
    "ig-1",
    "ig-2",
  ]);
});

Deno.test("missing permission evidence never grants Radar capability", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type")
          ? "long-token"
          : "short-token",
      });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "111" });
    return json({
      data: [{
        id: "page-1",
        name: "Page 1",
        access_token: "page-token",
        instagram_business_account: { id: "ig-1", username: "account1" },
      }],
    });
  };
  const result = await exchangeMetaOAuthCode(
    readMetaAppConfig(env),
    "code",
    fetchImpl,
  );
  assertEquals(result.grantedScopes, []);
  assertEquals(capabilitiesFromScopes(result.grantedScopes).radar_read, false);
});

Deno.test("declined, empty, malformed and failed permission responses fail closed", async () => {
  for (
    const permissions of [
      {
        data: META_GRANTED_PERMISSIONS.map((item) =>
          item.permission === "instagram_basic"
            ? { ...item, status: "declined" }
            : item
        ),
      },
      { data: [] },
      { unexpected: true },
      null,
    ]
  ) {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/oauth/access_token")) {
        return json({
          access_token: url.searchParams.has("grant_type") ? "long" : "short",
        });
      }
      if (url.pathname.endsWith("/me/permissions")) {
        if (permissions === null) return json({ error: { code: 190 } }, 400);
        return json(permissions);
      }
      if (url.pathname.endsWith("/me")) return json({ id: "111" });
      return json({
        data: [{
          id: "page",
          name: "Page",
          access_token: "page-token",
          instagram_business_account: { id: "ig", username: "account" },
        }],
      });
    };
    const result = await exchangeMetaOAuthCode(
      readMetaAppConfig(env),
      "code",
      fetchImpl,
    );
    assertEquals(
      capabilitiesFromScopes(result.grantedScopes).radar_read,
      false,
    );
  }
});

Deno.test("repeated cursors and account pagination limits fail explicitly", async () => {
  const repeated: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type") ? "long" : "short",
      });
    }
    if (url.pathname.endsWith("/me/permissions")) {
      return json({ data: META_GRANTED_PERMISSIONS });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "111" });
    return json({ data: [], paging: { cursors: { after: "repeat" } } });
  };
  await assertRejects(
    () => exchangeMetaOAuthCode(readMetaAppConfig(env), "code", repeated),
    "META_ACCOUNT_DISCOVERY_PARTIAL_FAILED",
  );
  let calls = 0;
  const overLimit: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) {
      return json({
        access_token: url.searchParams.has("grant_type") ? "long" : "short",
      });
    }
    if (url.pathname.endsWith("/me/permissions")) {
      return json({ data: META_GRANTED_PERMISSIONS });
    }
    if (url.pathname.endsWith("/me")) return json({ id: "111" });
    calls += 1;
    return json({
      data: [],
      paging: { cursors: { after: `cursor-${calls}` } },
    });
  };
  await assertRejects(
    () => exchangeMetaOAuthCode(readMetaAppConfig(env), "code", overLimit),
    "META_ACCOUNT_DISCOVERY_LIMIT_REACHED",
  );
});

const META_GRANTED_PERMISSIONS = [
  { permission: "instagram_basic", status: "granted" },
  { permission: "pages_show_list", status: "granted" },
  { permission: "pages_read_engagement", status: "granted" },
];

Deno.test("capabilities are independent and error output is sanitized", () => {
  assertEquals(
    capabilitiesFromScopes([
      "pages_show_list",
      "pages_read_engagement",
      "instagram_basic",
    ]),
    {
      radar_read: true,
      publishing: false,
      comments: false,
      messages: false,
    },
  );
  assertEquals(
    capabilitiesFromScopes(["instagram_content_publish"]).publishing,
    true,
  );
  assertEquals(
    sanitizeMetaError(new Error("META_OAUTH_STATE_INVALID")),
    "META_OAUTH_STATE_INVALID",
  );
  assertEquals(
    sanitizeMetaError(new Error("raw token fixture")),
    "META_CONNECTION_FAILED",
  );
});
