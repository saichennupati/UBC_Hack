import { listEvents, marketSearch } from '@/lib/gemini';

// Public, cached proxy of Gemini events matching GEMINI_MARKET_SEARCH (default "GTA").
export const revalidate = 60;

export async function GET() {
  return Response.json({ events: await listEvents({ search: marketSearch() }) });
}
