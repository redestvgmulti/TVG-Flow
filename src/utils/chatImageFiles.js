export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

const VALID_EXTENSIONS = {
    'image/png': new Set(['png']),
    'image/jpeg': new Set(['jpg', 'jpeg']),
    'image/webp': new Set(['webp']),
}

export function validateChatImageFile(file) {
    if (!file || typeof file.name !== 'string') return 'IMAGE_FILE_REQUIRED'
    if (!VALID_EXTENSIONS[file.type]) return 'IMAGE_FORMAT_UNSUPPORTED'
    if (file.size < 24) return 'IMAGE_FILE_INVALID'
    if (file.size > CHAT_IMAGE_MAX_BYTES) return 'IMAGE_FILE_TOO_LARGE'
    const extension = file.name.toLowerCase().split('.').pop()
    if (!VALID_EXTENSIONS[file.type].has(extension)) return 'IMAGE_TYPE_MISMATCH'
    return null
}

export function validateChatImageDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height)) return 'IMAGE_DIMENSIONS_INVALID'
    if (width < 64 || height < 64 || width > 8192 || height > 8192 || width * height > 25_000_000) {
        return 'IMAGE_DIMENSIONS_INVALID'
    }
    return null
}

export function parseImageChatContent(content) {
    if (typeof content !== 'string' || !content.trim().startsWith('{')) return null
    try {
        const parsed = JSON.parse(content)
        if (!['image_edit', 'image_edit_result'].includes(parsed?.type)) return null
        return { type: parsed.type, text: typeof parsed.text === 'string' ? parsed.text : '' }
    } catch {
        return null
    }
}
