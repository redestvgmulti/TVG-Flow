export type EditorialAuthorizationCode =
  | "EDITORIAL_ADMIN_REQUIRED"
  | "NO_OPERATIONAL_CLIENT"
  | "OPERATIONAL_CLIENT_SELECTION_REQUIRED";

export function toEditorialAuthorizationCode(code: string): EditorialAuthorizationCode {
  if (code === "OPERATIONAL_CLIENT_NOT_FOUND") return "NO_OPERATIONAL_CLIENT";
  if (code === "OPERATIONAL_CLIENT_SELECTION_REQUIRED") {
    return "OPERATIONAL_CLIENT_SELECTION_REQUIRED";
  }
  return "EDITORIAL_ADMIN_REQUIRED";
}
