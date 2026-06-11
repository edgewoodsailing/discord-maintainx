// Receives MaintainX webhook events (WORK_REQUEST_STATUS_CHANGE) and
// announces approvals/rejections/completions in the Discord channel.
//
// MaintainX does not document the delivered payload shape, so the handler
// only extracts a work request ID from the event and re-fetches the
// authoritative state from the API before announcing. Raw events are
// logged (visible via `wrangler tail`) to help refine parsing if needed.

import boatsJson from './boats.json';
import { getWorkRequest, type MaintainXEnv } from './maintainx';

export interface WebhookEnv extends MaintainXEnv {
  MAINTAINX_WEBHOOK_SECRET?: string;
  DISCORD_WEBHOOK_URL?: string;
}

const boats: { name: string; assetId: number }[] = boatsJson;

const REPLAY_TOLERANCE_MS = 5 * 60 * 1000;

// Header format: "t=<timestamp>,v1=<hmac>"; HMAC-SHA256 over
// "<timestamp>.<payload>" keyed with the subscription secret.
async function validSignature(
  header: string | null,
  body: string,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const parts = new Map(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = parts.get('t');
  const v1 = parts.get('v1');
  if (!t || !v1) return false;

  const tsMs = Number(t) > 1e12 ? Number(t) : Number(t) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > REPLAY_TOLERANCE_MS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

// Extract the work request ID. The observed WORK_REQUEST_STATUS_CHANGE
// payload is flat:
//   {"newStatus":"APPROVED","oldStatus":"PENDING","occurredAt":"...",
//    "orgId":99411,"requestId":12249562}
// The fallbacks below cover other shapes in case the format varies.
function findWorkRequestId(event: unknown): number | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const obj = event as Record<string, unknown>;
  if (typeof obj.requestId === 'number') return obj.requestId;
  if (typeof obj.workRequestId === 'number') return obj.workRequestId;
  for (const key of ['workRequest', 'newWorkRequest']) {
    const wr = obj[key];
    if (wr && typeof wr === 'object' && typeof (wr as { id?: unknown }).id === 'number') {
      return (wr as { id: number }).id;
    }
  }
  // A bare work request object at the top level.
  if (typeof obj.requestStatus === 'string' && typeof obj.id === 'number') return obj.id;
  for (const value of Object.values(obj)) {
    const found = findWorkRequestId(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

const STATUS_MESSAGES: Record<string, (boat: string, title: string) => string> = {
  APPROVED: (b, t) => `📋 The repair request for **${b}** — “${t}” — was approved and is now a work order.`,
  REJECTED: (b, t) => `📋 The repair request for **${b}** — “${t}” — was declined.`,
  DONE: (b, t) => `🎉 Repair completed on **${b}**: “${t}”`,
};

export async function handleMaintainXWebhook(
  request: Request,
  env: WebhookEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.MAINTAINX_WEBHOOK_SECRET || !env.DISCORD_WEBHOOK_URL) {
    return new Response('webhook not configured', { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get('x-maintainx-webhook-body-signature');
  if (!(await validSignature(signature, body, env.MAINTAINX_WEBHOOK_SECRET))) {
    return new Response('invalid signature', { status: 401 });
  }

  // Acknowledge within MaintainX's 10-second delivery timeout; announce async.
  ctx.waitUntil(processEvent(body, env));
  return new Response('ok');
}

async function processEvent(body: string, env: WebhookEnv): Promise<void> {
  console.log('maintainx event:', body.slice(0, 2000));

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return;
  }

  const id = findWorkRequestId(event);
  if (id === undefined) {
    console.log('no work request id found in event');
    return;
  }

  const wr = await getWorkRequest(env, id);
  const format = STATUS_MESSAGES[wr.requestStatus];
  if (!format) return; // PENDING or unknown status: nothing to announce

  const boat = boats.find((b) => b.assetId === wr.assetId);
  if (!boat) return; // not an adult-program boat; keep the channel quiet

  await fetch(env.DISCORD_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: format(boat.name, wr.title),
      allowed_mentions: { parse: [] },
    }),
  });
}
