import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    const apiKey = process.env.VITE_OPENAI_API_KEY; // tvgflow uses VITE_OPENAI_API_KEY for anthropic key

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 10,
            messages: [{ role: "user", content: "hello" }]
        })
    });

    console.log("Status:", response.status);
    const text = await response.text();
    console.log("Body:", text);
}
run();
