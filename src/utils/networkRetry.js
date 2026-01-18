// Network Retry Utility - Lightweight & Safe
// Exponential backoff for network failures only

const MAX_RETRIES = 3
const INITIAL_DELAY_MS = 300

/**
 * Retry fetch with exponential backoff
 * Only retries network failures (timeout, offline)
 * Does NOT retry auth errors or 4xx/5xx responses
 * 
 * ❌ NEVER use with Supabase endpoints - they handle auth headers internally
 */
export async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    // 🛡️ DEFENSIVE GUARD: Prevent usage with Supabase endpoints
    if (url.includes('/rest/v1') || url.includes('/auth/v1') || url.includes('supabase.co')) {
        throw new Error(
            'fetchWithRetry must NEVER be used with Supabase endpoints. ' +
            'It strips required auth headers. Use raw fetch() or Supabase client directly.'
        );
    }

    try {
        const response = await fetch(url, options)

        // Don't retry successful responses or client/server errors
        if (response.ok || response.status >= 400) {
            return response
        }

        throw new Error(`HTTP ${response.status}`)
    } catch (error) {
        // Don't retry if no retries left
        if (retries <= 0) {
            throw error
        }

        // Don't retry aborted requests
        if (error.name === 'AbortError' || options.signal?.aborted) {
            throw error
        }

        // Only retry network failures
        const isNetworkError =
            error.name === 'TypeError' ||
            error.message.includes('Failed to fetch') ||
            error.message.includes('Network request failed')

        if (!isNetworkError) {
            throw error
        }

        // Exponential backoff
        const delay = INITIAL_DELAY_MS * Math.pow(2, MAX_RETRIES - retries)
        await new Promise(resolve => setTimeout(resolve, delay))

        return fetchWithRetry(url, options, retries - 1)
    }
}

/**
 * Wrapper for Supabase client with retry
 * Preserves all Supabase functionality
 */
export function withRetry(supabaseClient) {
    const originalFetch = supabaseClient.rest.fetch

    supabaseClient.rest.fetch = async (url, options) => {
        // Skip retry for auth endpoints (critical)
        if (url.includes('/auth/')) {
            return originalFetch(url, options)
        }

        return fetchWithRetry(url, options)
    }

    return supabaseClient
}
