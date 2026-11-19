import 'server-only';
import { createClient } from '@supabase/supabase-js';

let client;

// Service-role client: bypasses RLS. Only ever import from API routes.
export function getServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false },
  });
  return client;
}
