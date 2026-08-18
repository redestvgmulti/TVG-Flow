export type ConfigAuthorizationCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "PROFILE_INACTIVE"
  | "IDENTITY_INVALID"
  | "CONFIG_ROLE_FORBIDDEN"
  | "OPERATIONAL_CLIENT_NOT_FOUND"
  | "OPERATIONAL_CLIENT_SELECTION_REQUIRED"
  | "TENANT_FORBIDDEN";

export class ConfigAuthorizationError extends Error {
  code: ConfigAuthorizationCode;
  status: number;

  constructor(code: ConfigAuthorizationCode, status: number) {
    super(code);
    this.name = "ConfigAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export type ConfigAuthorization = {
  userId: string;
  role: "admin" | "super_admin";
  clienteId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readBearerToken(authorization: string | null) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new ConfigAuthorizationError("AUTH_REQUIRED", 401);
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

function allowedClienteIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(scalarUuid).filter((id): id is string => Boolean(id)))];
}

function mapResolverError(error: unknown): never {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (text.includes("OPERATIONAL_CLIENT_SELECTION_REQUIRED")) {
    throw new ConfigAuthorizationError("OPERATIONAL_CLIENT_SELECTION_REQUIRED", 409);
  }
  if (text.includes("OPERATIONAL_CLIENT_NOT_FOUND")) {
    throw new ConfigAuthorizationError("OPERATIONAL_CLIENT_NOT_FOUND", 403);
  }
  throw new ConfigAuthorizationError("TENANT_FORBIDDEN", 403);
}

export async function authorizeConfigRequest({
  authorization,
  requestedClienteId,
  createUserClient,
}: {
  authorization: string | null;
  requestedClienteId: unknown;
  createUserClient: (token: string) => any;
}): Promise<ConfigAuthorization> {
  const token = readBearerToken(authorization);
  const userSupabase = createUserClient(token);
  const { data: userData, error: userError } = await userSupabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId || !UUID_PATTERN.test(userId)) {
    throw new ConfigAuthorizationError("AUTH_INVALID", 401);
  }

  const { data: identity, error: identityError } = await userSupabase.rpc("get_current_identity");
  if (identityError || !identity || identity.id !== userId || identity.ativo !== true) {
    throw new ConfigAuthorizationError("PROFILE_INACTIVE", 403);
  }
  if (identity.access_ready !== true) {
    throw new ConfigAuthorizationError("IDENTITY_INVALID", 403);
  }
  if (identity.role !== "admin" && identity.role !== "super_admin") {
    throw new ConfigAuthorizationError("CONFIG_ROLE_FORBIDDEN", 403);
  }

  const requested = scalarUuid(requestedClienteId);
  if (requestedClienteId !== undefined && requestedClienteId !== null && requestedClienteId !== "" && !requested) {
    throw new ConfigAuthorizationError("TENANT_FORBIDDEN", 403);
  }

  if (identity.role === "super_admin") {
    if (!requested) {
      throw new ConfigAuthorizationError("OPERATIONAL_CLIENT_SELECTION_REQUIRED", 409);
    }
    const { data: cliente, error: clienteError } = await userSupabase
      .from("clientes")
      .select("id")
      .eq("id", requested)
      .eq("ativo", true)
      .maybeSingle();
    if (clienteError || !cliente?.id) {
      throw new ConfigAuthorizationError("TENANT_FORBIDDEN", 403);
    }
    return { userId, role: "super_admin", clienteId: requested };
  }

  const { data: allowedRows, error: allowedError } = await userSupabase
    .schema("ap")
    .rpc("get_operational_cliente_ids");
  const allowed = allowedClienteIds(allowedRows);
  if (allowedError || !allowed.length) {
    throw new ConfigAuthorizationError("OPERATIONAL_CLIENT_NOT_FOUND", 403);
  }

  if (requested) {
    if (!allowed.includes(requested)) {
      throw new ConfigAuthorizationError("TENANT_FORBIDDEN", 403);
    }
    return { userId, role: "admin", clienteId: requested };
  }

  const { data: resolvedClienteId, error: resolverError } = await userSupabase
    .rpc("require_single_operational_cliente_id");
  if (resolverError) mapResolverError(resolverError);
  const clienteId = scalarUuid(resolvedClienteId);
  if (!clienteId || !allowed.includes(clienteId)) {
    throw new ConfigAuthorizationError("TENANT_FORBIDDEN", 403);
  }
  return { userId, role: "admin", clienteId };
}
