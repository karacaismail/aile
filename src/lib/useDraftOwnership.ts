import { useState } from 'react';

/** How a stored field maps onto the form: its form key, and how to copy only that stored field from one form state to another. */
export type StoredField<F> = { key: (field: string) => keyof F; take: (target: F, field: string, from: F) => F };

/**
 * Ownership state of one open edit form (see `ownedChanges`): the baseline the user's edits are measured from and the
 * same-field conflicts found on Save. Resolving moves only the conflicting stored fields' baseline to the latest stored
 * value; "theirs" also puts that value in the form, "mine" keeps the draft. By default a stored field is one form field
 * (whole arrays stay whole); `stored` is for a form field that holds several stored fields, such as a two-bound slider,
 * so resolving one bound never claims or replaces its sibling.
 */
export function useDraftOwnership<F extends object>(initial: F, latest: () => F | undefined, setField: (key: keyof F, value: F[keyof F]) => void,
  current: () => F = () => initial, stored?: StoredField<F>) {
  const [baseline, setBaseline] = useState(initial);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const key = stored?.key ?? ((field: string) => field as keyof F);
  const take = stored?.take ?? ((target: F, field: string, from: F) => ({ ...target, [key(field)]: from[key(field)] }));
  const resolve = (keep: 'mine' | 'theirs') => {
    const record = latest();
    if (!record) return;
    setBaseline((base) => conflicts.reduce((acc, field) => take(acc, field, record), base));
    if (keep === 'theirs') {
      const next = conflicts.reduce((acc, field) => take(acc, field, record), current());
      for (const formKey of new Set(conflicts.map(key))) setField(formKey, next[formKey]);
    }
    setConflicts([]);
  };
  // An untouched field that the latest record moved follows it: both the shown value and its baseline move together.
  const rebase = (next: Partial<F>) => setBaseline((base) => ({ ...base, ...next }));
  return { baseline, conflicts, setConflicts: (fields: readonly string[]) => setConflicts([...fields]), resolve, rebase };
}
