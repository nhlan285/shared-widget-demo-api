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
