import fs from 'fs'

async function testGemini() {
    const key = 'AIzaSyAsVYDm9hD8lcZgYyrX8VROk3VMAnQCX_A'
    console.log('Testing Gemini with Bearer Auth and -latest model...')

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model: 'gemini-1.5-flash-latest',
            messages: [{ role: 'user', content: 'Ping' }]
        })
    })

    const data = await res.json()
    console.log('Status:', res.status)
    console.log('Response:', JSON.stringify(data, null, 2))
}

testGemini()
