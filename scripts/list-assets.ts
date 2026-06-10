// Lists all MaintainX assets so you can pick the boats for src/boats.json:
//
//   op run --env-file=.dev.vars.tpl -- npm run list-assets
//
// Prints every asset (id, name, location), then a boats.json-ready JSON
// snippet for the full list — trim it down to the whitelisted boats.

export {}; // top-level await requires module context

const token = process.env.MAINTAINX_API_TOKEN;
const orgId = process.env.MAINTAINX_ORG_ID;

if (!token) {
  console.error('MAINTAINX_API_TOKEN must be set.');
  process.exit(1);
}

interface Asset {
  id: number;
  name: string;
  locationId: number | null;
}

const headers: Record<string, string> = {
  authorization: `Bearer ${token}`,
  ...(orgId ? { 'x-organization-id': orgId } : {}),
};

const assets: Asset[] = [];
let cursor: string | null = null;
do {
  const url = new URL('https://api.getmaintainx.com/v1/assets');
  url.searchParams.set('limit', '200');
  if (cursor) url.searchParams.set('cursor', cursor);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`Failed (HTTP ${res.status}):`, await res.text());
    process.exit(1);
  }
  const page = (await res.json()) as { assets: Asset[]; nextCursor: string | null };
  assets.push(...page.assets);
  cursor = page.nextCursor;
} while (cursor);

console.log(`${assets.length} assets:\n`);
for (const a of assets) {
  console.log(`  ${String(a.id).padStart(8)}  ${a.name}${a.locationId ? `  (location ${a.locationId})` : ''}`);
}

console.log('\nboats.json snippet (keep only the boats you want):\n');
console.log(
  JSON.stringify(
    assets.map((a) => ({ name: a.name, assetId: a.id })),
    null,
    2,
  ),
);
