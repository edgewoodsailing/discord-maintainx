// Minimal MaintainX API client for the work-request flow.
//
// Reference: https://api.getmaintainx.com/v1/docs

const BASE_URL = 'https://api.getmaintainx.com/v1';

export interface MaintainXEnv {
  MAINTAINX_API_TOKEN: string;
  // Only required when the API token has access to multiple organizations.
  MAINTAINX_ORG_ID?: string;
}

function headers(env: MaintainXEnv, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${env.MAINTAINX_API_TOKEN}`,
    ...(env.MAINTAINX_ORG_ID ? { 'x-organization-id': env.MAINTAINX_ORG_ID } : {}),
    ...extra,
  };
}

async function raiseForStatus(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  const detail = (await res.text().catch(() => '')).slice(0, 500);
  throw new Error(`MaintainX ${action} failed: HTTP ${res.status} ${detail}`);
}

export interface NewWorkRequest {
  title: string;
  description?: string;
  assetId?: number;
  priority?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  creatorContactInfo?: string;
}

// Returns the new work request's global ID.
export async function createWorkRequest(env: MaintainXEnv, req: NewWorkRequest): Promise<number> {
  const res = await fetch(`${BASE_URL}/workrequests`, {
    method: 'POST',
    headers: headers(env, { 'content-type': 'application/json' }),
    body: JSON.stringify(req),
  });
  await raiseForStatus(res, 'create work request');
  const { id } = (await res.json()) as { id: number };
  return id;
}

export interface WorkRequest {
  id: number;
  title: string;
  requestStatus: 'PENDING' | 'REJECTED' | 'APPROVED' | 'DONE' | string;
  assetId: number | null;
}

export async function getWorkRequest(env: MaintainXEnv, id: number): Promise<WorkRequest> {
  const res = await fetch(`${BASE_URL}/workrequests/${id}`, { headers: headers(env) });
  await raiseForStatus(res, `fetch work request ${id}`);
  const data = (await res.json()) as WorkRequest | { workRequest: WorkRequest };
  return 'workRequest' in data ? data.workRequest : data;
}

// Attachments are uploaded as a raw binary body onto an existing work
// request, with the filename (extension included) in the path.
export async function uploadWorkRequestAttachment(
  env: MaintainXEnv,
  workRequestId: number,
  filename: string,
  data: ArrayBuffer,
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/workrequests/${workRequestId}/attachments/${encodeURIComponent(filename)}`,
    {
      method: 'PUT',
      headers: headers(env, { 'content-type': 'application/octet-stream' }),
      body: data,
    },
  );
  await raiseForStatus(res, `attach ${filename}`);
}
