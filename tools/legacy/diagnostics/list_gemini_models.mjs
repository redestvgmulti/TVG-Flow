import fs from 'fs'

async function listGeminiModels() {
    const key = 'AIzaSyAsVYDm9hD8lcZgYyrX8VROk3VMAnQCX_A'
    console.log('--- Listing Gemini Available Models ---')

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
    const data = await res.json()

    if (data.models) {
        console.log('Available Models Targets:')
        data.models.forEach(m => {
            console.log(`- ${m.name} (Supports: ${m.supportedGenerationMethods.join(', ')})`)
        })
    } else {
        console.log('Error listing models:', JSON.stringify(data, null, 2))
    }
}

listGeminiModels()
