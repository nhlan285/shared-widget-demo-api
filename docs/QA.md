# Demo API validation
- Source snapshot3fccd34; own demo branch feature/demo-creation-api.
- Full node suite51/51 PASS (168s), including original auth/device/pair/invitation/
  scan/user, private media, websocket and new creation cases.
- OpenAPI build and Worker dry-run PASS. All registered routes documented; no
  disabled test/assertion. Old route-count assertion replaced with actual spec
  route parity (separate Worker websocket explicitly excluded from Express count).
- First new private test failed because helper omitted custom Idempotency-Key;
  fixed helper to forward supplied headers. Subsequent creation/postcard6/6 PASS.
- First remote smoke exited after SQL because Wrangler progress text precedes
  JSON. Recovered same owned fixture identities, persisted fixture BEFORE any
  mutation; script now uses CLI exit status and verifies through real APIs.
- Remote PASS (2026-10-26T16:39:57Z): unauthorized401; capabilities; concurrent
  create201/409 samecanvas; two WS clients receive canonical stroke revisions1/2;
  partner lock403; owner close saved; simultaneous Doodle retry one ID; private
  R2 response bytes match sent PNG; widget-state gives latest of both types.
- Remote fixtures not personal data. No signup/email/OTP acceptance, production
  traffic/load test, Android background widget or two physical devices claimed.
- Existing Worker/database/buckets/source repository untouched.

## Own-stroke erasing2026-10-27
Focused8/8 PASS. Full rerun53/53 PASS219s; OpenAPI/dry-run PASS.
Both WS roles denied cross-remove, raster eraser and shared clear-all; creator
cannot discard partner contributions. Own remove succeeds without foreign change.
Initial full52/53 had direct-fetch ECONNRESET after sync fixture CLI; aligned
Connection:close with existing helper. No prod retry/security rule weakened.
Frontended84888 local checkpoint; no Flutter push. Dedicated deploy after retention
slice (user just selected widget-only24h expiry, library image retained).

## Widget-only expiry2026-10-27
User chose retained library image. Full53/53 PASS246.6s; OpenAPI/dry-run PASS.
Focused creation2/2 PASS24s covers deadline image200, archive and widget absence,
scheduled stale TTL queue cancellation, outsider/disconnect403. Original widget
filter, active-pair recheck and cleanup revocation retained. No schema migration.
Dedicated deploy5b3f3445-bd59-4437-ad29-1c6381bf171e PASS.
Remote synthetic retention smoke PASS: item3728a9ff-f58a-48a6-b447-e79330ac742d,
image bytes200/private, date-filtered archive retains ID; widget excludes it.
No production user data/shared room modified. Android demo installed checksum
39777b3a0f3b4b400450e1d261ac864843b09413a2d0b718e891dcaaf031e489.
Flutter229/229 PASS, analyze no issues115.8s, APK build51.8s. New physical two-user
eraser gesture QA NOT RUN; local WS actor-denial and pixel ownership tests PASS.
