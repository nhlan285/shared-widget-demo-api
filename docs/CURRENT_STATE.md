# Current own demo state — 2026-10-27

## Scope / refs
feature/demo-creation-api; ownership checkpoint24fc33a, retention commit follows.
Own private origin https://github.com/nhlan285/shared-widget-demo-api.git.
Sample snapshot3fccd34; original reference clone/team resources read-only.
User authorized own demo additions/deploy/push; frontend LOCAL ONLY, no merge.
Never touch protected/unrelated branches/resources or commit .local credentials.

## Delivered
- Creation Doodle/private PNG, idempotency, pair singleton canvas, filtered archive,
  creator-only save/name/close, authenticated R2 bytes and widget-state.
- Each artist removes only own strokes; new shared raster masks/clear-all403;
  creator cannot discard another artist's contributions. Legacy API preserved.
- User approved widget-only24h expiry: expires_at is widget deadline; library
  images retained. No image410/TTL enqueue; stale cleanup rows for linked active
  Doodles cancelled. Orphan uploads/revoked pairs still cleaned. No migration.
- Old expiry_queued field retained dormant. Already reclaimed old demo R2 bytes
  cannot be recreated from metadata. No signup/email/OTP acceptance claimed.

## Validation / exact next
Ownership53/53 PASS219s; retention full53/53 PASS246.6s. Creation focused2/2
includes scheduled stale queue cancellation, expired image200/library retained,
widget null, outsider/disconnect403. OpenAPI build and dedicated dry-run PASS.
Initial ownership full fetch ECONNRESET fixed only test keep-alive reuse.
Next: commit retention, deploy dedicated Worker, run synthetic retention smoke,
push own backend branch and record result. No frontend push. No DB migration.

## Dedicated resources / safe synthetic QA
Worker https://shared-widget-demo-api.nguyennhatlan285.workers.dev
Account4bce5751f79111fc1541214fecffd713; D1 shared-widget-demo-api
59e3b722-e516-44e9-a228-5e6a450db40b; private R2 bucket same name; DO PostcardRoom.
Config wrangler.jsonc owns only these targets. Original resources untouched.
node scripts/smoke-creation.mjs --refresh-session-only renews owned fixture tokens
without deleting art. Refreshed this session. Never print/copy JWT into APK.
node scripts/smoke-doodle-retention.mjs creates/time-travels one owned synthetic
Doodle, checks retained image/date search/widget absence. No shared room touched.
Do not rerun full original smoke just to renew sessions (it can discard QA room).

## Limits
Auth/SMTP/backend background push still separate phase. Production audit0 after
lock-only body-parser fix;4 existing dev advisories. No dependency change here.
API report docs/CREATION_API_CHANGES.md; evidence docs/QA.md; phase active plan.
