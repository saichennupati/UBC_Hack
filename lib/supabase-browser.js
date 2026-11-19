import { createClient } from '@supabase/supabase-js';

let client;

// Read-only client using the publishable key; safe in the browser and in server components.
export function getPublicClient() {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return client;
}
