import { GEMINI_PREDICTIONS_URL, listEvents, marketSearch } from '@/lib/gemini';

// Server component: shows real Gemini markets related to the game, if Gemini lists any.
export async function GeminiMarkets() {
  const events = await listEvents({ search: marketSearch() });
  if (events.length === 0) return null;

  return (
    <section className="card">
      <h2>Real-world markets on Gemini</h2>
      <p className="muted">
        Read-only prices from Gemini Predictions, a US-only regulated exchange. ChaosSlip doesn&apos;t trade on Gemini.
      </p>
      <ul className="gemini-events">
        {events.map((event) => (
          <li key={event.ticker}>
            <strong>{event.title}</strong>
            <ul className="gemini-contracts">
              {event.contracts.slice(0, 4).map((contract) => (
                <li key={contract.label}>
                  <span>{contract.label}</span>
                  <span className="pool">{contract.yesPercent == null ? '—' : `${contract.yesPercent}%`}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <a className="button button-quiet" href={GEMINI_PREDICTIONS_URL} target="_blank" rel="noreferrer">
        Open Gemini Predictions
      </a>
    </section>
  );
}
