import fs from 'fs'

async function testGemini() {
    const key = 'AIzaSyAsVYDm9hD8lcZgYyrX8VROk3VMAnQCX_A'
    console.log('Testing Gemini with Bearer Auth key prefix:', key.substring(0, 10))

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
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
