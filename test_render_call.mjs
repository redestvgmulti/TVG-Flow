import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(`${supabaseUrl}/functions/v1/ap-render-engine`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ action: "render_one", newsId: "dummy" })
});

console.log(res.status);
console.log(await res.text());
