import { supabase } from '../services/supabase';

// Helper to run all system checks
export const runSystemChecks = async () => {
    console.group('🛡️ Iniciando Verificação de Integridade do Sistema');

    try {
        console.time('System Check Duration');

        // 1. Check System Integrity (Edge Function)
        console.log('📡 Contactando Edge Function: system-check...');
        const { data, error } = await supabase.functions.invoke('system-check');

        if (error) {
            console.error('❌ Falha na verificação do sistema:', error);
            throw error;
        }

        console.log('✅ Resultado da Verificação:', data);

        // 2. Client-Side Checks (Manifest, SW, etc)
        const clientChecks = {
            serviceWorker: 'serviceWorker' in navigator,
            onLine: navigator.onLine,
            userAgent: navigator.userAgent
        };
        console.log('📱 Status do Cliente:', clientChecks);

        console.timeEnd('System Check Duration');
        console.groupEnd();

        return {
            success: true,
            server: data,
            client: clientChecks
        };

    } catch (err) {
        console.timeEnd('System Check Duration');
        console.groupEnd();
        return {
            success: false,
            error: err
        };
    }
};

export const checkDataIntegrity = async () => {
    // Placeholder for data specific checks if needed separately
    console.log('🔍 Checking Data Integrity...');
    // Real implementation would go here or be part of system-check
    return true;
};
