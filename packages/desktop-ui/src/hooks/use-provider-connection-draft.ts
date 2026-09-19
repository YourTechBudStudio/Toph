import { useEffect, useMemo, useState } from 'react';

import type { ProviderConnection, ProviderFieldSpec } from '@toph/desktop-contracts';

export type ProviderConnectionDraft = {
  /** The provider's declared credential fields, with a saved secret's placeholder applied. */
  fields: ProviderFieldSpec[];
  /** What the fields currently hold; this is what a connect submits. */
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  /** Whether the submit action should be live. */
  submittable: boolean;
};

/**
 * The connection draft for one provider: what a credential field starts as, when the draft resyncs
 * to the published connection, and when submitting it is worth offering.
 *
 * Settings and onboarding both show a connection form, so these rules live here rather than in
 * either surface. They are subtle and were corrected three times while phase 02 settled them, so a
 * second copy would be a standing invitation to drift; each surface keeps only its own layout,
 * labels and actions.
 *
 * There is no view/edit mode anywhere: a connected provider keeps editable fields, its stored
 * secret reads as saved, and submitting wakes up only once something actually changed.
 */
export function useProviderConnectionDraft(provider: ProviderConnection): ProviderConnectionDraft {
  const fields = provider.auth.kind === 'form' ? provider.auth.fields : [];
  const connected = provider.status === 'connected';
  const stored = useMemo(
    () => storedValues(fields, provider.connectionSummary),
    [fields, provider.connectionSummary],
  );
  const [values, setValues] = useState<Record<string, string>>(stored);

  // Resync when the connection behind the draft changes, so a successful connect drops the
  // plaintext secret the draft still holds; otherwise the form would offer to reconnect with
  // nothing changed. Three markers, and only these three:
  //
  //  - the provider, because one surface can point this hook at a different provider without
  //    remounting it, and another provider's half-typed credential must never be submitted under
  //    this one's id;
  //  - the stored values, by value rather than object identity, because every published state is a
  //    fresh object and resyncing on identity would wipe what the user is typing;
  //  - becoming connected, because a provider whose credential fields are all secret publishes no
  //    value at all on a successful connect, leaving the previous marker unmoved.
  //
  // Status is deliberately flattened to connected-or-not: a failed connect lands on `invalid` and
  // must keep the user's input, which is the whole point of showing them the error next to it.
  const resyncKey = `${provider.id}|${connected}|${JSON.stringify(stored)}`;
  useEffect(() => {
    // `stored` is the value `resyncKey` is derived from, so the key alone decides when to resync.
    setValues(stored);
  }, [resyncKey]);

  const dirty = fields.some((field) => values[field.key] !== stored[field.key]);
  const complete = fields.every((field) => {
    // A saved secret counts as present: leaving it untouched keeps the stored one.
    if (field.kind === 'text' && field.secret === true && connected) {
      return true;
    }
    return (values[field.key] ?? '').trim().length > 0;
  });

  return {
    fields: fields.map((field) => savedSecretHint(field, connected)),
    values,
    setValue: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    // An OAuth provider declares no fields, so there is nothing to complete: the button is the
    // whole form and stays live.
    submittable: provider.auth.kind === 'oauth' || (complete && (!connected || dirty)),
  };
}

function storedValues(fields: readonly ProviderFieldSpec[], summary: Record<string, string>) {
  const values: Record<string, string> = {};
  for (const field of fields) {
    // The registry rejects a non-text credential field, so a connection form is text only.
    if (field.kind !== 'text') {
      continue;
    }
    // A stored secret is never published back, so its box always starts empty.
    values[field.key] = field.secret === true ? '' : (summary[field.key] ?? field.default);
  }
  return values;
}

function savedSecretHint(field: ProviderFieldSpec, connected: boolean): ProviderFieldSpec {
  if (!connected || field.kind !== 'text' || field.secret !== true) {
    return field;
  }
  return { ...field, placeholder: 'Saved — type to replace' };
}
