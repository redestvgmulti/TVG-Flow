import { createOAuthState, hashOAuthState } from "./metaOAuth.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}
async function rejects(
  action: () => unknown | Promise<unknown>,
  expected: string,
) {
  try {
    await action();
  } catch (error) {
    if (String(error).includes(expected)) return;
    throw error;
  }
  throw new Error(`Expected ${expected}`);
}

type State = {
  hash: string;
  userId: string;
  clienteId: string;
  expiresAt: number;
  consumed: boolean;
};
type Candidate = {
  id: string;
  pageId: string;
  pageName: string;
  instagramId: string;
  username: string;
  pageSecret: string;
};
type Connection = {
  clienteId: string;
  username: string;
  pageName: string;
  pageSecret: string;
  userSecret: string;
  connected: boolean;
};

class MockMetaConnectionServer {
  states: State[] = [];
  connections: Connection[] = [];
  candidates: Candidate[] = [];
  selection: { userId: string; clienteId: string; userSecret: string } | null =
    null;
  vault = new Set<string>();
  sources = 0;
  collectedNews = 0;
  notifications = 0;
  polls = 0;
  publications = 0;
  now = 1_000_000;
  async start(userId: string, clienteId: string) {
    const raw = createOAuthState();
    this.states.push({
      hash: await hashOAuthState(raw),
      userId,
      clienteId,
      expiresAt: this.now + 600_000,
      consumed: false,
    });
    return raw;
  }
  async callback(
    rawState: string,
    code: string,
    pages: Omit<Candidate, "id" | "pageSecret">[],
  ) {
    if (!code) throw new Error("META_OAUTH_CALLBACK_INVALID");
    const hash = await hashOAuthState(rawState);
    const state = this.states.find((value) =>
      value.hash === hash && !value.consumed && value.expiresAt > this.now
    );
    if (!state) throw new Error("META_OAUTH_STATE_INVALID");
    state.consumed = true;
    const userSecret = `vault-user-${state.userId}`;
    this.vault.add(userSecret);
    const eligible = pages.filter((page) => page.instagramId && page.username);
    if (!eligible.length) {
      this.vault.delete(userSecret);
      throw new Error("META_NO_ELIGIBLE_INSTAGRAM_ACCOUNT");
    }
    if (eligible.length === 1) {
      const page = eligible[0];
      const pageSecret = `vault-page-${page.pageId}`;
      this.vault.add(pageSecret);
      this.connections.push({
        clienteId: state.clienteId,
        username: page.username,
        pageName: page.pageName,
        pageSecret,
        userSecret,
        connected: true,
      });
      return { status: "connected" };
    }
    this.candidates = eligible.map((page, index) => {
      const pageSecret = `vault-page-${page.pageId}`;
      this.vault.add(pageSecret);
      return { ...page, id: `candidate-${index}`, pageSecret };
    });
    this.selection = {
      userId: state.userId,
      clienteId: state.clienteId,
      userSecret,
    };
    return { status: "select" };
  }
  select(
    userId: string,
    clienteId: string,
    candidateId: string,
    userSecret: string,
  ) {
    const candidate = this.candidates.find((value) => value.id === candidateId);
    if (
      !candidate || !this.selection || this.selection.userId !== userId ||
      this.selection.clienteId !== clienteId ||
      this.selection.userSecret !== userSecret || !this.vault.has(userSecret)
    ) throw new Error("META_SELECTION_INVALID");
    this.connections.push({
      clienteId,
      username: candidate.username,
      pageName: candidate.pageName,
      pageSecret: candidate.pageSecret,
      userSecret,
      connected: true,
    });
    for (const other of this.candidates) {
      if (other.id !== candidate.id) this.vault.delete(other.pageSecret);
    }
    this.candidates = [];
    this.selection = null;
    return { connected: true, userId };
  }
  status(userId: string, clienteId: string) {
    const connection = this.connections.find((value) =>
      value.clienteId === clienteId && value.connected
    );
    return connection
      ? {
        connected: true,
        username: connection.username,
        page_name: connection.pageName,
      }
      : { connected: false };
  }
  disconnect(userId: string, clienteId: string) {
    const connection = this.connections.find((value) =>
      value.clienteId === clienteId && value.connected
    );
    if (!connection) return { disconnected: true, userId };
    connection.connected = false;
    this.vault.delete(connection.pageSecret);
    this.vault.delete(connection.userSecret);
    return { disconnected: true, userId };
  }
}

