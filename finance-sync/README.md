# Finance generation adapter

This Node-free package converts a `finance-engine` result into the existing native
Google Sheets contract. It does not execute writes or call the network. Personal
policy, account balances, workbook IDs and captured source data stay outside Git.

- `buildCandidate({source, config, prior, computed, hash, now})`: a complete set of
  native requests plus the expected finance, consumer and typed-wire outputs.
- `bootstrapOwnership(candidate, source, {hash})`: a one-time conversion from an
  audited existing candidate. Exact native entered-value ownership must match.
- `compactOwnership(candidate, {hash})`: a small durable ownership record with
  range digests, retained static formulas and the complete stable-key date catalogue.
- `assertRefreshOwnership(source, prior, {hash})`: rejects manual changes to owned
  outputs, including blank spill areas. Run this before an unchanged-input shortcut.
- `inputFingerprint({source, config, prior, hash})`: excludes generated outputs and
  effective-value caches. It includes user-entered inputs, formulas and configuration.
- `validateCandidateSource(candidate, source, {phase})`: additionally checks native
  effective dependency values. Required before and after a commit; a fingerprint
  alone cannot detect asynchronous formula changes.
- `verifyReadback(candidate, source, {hash})`: checks native guards, expected amounts,
  dates, consumer parity, Timeline parity, formula errors and the exact wire digest.

`hash` is an injected synchronous UTF-8 SHA-256 function returning lowercase hex.
`source` is native CellData with sheet identity, grid dimensions, entered and effective
values. The runtime owns locks, target identity, trigger lifecycle, retries, private
configuration storage, coherent source capture, the publication gate and atomic commit.
It must capture existing output rectangles **and their proposed expansion** before writing.

Refresh never rewrites the finance input cells. Clear and update requests are split
around them, so a concurrent edit remains visible and invalidates the native guard.
Dimension growth uses append-only requests, never a smaller row/column count.

A full purchase catalogue covers scheduled, pending, fixed and removed-source keys.
Scheduled → pending clears both owned dates. Pending → scheduled uses the preserved
owner formulas. A direct user-entered purchase date remains an input. Unknown or
manually changed output ownership is rejected rather than silently overwritten.

Checks: `node --test finance-sync/*.test.mjs`. These include a neutral ES2020 bundle
loaded without Node globals; runtime/native/trigger proof belongs to the caller.
