# Demo-only scope
- Separate snapshot of thanhNgan13/shared_widget_be at3fccd34. No source-repo push.
- Use feature/demo-creation-api; never merge/mutate main/develop or other repos.
- User authorized private nhlan285/shared-widget-demo-api and dedicated own
  Cloudflare Worker/D1/R2 shared-widget-demo-api. Preserve existing resources.
- Keep auth/pair/device behavior; extend only creation APIs and scoped docs/tests.
- Never commit credentials, .dev.vars, .local/, build or .wrangler output.
- Resume from docs/CURRENT_STATE.md and docs/plans/active/creation-api.md.
- npm test; node scripts/build-openapi.js; wrangler deploy --dry-run before deploy.
