# Financial compute boundary

`computeFinance({ source, config, hash, now })` is synchronous and has no IO or
platform globals. `source` is native Sheets cell data, including user-entered and
effective values. `hash` accepts a string and returns a digest. `now` is supplied
by the runtime. It returns the Plan result/ledger/input and the separate Current
adapter result, ledger and monthly reconciliation.

The runtime owns source acquisition, edit detection, optimistic concurrency,
publication guards, retries and native writes. Calling the function alone does
not update a Sheet or prove that a bank transaction happened.

Private configuration version `finance-compute-v1` provides:

- `modelPolicy`: opening cash/card/KMH/reserve balances, card settings, explicit
  salary day and minimum-payment rate, tariffs/taxes, projection horizon and
  authorized reserve transfers. It must not include generated cash/purchase rows.
- `facts` and `preflight`: confirmed account facts and native opening-settings
  checks. Changed unsupported opening-statement inputs fail closed instead of
  being ignored. Ordinary source income and expense changes are recomputed.
- `planningFxDate`, `summaryBanks`, `scheduling` (first/last purchase day and first
  salary date), comparison transfers, source provenance and conditional notes.

Configuration and real financial source data belong outside the public repository.
The underlying ledger retains known unknowns; future rates and account allocation
are not promoted to bank-confirmed facts.

The native table schema remains the existing 14 source months with the existing
projection horizon supplied by configuration. Priorities are kept in order; an
unaffordable group blocks lower priorities. A manually entered irregular purchase
date is fixed and must have one matching, recalculated source event. Current
amounts use the same engine but retain explicit Current overrides. A price override
for an item left pending stays as a visible unresolved issue, with no invented date
or payment. A dated Current override without a corresponding model event fails
closed and requires explicit payment allocation.

`node --test finance-engine/compute.test.mjs` checks source edits, stale formulas,
priority transitions, manual dates, salary reservation, immutability and execution
of the ES2020 bundle without Node or `structuredClone` globals. The financial
algorithm port was also compared with the existing private ledger oracle; real
source fixtures are not checked into Git.
