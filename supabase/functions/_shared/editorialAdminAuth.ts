import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeConfigRequest,
  ConfigAuthorizationError,
} from "../ap-config/authorization.ts";

export async function requireEditorialAdmin(
  req: Request,
  _supabaseAdmin: SupabaseClient,
  clienteId: string,
) {
  try {
    // Keep editorial administration on the same identity and operational-client
    // policy as ap-config. The older operatorAuth tenant-membership check could
    // reject an active administrator that was already allowed to operate the
    // very same client everywhere else in AutoPublisher.
    const authorization = await authorizeConfigRequest({
      authorization: req.headers.get("Authorization"),
      requestedClienteId: clienteId,
      createUserClient: (token) => createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        },
      ),
    });
    if (authorization.role !== "admin") {
      throw new EditorialAdminAuthorizationError(403);
    }
    return authorization;
  } catch (error) {
    const status = error instanceof ConfigAuthorizationError
      ? error.status
      : error instanceof EditorialAdminAuthorizationError
        ? error.status
        : 403;
    throw new EditorialAdminAuthorizationError(status);
  }
}

export class EditorialAdminAuthorizationError extends Error {
  status: number;

  constructor(status: number) {
    super("EDITORIAL_ADMIN_REQUIRED");
    this.name = "EditorialAdminAuthorizationError";
    this.status = status;
  }
}
