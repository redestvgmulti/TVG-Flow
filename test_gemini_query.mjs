import fs from 'fs'

async function testGemini() {
    const key = 'AIzaSyAsVYDm9hD8lcZgYyrX8VROk3VMAnQCX_A'
    console.log('Testing Gemini with Query Param key prefix:', key.substring(0, 10))

    // Test with Query Param (The strictly required way for Gemini OpenAI Shim)
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=' + key, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gemini-1.5-flash',
            messages: [{ role: 'user', content: 'Hello' }]
        })
    })

    const data = await res.json()
    console.log('Gemini Response Status:', res.status)
    console.log('Gemini Response:', JSON.stringify(data, null, 2))
}

testGemini()
