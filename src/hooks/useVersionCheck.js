import { useState, useEffect, useRef } from 'react';

export function useVersionCheck() {
    const [hasUpdate, setHasUpdate] = useState(false);
    const hasCheckedInitial = useRef(false);

    useEffect(() => {
        const checkVersion = async () => {
            try {
                // Add a timestamp query string to bypass cache
                const timestamp = new Date().getTime();
                const response = await fetch(`/version.json?t=${timestamp}`, {
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache' }
                });
                
                if (!response.ok) return;
                
                const data = await response.json();
                const currentVersion = localStorage.getItem('tvgflow:app_version');
                
                if (!currentVersion) {
                    // First time load, just set the version
                    localStorage.setItem('tvgflow:app_version', data.version);
                } else if (currentVersion !== data.version) {
                    // Version mismatch, update is available
                    setHasUpdate(true);
                }
            } catch (err) {
                console.error('[PWA] Error checking version API:', err);
            }
        };

        // Check immediately on mount
        if (!hasCheckedInitial.current) {
            checkVersion();
            hasCheckedInitial.current = true;
        }

        // Poll every 5 minutes (300000 ms)
        const intervalId = setInterval(checkVersion, 5 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, []);

    const performUpdate = async () => {
        try {
            // Fetch the latest version before clearing to save it securely
            const timestamp = new Date().getTime();
            const response = await fetch(`/version.json?t=${timestamp}`);
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('tvgflow:app_version', data.version);
            }

            // Unregister all Service Workers forcefully
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    await registration.unregister();
                }
            }

            // Clear all caches
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(
                    cacheNames.map(cacheName => caches.delete(cacheName))
                );
            }

            // Hard reload
            window.location.reload(true);
        } catch (error) {
            console.error('[PWA] Update failed, using fallback reload:', error);
            window.location.reload(true);
        }
    };

    return { hasUpdate, performUpdate };
}
