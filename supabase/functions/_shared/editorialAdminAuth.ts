import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireActiveOperator } from "./operatorAuth.ts";
import {
  authorizeOperationalTenant,
  TenantAuthorizationError,
} from "../ap-employee-generator/tenantAuthorization.ts";

export async function requireEditorialAdmin(
  req: Request,
  supabaseAdmin: SupabaseClient,
  clienteId: string,
) {
  try {
    await requireActiveOperator(req, supabaseAdmin, ["admin"]);
    return await authorizeOperationalTenant({
      authorization: req.headers.get("Authorization"),
      requestedClienteId: clienteId,
      requestedAuthUserId: null,
      createUserClient: (token) => createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      ),
    });
  } catch (error) {
    const status = error instanceof TenantAuthorizationError
      ? error.status
      : error instanceof Error && error.message.startsWith("UNAUTHORIZED") ? 401 : 403;
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
