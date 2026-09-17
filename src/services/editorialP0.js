export function canEditCandidate(item) {
    if (item.status === 'changes_requested') return Boolean(item.correction_draft)
    return !item.render_url && !item.current_generation_id &&
        ['raw', 'ready_for_scoring', 'scored', 'selected'].includes(item.status)
}

export function canApproveGeneration(item) {
    return item.status === 'pending_review' && Boolean(item.current_generation_id && item.render_url)
}
