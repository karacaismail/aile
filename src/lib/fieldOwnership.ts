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

/**
 * The write for an existing record from one form, all three states first mapped by the form's own
 * `persisted` function (trimmed text, empty → null, the record's own derivations), so the comparison
 * happens in stored meaning. Only owned fields whose result differs from the latest record are written;
 * `key` (e.g. `tip`) is always carried. Whole-array fields compare as one value (no index merge).
 */
export function ownedChanges<F>(persisted: (form: F) => Record<string, unknown>, baseline: F, local: F, latest: F, always: readonly string[] = ['tip']) {
  const latestValues = persisted(latest);
  const localValues = persisted(local);
  const { changed, conflicts } = fieldOwnership(persisted(baseline), localValues, latestValues);
  const patch: Record<string, unknown> = Object.fromEntries(always.filter((key) => key in localValues).map((key) => [key, localValues[key]]));
  for (const key of changed) if (!always.includes(key) && !same(localValues[key], latestValues[key])) patch[key] = localValues[key];
  return { patch, conflicts: conflicts.filter((key) => !always.includes(key)), latestValues, localValues, writes: Object.keys(patch).some((key) => !always.includes(key)) };
}
