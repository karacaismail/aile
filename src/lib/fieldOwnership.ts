/**
 * Field ownership for an edit form that stays open while background reads update the record.
 * All three inputs are the same normalized form shape:
 *   initial — the form as it opened (record + form defaults),
 *   local   — what the user has now,
 *   latest  — the form the latest stored record would produce.
 * A field is the user's only if they changed it from `initial`; untouched fields are never written,
 * so a newer server value (or an absent value shown as a default) is not reverted.
 * A user-changed field whose server value also moved to something different is a conflict:
 * it must be resolved visibly, never written over the newer version.
 */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function fieldOwnership<T extends Record<string, unknown>>(initial: T, local: T, latest: T) {
  const changed: (keyof T)[] = [];
  const conflicts: (keyof T)[] = [];
  for (const key of Object.keys(local) as (keyof T)[]) {
    if (same(local[key], initial[key])) continue;
    changed.push(key);
    if (!same(latest[key], initial[key]) && !same(latest[key], local[key])) conflicts.push(key);
  }
  return { changed, conflicts };
}
