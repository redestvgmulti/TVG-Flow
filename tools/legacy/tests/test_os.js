const url = 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/create-os-by-function'
const payload = {
    empresa_id: "00000000-0000-0000-0000-000000000001", // TVG Multi
    cliente_id: "ff48d00b-c469-4af7-b31b-ade5bd5cefec", // Prefeitura de Goiatuba
    titulo: "Teste E2E Hardening Final",
    descricao: "Teste automatizado da Edge Function",
    deadline_at: "2026-05-01T23:59:59Z",
    created_by: "9da6a905-fe94-4c88-912a-e1bcd7a6f6f7", // admin
    workflow_stages: [
        {
            profissional_id: "0274d9c5-abd4-4a15-a5d3-4e273c7402a6", // Válido
            funcao: "Legado1", 
            deadline_at: "2026-04-10T23:59:59Z"
        },
        {
            profissional_id: "c48385d9-4186-4f95-a470-0bc60b6bd6e3", // Válido
            funcao: "Legado2",
            deadline_at: "2026-04-15T23:59:59Z"
        },
        {
            profissional_id: "136da991-55be-429b-8167-a548b8aa7798", // Inválido
            funcao: "Invalido",
            deadline_at: "2026-04-20T23:59:59Z"
        }
    ]
}

async function run() {
    console.log("Enviando requisição POST...");
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        console.log("Status:", res.status);
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Erro:", e);
    }
}
run();
