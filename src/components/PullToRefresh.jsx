import { useState, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useRefresh } from '../contexts/RefreshContext'
import '../styles/pullToRefresh.css'

const PULL_THRESHOLD = 80 // px to trigger refresh
const MAX_PULL = 120 // max px to visually pull
const DAMPING = 0.4 // rubber band effect

export default function PullToRefresh({ children, className = '' }) {
    const { isRefreshing, triggerRefresh } = useRefresh()
    const containerRef = useRef(null)

    // State for visual pull amount
    const [pullY, setPullY] = useState(0)
    const [isTouching, setIsTouching] = useState(false)

    // Internal mechanics
    const startY = useRef(0)
    const isPulling = useRef(false)
    const canPull = useRef(false)

    // Helper to check if we can start a pull
    const checkCanPull = (e) => {
        // Mobile check
        const isMobile = window.matchMedia('(pointer: coarse) or (max-width: 1024px)').matches
        if (!isMobile) return false

        // Check if container is at the top
        const scrollTop = containerRef.current ? containerRef.current.scrollTop : 0
        return scrollTop <= 0
    }

    const handleTouchStart = (e) => {
        if (isRefreshing) return

        // We only care if we are at the top
        if (!checkCanPull(e)) {
            return
        }

        startY.current = e.touches[0].clientY
        canPull.current = true
        setIsTouching(true)
    }

    const handleTouchMove = (e) => {
        if (!canPull.current || isRefreshing) return

        const y = e.touches[0].clientY
        const diff = y - startY.current
        const scrollTop = containerRef.current ? containerRef.current.scrollTop : 0

        // If we are scrolling down while content is strictly at top (pulling down)
        if (diff > 0 && scrollTop <= 0) {
            // Prevent default browser scroll behavior to allow our custom pull
            // Only if we are fairly certain this is a pull gesture
            if (e.cancelable) {
                // e.preventDefault() // Optional: might feel more native but risky on some browsers
            }

            // Calculate damped drag
            const newPullY = Math.min(diff * DAMPING, MAX_PULL)

            setPullY(newPullY)
            isPulling.current = true
        } else {
            // User scrolled back up or wasn't at top anymore
            canPull.current = false
            setPullY(0)
            isPulling.current = false
        }
    }

    const handleTouchEnd = async () => {
        if (!canPull.current || !isPulling.current) {
            reset()
            return
        }

        if (pullY >= PULL_THRESHOLD) {
            // Trigger refresh
            if (navigator.vibrate) navigator.vibrate(10)

            // Log for debugging
            console.log('[PullToRefresh] Triggering refresh...')

            // Snap to threshold
            setPullY(PULL_THRESHOLD)

            await triggerRefresh()
        }

        reset()
    }

    const reset = () => {
        canPull.current = false
        isPulling.current = false
        setIsTouching(false)
        setPullY(0)
    }

    // Styles
    const spinnerStyle = {
        transform: `translateY(${Math.min(pullY, PULL_THRESHOLD)}px) rotate(${pullY * 2}deg)`,
        opacity: Math.max(0, Math.min(1, (pullY - 20) / (PULL_THRESHOLD - 20)))
    }

    const contentStyle = {
        transform: `translateY(${pullY}px)`
    }

    return (
        <div
            ref={containerRef}
            className={`ptr-container ${className}`}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <div className="ptr-spinner-container">
                <div
                    className={`ptr-spinner ${isRefreshing ? 'spinning visible' : ''}`}
                    style={isRefreshing ? {} : spinnerStyle}
                >
                    <Loader2 size={24} />
                </div>
            </div>

            <div
                className={`ptr-content ${!isTouching ? 'releasing' : ''}`}
                style={contentStyle}
            >
                {children}
            </div>
        </div>
    )
}
