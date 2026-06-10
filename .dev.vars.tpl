# Secret template — fill in the op references to your 1Password items.
#
#   Local dev:        op --account edgewoodsailing.1password.com inject -i .dev.vars.tpl -o .dev.vars   (then: npm run dev)
#   Deploy secrets:   op --account edgewoodsailing.1password.com run --env-file=.dev.vars.tpl -- ./scripts/push-secrets.sh
#   Scripts:          op --account edgewoodsailing.1password.com run --env-file=.dev.vars.tpl -- npm run register-commands
#
# .dev.vars (the injected copy) is gitignored; this template contains only
# op references and is safe to commit.

# Discord application (Developer Portal > your app > General Information)
DISCORD_PUBLIC_KEY="op://Automation/discord-maintainx-bot/public-key"
DISCORD_APP_ID="op://Automation/discord-maintainx-bot/application-id"
# Bot tab > Token (only used locally to register commands; never deployed)
DISCORD_BOT_TOKEN="op://Automation/discord-maintainx-bot/bot-token"
# Your Discord server ID (right-click server name with Developer Mode on).
# Not secret; used for instant per-guild command registration.
DISCORD_GUILD_ID="1082678070630174790"

# MaintainX (Settings > Integrations > API Keys)
MAINTAINX_API_TOKEN="op://Automation/maintainx-discord/credential"
# Only needed if the token has access to multiple organizations
MAINTAINX_ORG_ID=""
