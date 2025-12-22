/**
 * Date and Time formatting utilities
 * Handles datetime formatting for the CityOS system
 */

/**
 * Format a datetime string to Brazilian Portuguese format with time
 * @param {string} dateTimeString - ISO datetime string
 * @returns {string} Formatted datetime (e.g., "22 Dez 2025, 14:30")
 */
export function formatDateTime(dateTimeString) {
    if (!dateTimeString) return '-'

    const date = new Date(dateTimeString)

    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date)
}

/**
 * Format a datetime string for datetime-local input
 * @param {string} dateTimeString - ISO datetime string
 * @returns {string} Formatted for input (e.g., "2025-12-22T14:30")
 */
export function formatDateTimeInput(dateTimeString) {
    if (!dateTimeString) return ''

    const date = new Date(dateTimeString)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')

    return `${year}-${month}-${day}T${hours}:${minutes}`
}

/**
 * Format a date string to Brazilian Portuguese format (date only)
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date (e.g., "22/12/2025")
 */
export function formatDate(dateString) {
    if (!dateString) return '-'

    const date = new Date(dateString)

    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date)
}

/**
 * Check if a deadline has passed
 * @param {string} deadlineString - ISO datetime string
 * @returns {boolean} True if deadline has passed
 */
export function isOverdue(deadlineString) {
    if (!deadlineString) return false
    return new Date(deadlineString) < new Date()
}

/**
 * Get relative time string (e.g., "2 hours ago", "in 3 days")
 * @param {string} dateTimeString - ISO datetime string
 * @returns {string} Relative time string
 */
export function getRelativeTime(dateTimeString) {
    if (!dateTimeString) return '-'

    const date = new Date(dateTimeString)
    const now = new Date()
    const diffMs = date - now
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (Math.abs(diffMins) < 60) {
        return diffMins > 0 ? `em ${diffMins} min` : `${Math.abs(diffMins)} min atrás`
    } else if (Math.abs(diffHours) < 24) {
        return diffHours > 0 ? `em ${diffHours}h` : `${Math.abs(diffHours)}h atrás`
    } else {
        return diffDays > 0 ? `em ${diffDays} dias` : `${Math.abs(diffDays)} dias atrás`
    }
}
