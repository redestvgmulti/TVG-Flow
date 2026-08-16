/**
 * Role Normalization Utility
 * 
 * Enforces canonical roles across the application.
 * Only these roles should ever exist in memory/state:
 * - 'super_admin'
 * - 'admin'
 * - 'staff'
 * 
 * The temporary `profissional` alias remains readable during rollout. Unknown
 * or missing roles fail closed and never gain staff access implicitly.
 */

export const CANONICAL_ROLES = {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    STAFF: 'staff'
}

/**
 * Normalizes a raw role string from the database into a canonical application role.
 * 
 * Mappings:
 * - 'super_admin' -> 'super_admin'
 * - 'admin' -> 'admin'
 * - 'staff' -> 'staff'
 * - 'profissional' -> 'staff' (Legacy mapping)
 * - anything else -> null (fail closed)
 * 
 * @param {string|null} rawRole - The role string from database or auth provider
 * @returns {'super_admin'|'admin'|'staff'|null} - The canonical role
 */
export function normalizeRole(rawRole) {
    if (!rawRole) return null

    const normalized = String(rawRole).toLowerCase().trim()

    switch (normalized) {
        case 'super_admin':
            return CANONICAL_ROLES.SUPER_ADMIN
        case 'admin':
            return CANONICAL_ROLES.ADMIN
        case 'staff':
        case 'profissional': // Legacy role mapping
            return CANONICAL_ROLES.STAFF
        default:
            console.error(`[RoleNormalization] Unknown role '${rawRole}' denied`)
            return null
    }
}
