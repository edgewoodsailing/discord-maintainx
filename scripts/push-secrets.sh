#!/usr/bin/env bash
# Push the worker's secrets to Cloudflare from 1Password:
#
#   op run --env-file=.dev.vars.tpl -- ./scripts/push-secrets.sh
#
# MAINTAINX_ORG_ID is optional (only for multi-org MaintainX tokens) and is
# skipped when unset or empty.
set -euo pipefail

for name in DISCORD_PUBLIC_KEY MAINTAINX_API_TOKEN MAINTAINX_ORG_ID \
            DISCORD_WEBHOOK_URL MAINTAINX_WEBHOOK_SECRET; do
  value="${!name:-}"
  if [ -z "$value" ]; then
    echo "skipping $name (not set)"
    continue
  fi
  printf '%s' "$value" | npx wrangler secret put "$name"
done
