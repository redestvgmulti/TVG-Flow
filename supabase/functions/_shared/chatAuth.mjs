const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ChatAuthorizationError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "ChatAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

function readBearerToken(authorization) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new ChatAuthorizationError("AUTH_REQUIRED", 401);
  return token;
}

function scalarUuid(value) {
  if (typeof value === "string" && UUID_PATTERN.test(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === "string" && UUID_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

function mapTenantError(error) {
  const text = error instanceof Error ? error.message : String(error?.message ?? error ?? "");
  if (text.includes("OPERATIONAL_CLIENT_SELECTION_REQUIRED")) {
    throw new ChatAuthorizationError("OPERATIONAL_CLIENT_SELECTION_REQUIRED", 409);
  }
  if (text.includes("OPERATIONAL_CLIENT_NOT_FOUND")) {
    throw new ChatAuthorizationError("OPERATIONAL_CLIENT_NOT_FOUND", 403);
  }
  throw new ChatAuthorizationError("TENANT_FORBIDDEN", 403);
}

export async function authorizePrivateChat({ authorization, createUserClient }) {
  const token = readBearerToken(authorization);
  const userSupabase = createUserClient(token);
  const { data: userData, error: userError } = await userSupabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId || !UUID_PATTERN.test(userId)) {
    throw new ChatAuthorizationError("AUTH_INVALID", 401);
  }

  const { data: identity, error: identityError } = await userSupabase.rpc("get_current_identity");
  if (identityError || !identity || identity.id !== userId || identity.ativo !== true) {
    throw new ChatAuthorizationError("PROFILE_INACTIVE", 403);
  }
  if (identity.access_ready !== true) {
    throw new ChatAuthorizationError("IDENTITY_INVALID", 403);
  }

  const { data: resolvedClienteId, error: resolverError } = await userSupabase
    .rpc("require_single_operational_cliente_id");
  if (resolverError) mapTenantError(resolverError);
  const clienteId = scalarUuid(resolvedClienteId);
  if (!clienteId) throw new ChatAuthorizationError("TENANT_FORBIDDEN", 403);

  return { userId, clienteId };
}

export { UUID_PATTERN };
