// Manage the MaintainX webhook subscription that powers status
// announcements in Discord.
//
//   op run --env-file=.dev.vars.tpl -- npm run subscriptions -- create [url]
//   op run --env-file=.dev.vars.tpl -- npm run subscriptions -- list
//   op run --env-file=.dev.vars.tpl -- npm run subscriptions -- delete <id>
//
// `create` prints the subscription secret ONCE — store it in 1Password as
// the MAINTAINX_WEBHOOK_SECRET item and push it to the worker.

export {};

const token = process.env.MAINTAINX_API_TOKEN;
const orgId = process.env.MAINTAINX_ORG_ID;
if (!token) {
  console.error('MAINTAINX_API_TOKEN must be set.');
  process.exit(1);
}

const BASE = 'https://api.getmaintainx.com/v1';
const DEFAULT_URL = 'https://discord-maintainx.edgewoodsailing.workers.dev/maintainx';
const headers: Record<string, string> = {
  authorization: `Bearer ${token}`,
  ...(orgId ? { 'x-organization-id': orgId } : {}),
};

const [cmd, arg] = process.argv.slice(2);

async function expectOk(res: Response, step: string): Promise<Response> {
  if (!res.ok) {
    console.error(`${step} failed (HTTP ${res.status}):`, (await res.text()).slice(0, 500));
    process.exit(1);
  }
  return res;
}

if (cmd === 'create') {
  const url = arg ?? DEFAULT_URL;
  const res = await expectOk(
    await fetch(`${BASE}/subscriptions`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'WORK_REQUEST_STATUS_CHANGE', url }),
    }),
    'create subscription',
  );
  const sub = (await res.json()) as { id: number; status: string; secret: string };
  console.log(`Subscription ${sub.id} created for ${url}`);
  console.log(`Status: ${sub.status}`);
  if (sub.status === 'PENDING_APPROVAL') {
    console.log('NOTE: MaintainX requires approval for this webhook — contact their support.');
  }
  console.log('\nSecret (store in 1Password, then push to the worker):');
  console.log(sub.secret);
} else if (cmd === 'list') {
  const res = await expectOk(await fetch(`${BASE}/subscriptions`, { headers }), 'list subscriptions');
  console.log(JSON.stringify(await res.json(), null, 2));
} else if (cmd === 'delete' && arg) {
  await expectOk(
    await fetch(`${BASE}/subscriptions/${arg}`, { method: 'DELETE', headers }),
    `delete subscription ${arg}`,
  );
  console.log(`Subscription ${arg} deleted.`);
} else {
  console.error('Usage: subscriptions.ts create [url] | list | delete <id>');
  process.exit(1);
}
