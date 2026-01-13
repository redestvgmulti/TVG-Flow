/**
 * Role Normalization Utility
 * 
 * Enforces canonical roles across the application.
 * Only these roles should ever exist in memory/state:
 * - 'super_admin'
 * - 'admin'
 * - 'staff'
 * 
 * Any other value (including 'profissional') is normalized to 'staff'.
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
 * - 'admin' -> 'admin'0.
 * - 'staff' -> 'staff'
 * - 'profissional' -> 'staff' (Legacy mapping)
 * - anything else -> 'staff' (Safe fallback)
 * 
 * @param {string|null} rawRole - The role string from database or auth provider
 * @returns {string} - The canonical role
 */
export function normalizeRole(rawRole) {
    if (!rawRole) return CANONICAL_ROLES.STAFF

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
            console.warn(`[RoleNormalization] Unknown role '${rawRole}' normalized to 'staff'`)
            return CANONICAL_ROLES.STAFF
    }
}
