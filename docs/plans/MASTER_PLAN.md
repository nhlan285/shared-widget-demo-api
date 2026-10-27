# Demo backend roadmap
1. Preserve sample snapshot/auth; configure isolated resources and test-only CI.
2. Add creation metadata migration, private Doodle upload/TTL, singleton shared
   canvas lifecycle, filtered archive/latest state. Preserve legacy API compatibility.
3. Test race/idempotency/permissions/R2 lifecycle, generate Swagger.
4. Provision only dedicated demo resources, migrate/deploy, remote synthetic smoke.
5. Commit/push only new private own demo repo; Flutter stays local-only.

No source-project deployment. Detailed plan: active/creation-api.md.

Current correction: author-only erasing complete24fc33a; widget-only24h expiry
approved by user. Retain library R2 image, continue active-pair authorization and
orphan/revocation cleanup. Same dedicated resources; no schema migration.
