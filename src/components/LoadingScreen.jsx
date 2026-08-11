import React from 'react'
import '../styles/components.css' // Ensure styles are loaded if not already

export default function LoadingScreen({ message }) {
    return (
        <div className="dashboard-loading-overlay full-screen-loader">
            <div className="loading-logo-wrapper">
                <div className="brand-logo">
                    <img className="brand-logo-image" src="/images/tvg-hub-brand.png" alt="TVG Hub" />
                </div>
            </div>
            {message && <p className="loading-message-fade">{message}</p>}
        </div>
    )
}
