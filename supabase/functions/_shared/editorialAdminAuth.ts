import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeConfigRequest,
  ConfigAuthorizationError,
} from "../ap-config/authorization.ts";
import {
  toEditorialAuthorizationCode,
  type EditorialAuthorizationCode,
} from "./editorialTenantErrors.ts";

export async function requireEditorialAdmin(
  req: Request,
  _supabaseAdmin: SupabaseClient,
  requestedClienteId?: unknown,
) {
  try {
    // Keep editorial administration on the same identity and operational-client
    // policy as ap-config. The older operatorAuth tenant-membership check could
    // reject an active administrator that was already allowed to operate the
    // very same client everywhere else in AutoPublisher.
    const authorization = await authorizeConfigRequest({
      authorization: req.headers.get("Authorization"),
      // Editorial configuration never accepts a tenant chosen by the browser.
      // The optional argument remains only for legacy non-editorial consumers of
      // this shared authorization wrapper; editorial endpoints call this helper
      // without it and therefore use the canonical fail-closed resolver.
      requestedClienteId,
      createUserClient: (token) => createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        },
      ),
    });
    if (authorization.role !== "admin" && authorization.role !== "super_admin") {
      throw new EditorialAdminAuthorizationError("EDITORIAL_ADMIN_REQUIRED", 403);
    }
    return authorization;
  } catch (error) {
    if (error instanceof ConfigAuthorizationError) {
      const code = toEditorialAuthorizationCode(error.code);
      throw new EditorialAdminAuthorizationError(code, error.status);
    }
    if (error instanceof EditorialAdminAuthorizationError) throw error;
    throw new EditorialAdminAuthorizationError("EDITORIAL_ADMIN_REQUIRED", 403);
  }
}

export class EditorialAdminAuthorizationError extends Error {
  code: EditorialAuthorizationCode;
  status: number;

  constructor(
    code: EditorialAuthorizationCode,
    status: number,
  ) {
    super(code);
    this.name = "EditorialAdminAuthorizationError";
    this.code = code;
    this.status = status;
  }
}
