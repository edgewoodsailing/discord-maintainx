# Discord → MaintainX Work Request Bridge — Design Proposal

A small bridge service that lets Discord users file MaintainX **work requests**
(title, description, asset/boat, optional photos) via a `/request` slash command.

## What the APIs give us (verified 2026-06-10)

**MaintainX** (`https://api.getmaintainx.com/v1`, bearer-token auth):

- `POST /workrequests` — creates a work request (the lightweight entity that goes
  through MaintainX's approval flow, which is what we want — not a full work
  order). Only `title` is required; `description`, `priority`, `assetId`,
  `locationId`, and `creatorContactInfo` are optional. Returns `{"id": <n>}`.
- `GET /assets` — lists assets (cursor pagination, up to 200/page). No
  server-side name search, so the bridge caches the asset list and filters
  client-side.
- `PUT /workrequests/{id}/attachments/{filename}` — attaches a photo by sending
  the raw binary body (`application/octet-stream`). So photos are a two-step
  flow: create the request, then PUT each photo onto it.
- Webhooks: `POST /subscriptions` with events like `WORK_REQUEST_STATUS_CHANGE`
  (HMAC-SHA256 signed) — enables a later phase where Discord gets notified when
  a request is approved/completed.
- Rate limits: 100 requests/min per user token — far more than this needs.

**Discord** (interactions API):

- Slash commands can open a **modal**, and modals are no longer text-only:
  current components include **String Select (type 3)** and **File Upload
  (type 19)** inside modals, each wrapped in a Label (type 18). A modal allows
  up to 5 top-level components.
- So the *entire* form fits in one modal: title (text input), description
  (paragraph input), boat (string select, ≤25 options), photos (file upload,
  0–10 files, optional). That's 4 of the 5 allowed components.
- Modal submissions deliver uploaded files as attachment objects with signed
  CDN URLs — the bridge downloads the bytes and re-uploads them to MaintainX.
- Interactions can be received as plain HTTPS webhooks (Ed25519-signature
  verified) — no persistent websocket/gateway connection needed. Initial
  response within 3 s; defer + edit gives up to 15 min for the real work.

## Proposed user experience

```
User: /request
  ↓ (bot responds with a modal, ≤3 s)
┌─ New maintenance request ────────────────┐
│ Title*        [Torn jib sheet           ]│
│ Description   [Starboard jib sheet      ]│
│               [chafed through at the    ]│
│               [clutch...                ]│
│ Boat*         [ Select a boat        ▾ ] │  ← populated from MaintainX assets
│ Photos        [ ⬆ Upload (up to 5)     ] │  ← optional
└──────────────────────────[Cancel][Submit]┘
  ↓ (submit → deferred ephemeral reply → bridge calls MaintainX)
Bot (ephemeral): ✅ Request #123 “Torn jib sheet” filed for **Laser 4521**
                 with 2 photos. The maintenance team will review it.
```

One command, one modal, done. No multi-step button flows.

## Architecture

```
Discord client
   │  HTTPS interaction webhooks (Ed25519-signed)
   ▼
Bridge service (single small web service)
   │  ├─ verify signature, ack PINGs
   │  ├─ /request command  → GET cached assets → respond MODAL
   │  ├─ MODAL_SUBMIT      → defer → POST /workrequests
   │  │                     → download photos from Discord CDN
   │  │                     → PUT /workrequests/{id}/attachments/{file}
   │  │                     → edit deferred reply with confirmation
   │  └─ asset cache: GET /assets on startup + refresh every ~10 min
   ▼
MaintainX API (bearer token, x-organization-id header if multi-org)
```

- **HTTP interactions endpoint, not gateway**: everything this bot does
  (commands, modals) arrives as an interaction, so a public HTTPS endpoint is
  sufficient. Runs fine on a tiny always-on server or serverless (Cloudflare
  Workers / Fly.io / a Mac mini behind a tunnel).
- **Requester identity**: pass the Discord user into MaintainX via
  `creatorContactInfo` (e.g. `"Discord: @sam"`), and optionally a custom field
  via `extraFields`, so the maintenance team knows who asked without every
  sailor needing a MaintainX account. The API token is a single service
  account.
- **Boat list**: cached from `GET /assets`. If the org's asset tree has
  non-boat assets, filter by `locationId` or parent asset (configurable).

## API mapping

| Modal field | Discord component | MaintainX field |
|---|---|---|
| Title (required) | Text Input, short, ≤100 chars | `title` |
| Description | Text Input, paragraph | `description` |
| Boat (required) | String Select (asset name → `assetId` value) | `assetId` |
| Photos (optional) | File Upload, max 5, images | `PUT …/attachments/{filename}` after create |
| (implicit) | invoking user | `creatorContactInfo` |

## Edge cases & fallbacks

- **>25 boats**: a modal select caps at 25 options. Fallback: make `boat` an
  autocomplete option on the slash command itself (`/request boat:<typeahead>`),
  which queries the cached asset list, then open the modal for title/
  description/photos only.
- **File Upload in modals is a recent Discord component** (Components V2). If
  it turns out not to be rolled out to all clients yet, fallback: an
  ATTACHMENT-type option on the slash command (`/request photo:<file>`), which
  is long-stable — user attaches the photo when invoking the command, then the
  modal collects the text fields.
- **Photo size**: Discord default cap is 10 MiB/file; MaintainX accepts
  image/jpeg, png, heic, webp, etc. and returns 413 if too large — the bridge
  reports a partial success ("request filed, photo X failed") rather than
  failing the whole request.
- **3-second rule**: opening the modal requires the asset list immediately —
  hence the cache, never a live MaintainX call in that path. The modal-submit
  path defers first, so the create + photo uploads have a 15-minute window.
- **MaintainX down / errors**: ephemeral error reply with the gist; nothing is
  lost since the user can re-submit. (A retry queue is overkill for v1.)

## Phase 2 (optional, later)

- **Status notifications back to Discord**: subscribe to
  `WORK_REQUEST_STATUS_CHANGE` / `NEW_COMMENT_ON_WORK_ORDER` MaintainX webhooks
  and post to a `#maintenance` channel ("Request #123 approved → WO #456",
  "…marked Done"). The same bridge service receives these (HMAC-verified).
- `/status` command to look up your recent requests (`GET /workrequests`
  filtered by title/ID).

## Suggested stack

TypeScript on Node (or Bun) with a minimal HTTP framework, `tweetnacl`/
`discord-interactions` for Ed25519 verification, plain `fetch` for both APIs —
no heavy Discord library needed since there's no gateway connection. Config via
env: `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN` (only for
registering commands), `MAINTAINX_API_TOKEN`, optional `MAINTAINX_ORG_ID`,
asset-filter settings.

## Open questions

1. How many boats/assets are in the MaintainX org (≤25 → pure-modal flow;
   more → autocomplete fallback)?
2. Hosting preference: serverless (Workers/Lambda) vs. small always-on box?
3. Should requests be restricted to a specific Discord server/channel/role?
4. Is phase-2 status notification wanted from the start?
