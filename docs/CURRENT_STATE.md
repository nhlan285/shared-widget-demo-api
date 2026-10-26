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
No existing resource overwritten. Worker not deployed yet; no remote acceptance.
Next: checkpoint, migrate dedicated D1, deploy dedicated Worker/secrets, remote
owned synthetic smoke, then push new repo branch only. Never push Flutter.
