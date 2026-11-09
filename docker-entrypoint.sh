#!/bin/sh
set -e

# Self-heal: a since-reverted deploy briefly introduced a migration named "0_init"
# that collided with this project's real pre-existing migration history, leaving a
# failed entry in _prisma_migrations that blocks every subsequent `migrate deploy`
# (error P3009). This detects that specific, known failure and clears it before
# proceeding. It is a no-op on every boot once a database has moved past it (fresh
# installs and already-healed databases never match, and just fall through below).
STATUS_OUTPUT=$(npx prisma migrate status 2>&1 || true)
if echo "$STATUS_OUTPUT" | grep -q "0_init"; then
  echo "[entrypoint] Detected legacy failed '0_init' migration — resolving..."
  npx prisma migrate resolve --rolled-back 0_init
fi

# Self-heal #2: before the `db push` -> `migrate deploy` switch above, this
# database's schema was kept in sync with `prisma db push`, which never wrote
# to `_prisma_migrations`. So its real schema already matches every migration
# through 20260802214339_proposal_template_design, but Prisma doesn't know
# that and tries to re-run them for real, failing on columns/tables that
# already exist (error P3009 on 20260730150000_add_funnel_drive_fields and,
# once that's unblocked, the same thing on the next one in line). Baseline
# each pre-existing migration by name instead of re-executing it. Only
# 20260821120000_split_project_into_project_and_funnel (added after this list
# was known-applied) is left for `migrate deploy` to actually run. No-op on a
# database that's already caught up, and on a fresh install none of these
# names ever appear in `migrate status` output, so the loop never fires and
# `migrate deploy` just runs everything normally below.
for name in \
  20260704083958_init \
  20260704131224_add_call_fields \
  20260704131524_remove_call_platform \
  20260704132520_add_updated_at_default \
  20260704132613_fix_remaining_updated_at_defaults \
  20260704140603_add_favorite_field \
  20260708200000_add_missing_columns \
  20260710103000_add_task_form_templates_and_responses \
  20260729120000_add_review_status \
  20260730150000_add_funnel_drive_fields \
  20260730220000_add_credential_manager \
  20260802214339_proposal_template_design \
; do
  STATUS_OUTPUT=$(npx prisma migrate status 2>&1 || true)
  if echo "$STATUS_OUTPUT" | grep -q "$name"; then
    echo "[entrypoint] Baselining pre-existing migration $name (already applied via legacy db push)..."
    npx prisma migrate resolve --applied "$name"
  fi
done

npx prisma migrate deploy
exec node dist/server.cjs
