import React from 'react'
import '../styles/components.css' // Ensure styles are loaded if not already

export default function LoadingScreen({ message }) {
    return (
        <div className="dashboard-loading-overlay full-screen-loader">
            <div className="loading-logo-wrapper">
                <div className="brand-logo">
                    <div className="brand-dot"></div>
                    <h2>TVG Flow</h2>
                </div>
            </div>
            {message && <p className="loading-message-fade">{message}</p>}
        </div>
    )
}
