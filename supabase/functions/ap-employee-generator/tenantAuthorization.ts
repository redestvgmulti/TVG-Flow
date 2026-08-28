export type AuthorizedTenant = {
  clienteId: string;
  userId: string;
};

export type TenantAuthorizationCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "TENANT_NOT_FOUND"
  | "TENANT_FORBIDDEN"
  | "AUTH_USER_MISMATCH";

export class TenantAuthorizationError extends Error {
  code: TenantAuthorizationCode;
  status: number;

  constructor(code: TenantAuthorizationCode, status: number) {
    super(code);
    this.name = "TenantAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readBearerToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) throw new TenantAuthorizationError("AUTH_REQUIRED", 401);
  return token;
}

function scalarUuid(value: unknown): string | null {
  if (typeof value === "string" && UUID_PATTERN.test(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    if (typeof candidate === "string" && UUID_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeAllowedClients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(scalarUuid)
        .filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
}

export async function authorizeOperationalTenant({
  authorization,
  requestedClienteId,
  requestedAuthUserId,
  createUserClient,
}: {
  authorization: string | null;
  requestedClienteId: unknown;
  requestedAuthUserId: unknown;
  createUserClient: (token: string) => any;
}): Promise<AuthorizedTenant> {
  const token = readBearerToken(authorization);
  const userSupabase = createUserClient(token);
  const { data: userData, error: userError } = await userSupabase.auth.getUser(
    token,
  );
  const userId = userData?.user?.id;
  if (userError || !userId || !UUID_PATTERN.test(userId)) {
    throw new TenantAuthorizationError("AUTH_INVALID", 401);
  }

  if (
    requestedAuthUserId !== undefined &&
    requestedAuthUserId !== null &&
    requestedAuthUserId !== "" &&
    requestedAuthUserId !== userId
  ) {
    throw new TenantAuthorizationError("AUTH_USER_MISMATCH", 403);
  }

  // A super administrator has no operational membership by design.  It may
  // operate only on an explicit, active client; this is the same fail-closed
  // tenant selection rule used by curated-ingestion administration.
  const { data: profile, error: profileError } = await userSupabase
    .from("profissionais")
    .select("role, ativo")
    .eq("id", userId)
    .maybeSingle();
  if (profileError || !profile || profile.ativo !== true) {
    throw new TenantAuthorizationError("TENANT_NOT_FOUND", 403);
  }
  if (profile.role === "super_admin") {
    if (typeof requestedClienteId !== "string" || !UUID_PATTERN.test(requestedClienteId)) {
      throw new TenantAuthorizationError("TENANT_NOT_FOUND", 403);
    }
    const { data: client, error: clientError } = await userSupabase
      .from("clientes")
      .select("id")
      .eq("id", requestedClienteId)
      .eq("ativo", true)
      .maybeSingle();
    if (clientError || !client?.id) {
      throw new TenantAuthorizationError("TENANT_FORBIDDEN", 403);
    }
    return { clienteId: requestedClienteId, userId };
  }

  const { data: allowedRows, error: allowedError } = await userSupabase
    .schema("ap")
    .rpc("get_operational_cliente_ids");
  if (allowedError) {
    throw new TenantAuthorizationError("TENANT_NOT_FOUND", 403);
  }
  const allowedClients = normalizeAllowedClients(allowedRows);
  if (!allowedClients.length) {
    throw new TenantAuthorizationError("TENANT_NOT_FOUND", 403);
  }

  if (
    requestedClienteId !== undefined &&
    requestedClienteId !== null &&
    requestedClienteId !== ""
  ) {
    if (
      typeof requestedClienteId !== "string" ||
      !UUID_PATTERN.test(requestedClienteId) ||
      !allowedClients.includes(requestedClienteId)
    ) {
      throw new TenantAuthorizationError("TENANT_FORBIDDEN", 403);
    }
    return { clienteId: requestedClienteId, userId };
  }

  if (allowedClients.length === 1) {
    return { clienteId: allowedClients[0], userId };
  }

  // The legacy agency resolver is accepted only as a preference within the
  // JWT-authorized tenant set. Its result is never an authorization source.
  const { data: operationalClienteId, error: operationalError } =
    await userSupabase.rpc("get_agencia_cliente_id");
  const normalizedOperationalId = scalarUuid(operationalClienteId);
  if (
    !operationalError &&
    normalizedOperationalId &&
    allowedClients.includes(normalizedOperationalId)
  ) {
    return { clienteId: normalizedOperationalId, userId };
  }

  throw new TenantAuthorizationError("TENANT_NOT_FOUND", 403);
}
