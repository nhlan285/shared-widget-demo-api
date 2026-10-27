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

## Retention correction2026-10-27
User approved widget-only24h expiry; library image retained. Ownership baseline
24fc33a:53/53 PASS. Remove TTL image410/purge; cancel stale queue rows for linked
Doodles in active pairs, keep orphan/disconnect cleanup and auth recheck after R2.
No migration; keep old expiry_queued field dormant. Image already purged by old
cron cannot be restored. Focused creation2/2 PASS including scheduled cleanup,
past-deadline image200/library metadata/widget null/outsider+disconnect403.
Full rerun pending; then dry-run/deploy own dedicated Worker and backend push.
Frontend local only. No unrelated resource, source repo or auth changes.

## Historical handoff
Source extracted/dependencies installed. First GitHub MCP create failed bad
credentials; Cloudflare rejected create because sample account config was still
present (no resource created). Config now corrected to verified own account.
Milestone: dedicated D1/R2 created; creation implementation and51/51 tests PASS.
OpenAPI/dry-run PASS. Source conflicts and private media exposure repaired.
Next: own-demo migration/deploy, synthetic remote smoke, own repo push.
