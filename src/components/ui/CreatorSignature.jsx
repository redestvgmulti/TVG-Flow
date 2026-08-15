const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
})

function getCreatorInitials(name) {
    const parts = String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)

    if (parts.length === 0) return '--'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()

    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function getCreatorDisplayName(name, automated = false) {
    const normalizedName = String(name || '').trim()
    if (normalizedName) return normalizedName
    return automated ? 'AutoPublisher' : 'Autoria não registrada'
}

function formatCreationDateTime(value) {
    if (!value) return 'Horário não registrado'

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Horário não registrado'

    return formatter.format(date)
}

export default function CreatorSignature({
    name,
    createdAt,
    automated = false,
    compact = false,
    className = ''
}) {
    const displayName = getCreatorDisplayName(name, automated)
    const initials = getCreatorInitials(displayName)
    const formattedDate = formatCreationDateTime(createdAt)
    const classes = [
        'creator-signature',
        compact ? 'creator-signature--compact' : '',
        className
    ].filter(Boolean).join(' ')

    return (
        <div
            className={classes}
            aria-label={`Criado por ${displayName} em ${formattedDate}`}
            title={`Criado por ${displayName} em ${formattedDate}`}
        >
            <span className="creator-signature__avatar" aria-hidden="true">
                {initials}
            </span>
            <span className="creator-signature__content">
                <span className="creator-signature__name">{displayName}</span>
                <time className="creator-signature__time" dateTime={createdAt || undefined}>
                    {formattedDate}
                </time>
            </span>
        </div>
    )
}
