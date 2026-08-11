import React from 'react'
import '../styles/components.css' // Ensure styles are loaded if not already

export default function LoadingScreen({ message }) {
    return (
        <div className="dashboard-loading-overlay full-screen-loader">
            <div className="loading-logo-wrapper">
                <img
                    className="loading-wordmark"
                    src="/images/tvg-hub-login-brand-v2.png"
                    alt="TVG Hub"
                />
            </div>
            {message && <p className="loading-message-fade">{message}</p>}
        </div>
    )
}
