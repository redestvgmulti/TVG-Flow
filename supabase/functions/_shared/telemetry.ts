import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface TelemetryLog {
    worker_name: string;
    worker_id: string;
    news_id?: string;
    cliente_id?: string;
    action?: string;
    metadata?: any;
}

export class Telemetry {
    private supabase: SupabaseClient;
    private logId: string | null = null;
    private startTime: number;

    constructor(supabase: SupabaseClient) {
        this.supabase = supabase;
        this.startTime = performance.now();
    }

    async logStart(params: TelemetryLog) {
        const { data, error } = await this.supabase
            .schema("ap")
            .from("worker_telemetry")
            .insert({
                ...params,
                status: "start",
                created_at: new Date().toISOString()
            })
            .select("id")
            .single();

        if (!error && data) {
            this.logId = data.id;
        }
        return this.logId;
    }

    async logSuccess(costUsd: number = 0, metadata: any = {}) {
        if (!this.logId) return;
        const duration = Math.round(performance.now() - this.startTime);

        await this.supabase
            .schema("ap")
            .from("worker_telemetry")
            .update({
                status: "success",
                duration_ms: duration,
                cost_usd: costUsd,
                metadata: metadata
            })
            .eq("id", this.logId);
    }

    async logError(errorMsg: string, costUsd: number = 0, metadata: any = {}) {
        if (!this.logId) return;
        const duration = Math.round(performance.now() - this.startTime);

        await this.supabase
            .schema("ap")
            .from("worker_telemetry")
            .update({
                status: "error",
                duration_ms: duration,
                cost_usd: costUsd,
                error_message: errorMsg,
                metadata: metadata
            })
            .eq("id", this.logId);
    }
}
