# Current demo state
Branch feature/demo-creation-api, baseline commit e8a23f6.
Source snapshot3fccd34; origin=https://github.com/nhlan285/shared-widget-demo-api.git
(private, created with existing Git credential; GitHub MCP create failed auth).
Original clone remains read-only. No push yet.
Wrangler account verified; config excludes all source resource IDs.
User authorizes own demo additions/push/deploy; frontend local only/no merge.
Dependencies installed; sample audit reports5 vulnerabilities (not yet triaged).
Creation implementation complete locally: additive migration0007, private Doodles,
24h image410 and cleanup queue, pair singleton canvas and owner close/title,
filtered/paged metadata, capabilities/widget-state, lifecycle broadcasts.
Sample had conflict markers in router/test helpers/docs and public postcard R2
exposure; corrected only on demo. Existing auth/device/pair routes retained.
51/51 backend tests PASS (168s), targeted creation+postcard6/6 PASS,
OpenAPI generation/Worker dry-run PASS. Production npm audit0 after lock-only
body-parser patch;4 dev-only advisories remain. No auth contract rewrite.
Own D1 shared-widget-demo-api id59e3b722-e516-44e9-a228-5e6a450db40b and private
R2 bucket shared-widget-demo-api created; account4bce5751f79111fc1541214fecffd713.
No existing resource overwritten. Dedicated D1 migrated0001..0007.
Worker deployed: https://shared-widget-demo-api.nguyennhatlan285.workers.dev
Initial version028320ad-151e-400a-9489-b8175b23b570; two own generated secrets
uploaded without printing/committing values. Secrets remain ignored in.local/.
Remote synthetic smoke PASS: two authenticated WebSockets, race201/409 joins
winner, owner-only lock/close, Doodle idempotent concurrent send, private R2 bytes,
latest widget metadata. NOT signup/email/OTP acceptance or two physical devices.
Fixtures are own example.invalid users in dedicated demo D1 only. Script
scripts/smoke-creation.mjs refuses other account/database/Worker targets.
Local fixture JSON contains JWTs: NEVER commit/print/copy into APK.
Own branch pushed/verified5daee6447304c612867938661434268b7255e7d4.
Safe fixture renewal: node scripts/smoke-creation.mjs --refresh-session-only
(updates only the owned synthetic session; keeps every open/saved artwork).
Never rerun the full smoke merely to renew a phone fixture: that suite can discard
its own active QA canvas. Production auth still requires host/SMTP setup.
Frontend remains local-only on feature/ui-doodle-editor.
