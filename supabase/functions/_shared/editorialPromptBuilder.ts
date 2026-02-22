// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: Prompt Builder Core (Enterprise)
// Build final prompt using RAG context, active version, humanization, rules and override
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface EditorialInput {
    titulo: string;
    conteudo: string | null;
    categoria: string | null;
    settings: any;
    promptVersion: string | null;
    humanization: any;
    rules: any[];
    ragContext: any[];
}

export function buildEditorialPrompt(data: EditorialInput): string {
    const { titulo, conteudo, categoria, settings, promptVersion, humanization, rules, ragContext } = data;

    // 1. SYSTEM BASE
    let systemPrompt = promptVersion || "Você é um editor sênior de jornalismo digital.";
    if (settings.system_prompt_override && settings.override_prompt_text) {
        systemPrompt = settings.override_prompt_text;
    }

    // 2. RULES (CONSTRAINTS)
    const forbidden = rules.filter(r => r.rule_type === 'forbidden').map(r => r.value).join(", ");
    const mandatory = rules.filter(r => r.rule_type === 'mandatory').map(r => r.value).join(", ");
    const substitutions = rules.filter(r => r.rule_type === 'substitution').map(r => r.value).join("; ");

    let constraintsSection = "";
    if (forbidden || mandatory || substitutions) {
        constraintsSection = `\nREGRAS EDITORIAIS INEGOCIÁVEIS:\n`;
        if (forbidden) constraintsSection += `- NUNCA use as palavras/expressões: [${forbidden}]\n`;
        if (mandatory) constraintsSection += `- É OBRIGATÓRIO incluir/mencionar: [${mandatory}]\n`;
        if (substitutions) constraintsSection += `- SUBSTITUIÇÕES VIGENTES: ${substitutions}\n`;
    }

    // 3. STYLE & HUMANIZATION
    const formLevel = humanization?.formality_level ?? 50;
    const creaLevel = humanization?.creativity_level ?? 50;
    const techLevel = humanization?.technical_level ?? 30;
    const antiAi = humanization?.anti_ai_variation ?? true;

    let formText = "Neutro/Equilibrado";
    if (formLevel > 75) formText = "Extremamente Formal/Acadêmico";
    else if (formLevel < 25) formText = "Muito Informal/Descontraído";

    let creaText = "Normal";
    if (creaLevel > 75) creaText = "Metáforas criativas, storytelling muito rico";
    else if (creaLevel < 25) creaText = "Extremamente direto, formato hard-news focado nos fatos secos";

    let techText = "Básico/Público Leigo";
    if (techLevel > 75) techText = "Especializado/Linguagem técnica predominante";

    const styleSection = `\nPARÂMETROS DE ESTILO E HUMANIZAÇÃO:\n- Formalidade: ${formLevel}% (${formText})\n- Criatividade: ${creaLevel}% (${creaText})\n- Densidade Técnica: ${techLevel}% (${techText})\n${antiAi ? '- DIRETRIZ ANTI-AI: Evite clichês de IA como "Descubra agora", "Mergulhe fundo", "É importante ressaltar". Use conectivos naturais, varie o tamanho das frases e mantenha a imperfeição humana.' : ''}\n`;

    // 4. KNOWLEDGE CONTEXT (RAG)
    let ragSection = "";
    if (ragContext && ragContext.length > 0) {
        ragSection = `\nCONTEXTO EXTRA (KNOWLEDGE BASE INTERNA):\nAs informações abaixo pertencem à base de conhecimento do veículo e podem/devem ser usadas para enriquecer a notícia se tiverem aderência ao assunto central:\n\n`;
        ragContext.forEach((doc, i) => {
            ragSection += `[TRECHO ${i + 1}] (Origem: ${doc.file_name}):\n"${doc.content}"\n\n`;
        });
    }

    // 5. INPUT CONTENT
    const inputSection = `\nCONTEÚDO BRUTO (FONTE RSS):\nTítulo: ${titulo}\nCategoria: ${categoria ?? "geral"}\nConteúdo Original:\n${conteudo ?? "Apenas título disponível."}\n`;

    // 6. EXPECTED FORMAT (JSON Schema Instructions - Strict)
    const formatSection = `\nINSTRUÇÕES DE OUTPUT OBRIGATÓRIAS:\nAo final, responda estritamente em um JSON válido (sem marcadores \`\`\`json) contendo os seguintes campos:
- "headline": título impactante e direto
- "caption": legenda para a rede social adequada ao estilo configurado, emojis se combinar
- "roteiro": array de 3 elementos string (exato: [abertura, desenvolvimento, fechamento_cta])
- "visual_energy_level": exatamente "low", "medium" ou "high", dependendo do vigor da notícia
- "has_face": booleano true se o assunto remete a uma pessoa nominal que deve ganhar capa
`;

    // Assemble full prompt
    return `${systemPrompt}\n${constraintsSection}${styleSection}${ragSection}${inputSection}${formatSection}`;
}

// Helper to fetch entire editorial context for a given tenant
export async function getEditorialContext(sbAdmin: SupabaseClient, clienteId: string, inputRawText: string) {
    try {
        const [{ data: settings }, { data: humanization }, { data: prompts }, { data: rules }] = await Promise.all([
            sbAdmin.from("ap.editorial_settings").select("*").eq("cliente_id", clienteId).eq("is_active", true).maybeSingle(),
            sbAdmin.from("ap.editorial_humanization").select("*").eq("cliente_id", clienteId).maybeSingle(),
            sbAdmin.from("ap.editorial_prompt_versions").select("prompt_base").eq("cliente_id", clienteId).eq("is_active", true).maybeSingle(),
            sbAdmin.from("ap.editorial_rules").select("*").eq("cliente_id", clienteId)
        ]);

        if (!settings) {
            return null; // System not active or configured for this tenant, fallback to standard mode
        }

        // Generate embedding for RAG (if applicable) -> Need OpenAI key for embedding
        let ragContext = [];

        // This is a placeholder since the shared file cannot make openai embed calls independently 
        // without knowing the keys, which we proxy in the actual endpoint.
        // We will fetch RAG outside in the execution block if needed, or skip it for now.

        return { settings, humanization, promptVersion: prompts?.prompt_base || null, rules: rules || [], ragContext };
    } catch (err) {
        console.error("Error fetching editorial context:", err);
        return null; // fallback
    }
}
