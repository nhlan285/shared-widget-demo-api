# Creation demo phase
## Goal / authority
Own temporary API for Flutter flows. User approved creation additions, private
repo/resource name shared-widget-demo-api. Keep sample auth/pair/device endpoints.

## Architecture / steps
- Snapshot source at3fccd34 into new feature/demo-creation-api, no original refs.
- Metadata table alongside postcards; saved canvases map without auth-table rewrite.
- Owner-only close with canonical lock; single active canvas/pair enforced in DO.
- Private Doodle flatten upload, atomic idempotency key/payload hash, TTL/image410.
- Filters before pagination, deterministic order/hasMore; widget-state.
- Lifecycle broadcasts; never expose private Doodle drafts in room.
- Dedicated own D1/R2/Worker; JWT secret never printed/committed.
- Local integration fixtures; remote smoke only owned synthetic identities/pair.

## Validation / acceptance
npm test; OpenAPI build; Worker dry-run; local race/ownership/idempotency/TTL/private
R2 tests; remote smoke. Email credentials not configured; no native OS widgets.

## Handoff
Source extracted/dependencies installed. First GitHub MCP create failed bad
credentials; Cloudflare rejected create because sample account config was still
present (no resource created). Config now corrected to verified own account.
Next: provision dedicated resources, implement/tests, update CURRENT_STATE.
