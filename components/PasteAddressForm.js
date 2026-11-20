'use client';

import { useState } from 'react';

// Links a wallet by typing or pasting its address; `onLink` resolves on success or throws.
export function PasteAddressForm({ label, placeholder, disabled, onLink }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onLink(address.trim());
      setAddress('');
    } catch {
      // The parent shows the error; keep the input so the user can fix it.
    } finally { setBusy(false); }
  }

  return <form className="paste-address" onSubmit={submit}>
    <label className="field">
      <span className="label">{label}</span>
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        required
      />
    </label>
    <button className="button" disabled={disabled || busy || !address.trim()}>{busy ? 'Linking…' : 'Link address'}</button>
  </form>;
}
