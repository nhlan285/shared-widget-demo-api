# Current own demo state — 2026-10-27

## Scope / refs
feature/demo-creation-api; ownership24fc33a; retention285bc04; final QA checkpoint follows.
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
Dedicated Worker deployed version5b3f3445-bd59-4437-ad29-1c6381bf171e.
Remote retention smoke PASS: private image200 beyond deadline, date-filtered
archive retains item, widget excludes it (3728a9ff-f58a-48a6-b447-e79330ac742d).
Android API demo installed, SHA25639777b3a0f3b4b400450e1d261ac864843b09413a2d0b718e891dcaaf031e489.
Next: commit QA checkpoint/push own branch then verify remote; frontend retains
local-only commits. Implementation complete; host auth integration remains next.
No DB migration; no original/team/protected branch touched.

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
