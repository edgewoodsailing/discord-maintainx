// Smoke-tests the MaintainX calls the worker makes: create a work request,
// attach a small PNG, read it back, then delete the work request.
//
//   op run --env-file=.dev.vars.tpl -- tsx scripts/test-maintainx.ts
//
// The test request is clearly titled and deleted at the end, but it may
// briefly trigger a new-request notification in MaintainX.

export {};

const token = process.env.MAINTAINX_API_TOKEN;
const orgId = process.env.MAINTAINX_ORG_ID;
if (!token) {
  console.error('MAINTAINX_API_TOKEN must be set.');
  process.exit(1);
}

const BASE = 'https://api.getmaintainx.com/v1';
const headers: Record<string, string> = {
  authorization: `Bearer ${token}`,
  ...(orgId ? { 'x-organization-id': orgId } : {}),
};

// 1x1 transparent PNG
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

async function expectOk(res: Response, step: string): Promise<Response> {
  if (!res.ok) {
    console.error(`✗ ${step}: HTTP ${res.status}`, (await res.text()).slice(0, 500));
    process.exit(1);
  }
  console.log(`✓ ${step}`);
  return res;
}

// 1. Create
const createRes = await expectOk(
  await fetch(`${BASE}/workrequests`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'TEST — Discord bridge connectivity check (auto-deleted)',
      description: 'Created by scripts/test-maintainx.ts; deleted by the same script.',
    }),
  }),
  'create work request',
);
const { id } = (await createRes.json()) as { id: number };
console.log(`  id: ${id}`);

// 2. Attach photo
await expectOk(
  await fetch(`${BASE}/workrequests/${id}/attachments/test.png`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    body: PNG,
  }),
  'upload attachment',
);

// 3. Read back
const getRes = await expectOk(
  await fetch(`${BASE}/workrequests/${id}`, { headers }),
  'fetch work request',
);
const body = await getRes.text();
const attached = body.includes('test.png');
console.log(attached ? '✓ attachment visible on work request' : `✗ attachment missing: ${body.slice(0, 300)}`);

// 4. Delete
await expectOk(
  await fetch(`${BASE}/workrequests/${id}`, { method: 'DELETE', headers }),
  'delete work request',
);

if (!attached) process.exit(1);
console.log('\nAll MaintainX calls the worker depends on are working.');
