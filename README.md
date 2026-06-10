# discord-maintainx

A bridge that lets instructors and tutors file MaintainX **work requests**
from Discord. Typing `/request` opens a modal form (title, description, boat,
optional photos); on submit the bridge creates the work request in MaintainX
and attaches the photos.

Runs as a single Cloudflare Worker acting as the Discord **HTTP interactions
endpoint** — no gateway connection, no servers, nothing on the K8s cluster.
See `PROPOSAL.md` for the design rationale.

## How it works

```
/request → Worker checks channel/role → opens modal
modal submit → Worker defers (ephemeral) → POST /workrequests
            → downloads photos from Discord CDN
            → PUT /workrequests/{id}/attachments/{file}
            → edits the deferred reply with ✅/❌
```

- The boat list is a **whitelist baked into `src/boats.json`** (name +
  MaintainX asset ID). Editing it and running `npm run deploy` is the update
  path — no cache or KV needed at this scale.
- Access control: `ALLOWED_CHANNEL_IDS` and `ALLOWED_ROLE_IDS` vars in
  `wrangler.jsonc` (comma-separated Discord IDs; empty = unrestricted).
- The requester's Discord name is passed to MaintainX in
  `creatorContactInfo`, so requesters don't need MaintainX accounts.

## One-time setup

Prerequisites: Node 20+, the 1Password `op` CLI, and `npm install` in this
directory.

### 1. Discord application

1. Create an app at <https://discord.com/developers/applications>.
2. From **General Information**, save the **Application ID** and **Public
   Key**; from the **Bot** tab, save the **token** — all into a 1Password
   item (the template expects `Discord MaintainX Bot` with fields
   `app id` / `public key` / `bot token`; adjust `.dev.vars.tpl` to taste).
3. Install the app to the server: visit
   `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=applications.commands`
   while signed into an account with Manage Server permission.

### 2. MaintainX API key

In MaintainX: **Settings → Integrations → API Keys** → generate a key, store
it in 1Password. (If the key spans multiple organizations, also note the org
ID for `MAINTAINX_ORG_ID`.)

### 3. Configure secrets

Edit `.dev.vars.tpl` so the `op://` references point at your 1Password items,
and set `DISCORD_GUILD_ID` to the server's ID (right-click the server name
with Developer Mode enabled).

### 4. Register the slash command

```sh
op run --env-file=.dev.vars.tpl -- npm run register-commands
```

### 5. Pick the boats

```sh
op run --env-file=.dev.vars.tpl -- npm run list-assets
```

Copy the relevant entries into `src/boats.json` (up to 25 — Discord's select
menu limit).

### 6. Cloudflare

1. Sign up (free tier) at <https://dash.cloudflare.com/sign-up>.
2. `npx wrangler login`
3. Deploy and push secrets:

   ```sh
   npm run deploy
   op run --env-file=.dev.vars.tpl -- ./scripts/push-secrets.sh
   ```

   Note the worker URL printed by deploy
   (`https://discord-maintainx.<your-subdomain>.workers.dev`).

### 7. Point Discord at the worker

In the Developer Portal, **General Information → Interactions Endpoint URL**,
paste the worker URL and save. Discord immediately verifies the endpoint
(PING + deliberately bad signatures), so do this only after step 6.

### 8. Restrict access (optional but intended)

Put the boat-repair channel ID in `ALLOWED_CHANNEL_IDS` and the
instructor/tutor role IDs in `ALLOWED_ROLE_IDS` in `wrangler.jsonc`, then
`npm run deploy` again. (Get IDs by right-clicking the channel/role with
Developer Mode enabled.)

## Status announcements (phase 2)

MaintainX webhooks notify the worker (on `POST /maintainx`, HMAC-verified)
when a work request changes status; approvals, rejections, and completions
for whitelisted boats are posted to the channel via a Discord channel
webhook. Setup:

1. In Discord: **#boat-status → Edit Channel → Integrations → Webhooks →
   New Webhook**, copy the webhook URL into 1Password.
2. Create the MaintainX subscription (prints the signing secret once —
   store it in 1Password):

   ```sh
   op run --env-file=.dev.vars.tpl -- npm run subscriptions -- create
   ```

3. Update the `op://` references in `.dev.vars.tpl` if needed, then push
   both new secrets: `op run --env-file=.dev.vars.tpl -- ./scripts/push-secrets.sh`

Until `DISCORD_WEBHOOK_URL` and `MAINTAINX_WEBHOOK_SECRET` are set, the
`/maintainx` endpoint answers 503 and the feature is simply off. Status
changes for assets not in `src/boats.json` are ignored, so youth-program
activity never reaches the channel.

## Day-to-day

| Task | Command |
| --- | --- |
| Type-check | `npm run check` |
| Local dev server | `op inject -i .dev.vars.tpl -o .dev.vars`, then `npm run dev` |
| Deploy | `npm run deploy` |
| Change the boat list | edit `src/boats.json`, deploy |
| Change the command definition | edit `scripts/register-commands.ts`, re-run it |

## Notes & limits

- Discord gives the worker 3 s to respond to an interaction; the modal-submit
  handler defers immediately and finishes within the 15-minute token window.
- Photo limit: 5 per request in the form; Discord caps uploads at 10 MiB per
  file (more with Nitro/boosts). Failed photo uploads don't fail the request —
  the confirmation lists what couldn't be attached.
- MaintainX rate limits (100 req/min) are far above this usage.
- The modal **File Upload** component (type 19) is a recent Discord addition.
  If it misbehaves on some clients, the fallback is an attachment option on
  the slash command itself — see PROPOSAL.md "Edge cases & fallbacks".
