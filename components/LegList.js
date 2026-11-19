const ICONS = { pending: '○', active: '▶', done: '✓', failed: '✗' };

export function LegList({ legs }) {
  return (
    <ol className="legs">
      {legs.map((leg) => (
        <li key={leg.id} className={`leg leg-${leg.status}`}>
          <span className="leg-icon" aria-hidden>
            {ICONS[leg.status]}
          </span>
          <span className="leg-label">{leg.label}</span>
          <span className="leg-status">{leg.status}</span>
        </li>
      ))}
    </ol>
  );
}
