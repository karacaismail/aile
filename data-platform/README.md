# Data platform v1

Google Sheets is the source. This separate Node package turns captured native Sheets
responses into private, immutable JSON generations. It does not change the current UI,
Apps Script, Google Sheets cells, Vite build, service worker or GitHub Pages workflows.
No React, Mantine, component props or presentation CSS enters the data contract.
Node >=22.12 is the supported runtime; Node 24.21.0 was observed locally. No new dependency.

## Commands

```sh
node --test data-platform/*.test.mjs
node data-platform/build-finance-adapter.mjs --check
node data-platform/capture.mjs --config /PRIVATE/capture-config.json --output /PRIVATE/captures --name run-001
node data-platform/cli.mjs convert --manifest /PRIVATE/source-manifest.json --output /PRIVATE/data --tenant STABLE_TENANT_KEY
node data-platform/cli.mjs validate --generation /PRIVATE/data/generations/CONTENT_HASH
```

The capture command reads `GOOGLE_ACCESS_TOKEN` from its environment; never put the token
in the config, command arguments or repository. Its private config is
`{"sources":[{"key":"household","spreadsheetId":"YOUR_WORKBOOK_ID"},{"key":"budget","spreadsheetId":"YOUR_OTHER_WORKBOOK_ID"}]}`.
It uses read-only Sheets/Drive GET requests, bounded parallel grids and before/after Drive
revision checks. It cannot grant OAuth access, change sharing or write Sheets. The
implemented OAuth command has synthetic HTTP tests; the existing connector supplied the
current live capture. A live OAuth-command run is separate evidence.

Use a persistent tenant key; changing it intentionally produces another tenant and IDs.
The exporter rejects output beneath any Git repository, public or dist path, including
symlink aliases in either direction. It creates private directories/files (0700/0600).
Do not serve these generations, raw capture files, manifests or real records from Pages.
An explicit authenticated distribution adapter is a separate implementation.

## Source input

`source-manifest.json` has `schemaVersion: 1` and `sources` with:

- `key`: `household` or `budget`; stable logical source identity.
- `metadata`: manifest-relative path to native `spreadsheets.get` metadata JSON.
- `chunks`: manifest-relative native grid-data response paths. A connector's
  `structuredContent` wrapper is accepted. Each response retains `spreadsheetId` and
  sheet identity. A mismatched workbook, sheet or conflicting overlap fails conversion.
- `bounds` (recommended): `{chunk,sheetId,startRow,endRow,startColumn,endColumn}` using
  zero-based, end-exclusive coordinates. Supplied bounds must cover every metadata
  grid, and every returned cell must be inside its chunk's bound. No bounds means
  coverage `unknown`, never a complete-export claim.
- `startedAt`, `completedAt`, `driveBefore`, `driveAfter`: capture evidence. Different
  before/after `modified_time` fails conversion. Equal timestamps are not a transactional
  snapshot or proof against every concurrent writer.

Optional `supplements: [{key,path,classification?,sourceUrl?}]` retain distinct sidecar
JSON. Keys are unique. Preserve classifications such as `google_sheets_comments`,
`repository_catalog_not_sheets`, and `historical_configuration_not_runtime_verified`;
historical configuration is not verified runtime state. Threaded Google comments are
separate from cell notes; capture.mjs does not fetch those comments, so a separately
captured supplement is required. External catalogs are not labeled Sheets data or merged
into household financial facts. Browser-only settings and an unsynchronized local outbox
are not in a Sheets capture and cannot be claimed as exported.
Input paths must remain within the manifest directory after resolving symlinks.

## Storage and identity

The output is `generations/<sha256>/manifest.json` with content hashes, byte sizes,
record counts and files grouped by collection, source and (for grids) sheet. Business
partitions contain at most 512 records; native-cell partitions at most 2,048. Consumers
can load one domain rather than the entire snapshot. Native input responses are archived
byte for byte and must stay outside browser delivery. Capture metadata retains native
workbook metadata; formulas, effective values/errors, formatting, notes, hyperlinks and
validation remain available through native source cells and the raw archive.

`{schemaVersion: 1, collection, records: [...]}` is the normalized partition envelope.
Records use UUIDv5 `id` and `tenant_id`, generated from a fixed namespace and stable
logical keys. App records use source key + native sheet ID + original record ID; moving
an app row does not change its identity. Native cell/row observations use coordinates
and thus intentionally change identity when moved. Cross-workbook matching is not guessed.
`source_attributes` preserves effective source scalars; `attributes` supplies normalized
source field types. Raw native cells preserve formula text and errors that have no scalar.

Dates are ISO dates, timestamps are ISO UTC, decimal amounts are strings, money carries
an ISO currency code. Blank, false, zero and formula error are distinct: an error's
normalized value is null plus a source error issue, never zero. `source_record_id` is
provenance, not a UUID foreign key. `provenance` identifies source, sheet, row, column/A1.

