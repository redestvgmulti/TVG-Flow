import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis de ambiente do Supabase não configuradas. ' +
    'Por favor, configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.local'
  );
}

// ✅ CRITICAL FIX: Minimal config replicating CityOS (which works perfectly on iOS)
// The Supabase SDK has optimized defaults for iOS PWA persistence.
// Custom storageKey and explicit config were causing iOS to clear localStorage on app close.
// By using SDK defaults, we let it handle iOS-specific storage optimizations.
// 
// IMPACT: One-time logout for existing users (accepted in production approval).
// BENEFIT: Session will persist correctly on iOS after re-login.
// ⚠️ 2026-01-20: Configuração explícita para estabilizar conexão Realtime pós-rotação
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  realtime: {
    timeout: 20000
  }
});

// Helper para verificar se o usuário está autenticado
export const isAuthenticated = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
};

// Helper para obter o usuário atual
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

// Helper para obter o perfil completo do usuário
export const getUserProfile = async () => {
  // 🛡️ CRITICAL GUARD: Check session before querying
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profissionais')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    return null;
  }

  return data;
};
