// Skeleton Loader Components - Lightweight & Reusable
import React from 'react'
import './skeleton.css'

export function SkeletonCard() {
    return (
        <div className="skeleton-card">
            <div className="skeleton-header" />
            <div className="skeleton-text" />
            <div className="skeleton-text skeleton-text-short" />
        </div>
    )
}

export function SkeletonList({ count = 5 }) {
    return (
        <div className="skeleton-list">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="skeleton-list-item">
                    <div className="skeleton-avatar" />
                    <div className="skeleton-content">
                        <div className="skeleton-text" />
                        <div className="skeleton-text skeleton-text-short" />
                    </div>
                </div>
            ))}
        </div>
    )
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
    return (
        <div className="skeleton-table">
            <div className="skeleton-table-header">
                {Array.from({ length: cols }).map((_, i) => (
                    <div key={i} className="skeleton-text skeleton-text-short" />
                ))}
            </div>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="skeleton-table-row">
                    {Array.from({ length: cols }).map((_, j) => (
                        <div key={j} className="skeleton-text" />
                    ))}
                </div>
            ))}
        </div>
    )
}
