// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TVG Hub — Secure Logging Utility
// PRODUCTION-SAFE: Zero sensitive data leakage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const IS_PRODUCTION = Deno.env.get("ENVIRONMENT") === "production";

/**
 * Secure logger - NEVER logs sensitive data
 * 
 * RULES:
 * - NO IDs (UUIDs, database IDs)
 * - NO payloads (notification content, user data)
 * - NO error details (SQLERRM, stack traces with data)
 * - ONLY generic event names and metrics
 */
export const logger = {
    /**
     * Info event (disabled in production)
     * @param event Generic event name (e.g., "processor_start")
     */
    info: (event: string) => {
        if (!IS_PRODUCTION) {
            console.log(`[INFO:${event}]`);
        }
    },

    /**
     * Error event (generic type only, no details)
     * @param event Error category (e.g., "rpc_failed", "timeout")
     */
    error: (event: string) => {
        console.error(`[ERROR:${event}]`);
    },

    /**
     * Performance metric (safe aggregates only)
     * @param data Metrics without business data
     */
    metric: (data: { event: string; duration_ms?: number }) => {
        if (!IS_PRODUCTION) {
            console.log(JSON.stringify(data));
        }
    }
};

// USAGE EXAMPLES:
// ✅ SAFE:
//   logger.info("queue_processor_start");
//   logger.error("rpc_failed");
//   logger.metric({ event: "processed", duration_ms: 123 });
//
// ❌ NEVER:
//   logger.info("Processing ID: " + id);
//   logger.error("Error: " + error.message);
//   console.log({ payload: notification });
