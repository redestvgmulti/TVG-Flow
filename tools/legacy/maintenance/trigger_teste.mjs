import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

const ANON_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MDE2MzUsImV4cCI6MjA4MTM3NzYzNX0.mn0Y66MZ6DHxdyMg2Oh6bSIi2CC5h8RmN5N4hlyqhog";
const NEWS_ID = "57b593c9-4486-4f31-b73e-d6814b767a8c";

async function trigger() {
    const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/ap-render-engine`;

    console.log("Triggering ap-render-engine for newsId:", NEWS_ID);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ANON_JWT}`,
                'apikey': process.env.VITE_SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ action: "render_one", newsId: NEWS_ID })
        });

        console.log("Status:", res.status);
        const data = await res.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}

trigger();
