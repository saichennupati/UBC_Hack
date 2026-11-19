// Read-only client for Gemini's public prediction-market data. No API key is used and
// no orders are placed: Gemini only lists its own CFTC-regulated events (US users only).
export const GEMINI_EVENTS_URL = 'https://api.gemini.com/v1/prediction-markets/events';
export const GEMINI_PREDICTIONS_URL = 'https://www.gemini.com/predictions';

function toPercent(price) {
  if (price == null || price === '') return null;
  const value = Number(price);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

// Keeps only the fields the UI shows.
export function trimEvent(event) {
  return {
    ticker: event.ticker,
    title: event.title,
    category: event.category,
    expiryDate: event.expiryDate ?? null,
    contracts: (event.contracts ?? []).map((contract) => ({
      label: contract.label,
      yesPercent: toPercent(contract.prices?.buy?.yes),
      lastTradePercent: toPercent(contract.prices?.lastTradePrice),
      open: contract.marketState !== 'closed',
    })),
  };
}

// Returns trimmed active events matching `search`. Any failure yields an empty list,
// since this panel is optional context and must never break the page.
export async function listEvents({ search, limit = 5, fetchImpl = fetch } = {}) {
  const url = new URL(GEMINI_EVENTS_URL);
  url.searchParams.set('status', 'active');
  url.searchParams.set('limit', String(limit));
  if (search) url.searchParams.set('search', search);

  try {
    const response = await fetchImpl(url, { next: { revalidate: 60 } });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data.map(trimEvent) : [];
  } catch {
    return [];
  }
}

export function marketSearch() {
  return process.env.GEMINI_MARKET_SEARCH || 'GTA';
}
