import { createClient } from '@supabase/supabase-js';

let client;

// Public-key client. Browser auth sessions persist locally; server reads stay anonymous.
export function getPublicClient() {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: typeof window !== 'undefined', autoRefreshToken: typeof window !== 'undefined', detectSessionInUrl: typeof window !== 'undefined' } },
  );
  return client;
}
