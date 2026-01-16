
import { useEffect, useRef } from 'react'
import { animate, useInView } from 'framer-motion'

export function AnimatedCounter({ value, duration = 0.5 }) {
    const nodeRef = useRef(null)
    const inView = useInView(nodeRef, { once: true }) // Only animate once when first visible

    // Track if we have already animated (to prevent re-running on data updates)
    const hasAnimated = useRef(false)

    useEffect(() => {
        const node = nodeRef.current
        if (!node || !inView) return

        // 1. If value is 0, just render 0 immediately (Design Rule)
        if (value === 0) {
            node.textContent = '0'
            hasAnimated.current = true
            return
        }

        // 2. If we already animated, update instantly (Design Rule: No re-animation)
        if (hasAnimated.current) {
            node.textContent = Math.round(value).toLocaleString('pt-BR')
            return
        }

        // 3. First time animation
        const controls = animate(0, value, {
            duration,
            ease: "easeOut",
            onUpdate(v) {
                node.textContent = Math.round(v).toLocaleString('pt-BR')
            },
            onComplete() {
                hasAnimated.current = true
            }
        })

        return () => controls.stop()
    }, [value, duration, inView])

    return <span ref={nodeRef} />
}
