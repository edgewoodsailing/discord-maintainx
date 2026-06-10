# Secret template — fill in the op:// references to your 1Password items.
#
#   Local dev:        op inject -i .dev.vars.tpl -o .dev.vars   (then: npm run dev)
#   Deploy secrets:   op run --env-file=.dev.vars.tpl -- ./scripts/push-secrets.sh
#   Scripts:          op run --env-file=.dev.vars.tpl -- npm run register-commands
#
# .dev.vars (the injected copy) is gitignored; this template contains only
# op:// references and is safe to commit.

# Discord application (Developer Portal > your app > General Information)
DISCORD_PUBLIC_KEY="op://Private/Discord MaintainX Bot/public key"
DISCORD_APP_ID="op://Private/Discord MaintainX Bot/app id"
# Bot tab > Token (only used locally to register commands; never deployed)
DISCORD_BOT_TOKEN="op://Private/Discord MaintainX Bot/bot token"
# Your Discord server ID (right-click server name with Developer Mode on).
# Not secret; used for instant per-guild command registration.
DISCORD_GUILD_ID=""

# MaintainX (Settings > Integrations > API Keys)
MAINTAINX_API_TOKEN="op://Private/MaintainX API/credential"
# Only needed if the token has access to multiple organizations
MAINTAINX_ORG_ID=""