The converter writes a staging directory, validates the complete generation and then
renames it atomically. Failure removes only its own staging directory. Existing generation
content is verified and reused, never overwritten. No mutable `latest` pointer, scheduler,
network call, database migration or automatic deployment is installed.

## Domain semantics

- `app_kalemler`: purchase needs, lighting specifications, work orders, layout items,
  providers, inspections, automation scenes, milestones. Missing real IDs are reported;
  template FALSE checkboxes do not fabricate records. Deleted source rows remain retained.
- `app_ayarlar`: settings plus explicit room records. Unknown rooms become issues rather
  than inferred physical locations.
- `app_nakit`: user-recorded payment entries. Method, account, funding source and external
  proof remain null/not supplied. A delivered item or recorded item price is not evidence
  of payment, and no payment is fabricated from budget projections.
- Other sheets: every source row/cell remains available. Only Plan, Gerçekleşen and the
  explicitly identified legacy Giderler Planlanan/Gerçekleşen tables become budget facts.
  Derived tables never produce a second copy of budget observations. Where at least two unambiguous
  monthly headers exist, numeric cells become `budget_observations`, preserving planned /
  recorded aggregate / unclassified basis. They are observations, not accounting entries,
  payment events or additive totals. Subtotal rows must not be summed with their children.
  Currency is only assigned when native number formatting explicitly identifies TRY.
- Explicit IDs, dependency codes and room keys yield typed relations. Missing or ambiguous
  targets produce review issues and no guessed relation. Product links remain web
  references; image-looking URLs are unverified candidates, not verified/licensed photos.

Vocabulary and taxonomy terms are separate data. Categories have parent terms. Phase 1
means before move, phase 2 after move; phase 3 becomes the separate baby-preparation life
context. It is not a third temporal phase. Decision, fulfillment, inspection and payment
state axes remain independent. `state_term_ids` links each populated axis to its vocabulary
term UUID and must agree with its snapshot code; legacy status is retained separately. Six versioned
workflow templates are proposals, not invented state-transition history. Funding type,
payment method and financial event vocabularies are separate concepts. Six declarative
view definitions cover listing, table, Gantt, pivot, Kanban and timeline, with eligible
record kinds and required data. They contain no executable UI callbacks. Missing dates
remain missing; pivot summation requires a separate explicit leaf-row ownership mapping.

## Verified forecast adapter

`finance.mjs` reads only columns A:T of the budget workbook's `_Web verisi` tab (older exports used `_Finans web`). The generated offline
adapter reuses the existing wire checksum and ledger consistency validators. Forecasts,
forecast events and forecast months are separate collections with `record_basis: forecast`.
They never create payment rows, bank accounts or approved financing agreements. Counts
and the period range come from the verified source; no fixed 14-month horizon is imposed.
Forecast events support listing/table/timeline with an explicit forecast date basis;
forecast month balances support a period-keyed table, not additive pivot sums.

After changing the owning finance validators, run
`node data-platform/build-finance-adapter.mjs`, inspect the generated diff, then use the
`--check` command and tests. The generator is build-time only; normal conversion runs
without the UI framework or network bindings.

## Validation and migration boundary

`schemas/partition.schema.json` is the portable JSON Schema contract; runtime checks also
reject duplicate IDs, foreign-key gaps, wrong typed relation targets, category cycles,
invalid dates/decimal currencies/states, altered hashes/counts, source mismatch and unsafe
output locations. JSON Schema validation alone does not establish semantic financial truth.
`issues` is an explicit review queue; a structurally valid snapshot may contain formula
errors, unknown mappings or unresolved references. These are not silently repaired.

PostgreSQL mapping: one collection per table; UUID primary/foreign keys + tenant scope;
`source_attributes`, normalized extension `attributes`, native `cell` and source metadata
can initially use JSONB. Money becomes `numeric` plus `char(3)` currency; dates become
`date`; timestamp attributes become `timestamptz`. Preserve snapshot/provenance and import
issues. Taxonomy edges and workflow transitions become relational tables. Foreign keys
must be tenant-scoped; database authorization, transactions, RLS and audit events are
future implementation, not supplied by a JSON export.

Each generation includes the hashed `contracts/postgres-mapping.json` so its PostgreSQL
projection contract travels with the private data. Proposed task templates use their own
collection and dependency UUIDs; they do not create actual tasks or task completion.

Migration should load one generation into staging, check counts/hashes/constraints, then
commit the tenant snapshot atomically. Do not import source observations as ledger postings
or merge tenants by matching labels. This package does not execute SQL or mutate Sheets. The new Node test and generated-adapter
checks are manual gates in this slice. Existing GitHub Pages workflows are intentionally
unchanged, so CI enforcement of the new package is not claimed.