Deno.test("mock certification: Connect, redirect, callback, stored connection, status and disconnect", async () => {
  const server = new MockMetaConnectionServer();
  const state = await server.start("admin-a", "tenant-a");
  const redirect = await server.callback(state, "mock-code", [{
    pageId: "p1",
    pageName: "TVG Multi",
    instagramId: "ig1",
    username: "tvgmulti",
  }]);
  equal(redirect.status, "connected");
  equal(server.status("admin-a", "tenant-a"), {
    connected: true,
    username: "tvgmulti",
    page_name: "TVG Multi",
  });
  equal(server.vault.size, 2);
  equal(server.disconnect("admin-a", "tenant-a").disconnected, true);
  equal(server.status("admin-a", "tenant-a").connected, false);
  equal(server.vault.size, 0);
  equal([
    server.sources,
    server.collectedNews,
    server.notifications,
    server.polls,
    server.publications,
  ], [0, 0, 0, 0, 0]);
});

Deno.test("state is random, valid once, expiring and tenant-isolated", async () => {
  const server = new MockMetaConnectionServer();
  const state = await server.start("admin-a", "tenant-a");
  await rejects(
    () => server.callback("invalid", "code", []),
    "META_OAUTH_STATE_INVALID",
  );
  await server.callback(state, "code", [{
    pageId: "p1",
    pageName: "A",
    instagramId: "ig1",
    username: "a",
  }]);
  await rejects(
    () => server.callback(state, "code", []),
    "META_OAUTH_STATE_INVALID",
  );
  const expired = await server.start("admin-a", "tenant-a");
  server.now += 600_001;
  await rejects(
    () => server.callback(expired, "code", []),
    "META_OAUTH_STATE_INVALID",
  );
  equal(server.status("admin-b", "tenant-b"), { connected: false });
});

Deno.test("multiple eligible Pages require explicit selection and Pages without Instagram cannot connect", async () => {
  const server = new MockMetaConnectionServer();
  const state = await server.start("admin-a", "tenant-a");
  const pending = await server.callback(state, "code", [
    { pageId: "p1", pageName: "A", instagramId: "ig1", username: "one" },
    { pageId: "p2", pageName: "B", instagramId: "ig2", username: "two" },
  ]);
  equal(pending.status, "select");
  equal(server.status("admin-a", "tenant-a"), { connected: false });
  await rejects(
    () =>
      Promise.resolve(
        server.select(
          "admin-b",
          "tenant-b",
          "candidate-0",
          server.selection!.userSecret,
        ),
      ),
    "META_SELECTION_INVALID",
  );
  server.select(
    "admin-a",
    "tenant-a",
    "candidate-1",
    server.selection!.userSecret,
  );
  equal(server.status("admin-a", "tenant-a").username, "two");
  const empty = await server.start("admin-a", "tenant-a");
  await rejects(
    () =>
      server.callback(empty, "code", [{
        pageId: "p3",
        pageName: "No IG",
        instagramId: "",
        username: "",
      }]),
    "META_NO_ELIGIBLE_INSTAGRAM_ACCOUNT",
  );
});

Deno.test("local disconnect is tenant-scoped even when Meta user identity is shared", () => {
  const server = new MockMetaConnectionServer();
  server.connections.push(
    { clienteId: "tenant-a", username: "a", pageName: "A", pageSecret: "vault-page-a", userSecret: "vault-user-a", connected: true },
    { clienteId: "tenant-b", username: "b", pageName: "B", pageSecret: "vault-page-b", userSecret: "vault-user-b", connected: true },
  );
  server.vault.add("vault-page-a"); server.vault.add("vault-user-a");
  server.vault.add("vault-page-b"); server.vault.add("vault-user-b");
  equal(server.disconnect("admin-a", "tenant-a").disconnected, true);
  equal(server.status("admin-b", "tenant-b").connected, true);
  equal(server.vault.has("vault-page-b"), true);
  equal(server.vault.has("vault-user-b"), true);
});
