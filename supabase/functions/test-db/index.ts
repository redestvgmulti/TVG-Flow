import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as postgres from "https://deno.land/x/postgres@v0.19.2/mod.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

declare const Deno: any;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const dbUrl = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrl) throw new Error("No SUPABASE_DB_URL");

        const pool = new postgres.Pool(dbUrl, 1, true);
        const client = await pool.connect();
        
        try {
            const result = await client.queryObject(`
                CREATE OR REPLACE FUNCTION ap.get_and_advance_template(
                    p_empresa_id UUID, 
                    p_tipo TEXT DEFAULT 'feed',
                    p_template_set TEXT DEFAULT 'default'
                )
                RETURNS jsonb
                LANGUAGE plpgsql
                SECURITY DEFINER
                AS $$
                DECLARE
                    v_current_index INTEGER;
                    v_total_templates INTEGER;
                    v_selected_template RECORD;
                    v_result jsonb;
                    v_effective_set TEXT := p_template_set;
                BEGIN
                    SELECT count(*) INTO v_total_templates
                    FROM ap.templates
                    WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set;

                    IF v_total_templates = 0 AND v_effective_set != 'default' THEN
                        v_effective_set := 'default';
                        SELECT count(*) INTO v_total_templates
                        FROM ap.templates
                        WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set;
                    END IF;

                    IF v_total_templates = 0 THEN
                        RAISE EXCEPTION 'Nenhum template ativo encontrado para empresa_id %, tipo % e set %', p_empresa_id, p_tipo, v_effective_set;
                    END IF;

                    INSERT INTO ap.template_queue_state (empresa_id, tipo, template_set, current_index)
                    VALUES (p_empresa_id, p_tipo, v_effective_set, 1)
                    ON CONFLICT (empresa_id, tipo, template_set) DO NOTHING;

                    SELECT current_index INTO v_current_index 
                    FROM ap.template_queue_state 
                    WHERE empresa_id = p_empresa_id AND tipo = p_tipo AND template_set = v_effective_set
                    FOR UPDATE;

                    IF v_current_index IS NULL OR v_current_index > v_total_templates THEN
                        v_current_index := 1;
                    END IF;

                    SELECT id, placid_template_uuid, ordem, nome 
                    INTO v_selected_template
                    FROM ap.templates
                    WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set
                    ORDER BY ordem ASC
                    OFFSET (v_current_index - 1) LIMIT 1;

                    IF v_selected_template IS NULL THEN
                        SELECT id, placid_template_uuid, ordem, nome 
                        INTO v_selected_template
                        FROM ap.templates
                        WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set
                        ORDER BY ordem ASC
                        LIMIT 1;
                        
                        v_current_index := 1;
                        
                        IF v_selected_template IS NULL THEN
                             RAISE EXCEPTION 'Falha ao recuperar template no índice % do set %', v_current_index, v_effective_set;
                        END IF;
                    END IF;

                    IF v_current_index >= v_total_templates THEN
                        UPDATE ap.template_queue_state 
                        SET current_index = 1, atualizado_em = NOW()
                        WHERE empresa_id = p_empresa_id AND tipo = p_tipo AND template_set = v_effective_set;
                    ELSE
                        UPDATE ap.template_queue_state 
                        SET current_index = v_current_index + 1, atualizado_em = NOW()
                        WHERE empresa_id = p_empresa_id AND tipo = p_tipo AND template_set = v_effective_set;
                    END IF;

                    UPDATE ap.templates
                    SET uso_total = uso_total + 1, atualizado_em = NOW()
                    WHERE id = v_selected_template.id;

                    v_result := jsonb_build_object(
                        'id', v_selected_template.id,
                        'placid_template_uuid', v_selected_template.placid_template_uuid,
                        'ordem', v_selected_template.ordem,
                        'nome', v_selected_template.nome,
                        'template_set', v_effective_set
                    );

                    RETURN v_result;
                END;
                $$;
                
                GRANT EXECUTE ON FUNCTION ap.get_and_advance_template(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
                NOTIFY pgrst, 'reload schema';
            `);
            return new Response(JSON.stringify({ success: true, message: "RPC fixed and schema reloaded." }), { status: 200, headers: corsHeaders });
        } finally {
            client.release();
            await pool.end();
        }

    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
});
