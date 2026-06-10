// Discord HTTP-interactions helpers: payload types, Ed25519 signature
// verification, and response builders.
//
// Reference: https://docs.discord.com/developers/interactions/receiving-and-responding

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionCallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  MODAL: 9,
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  LABEL: 18,
  FILE_UPLOAD: 19,
} as const;

export const TextInputStyle = {
  SHORT: 1,
  PARAGRAPH: 2,
} as const;

export const MessageFlags = {
  EPHEMERAL: 1 << 6,
} as const;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
}

// A component as it appears in a MODAL_SUBMIT payload. Leaf inputs carry
// value/values; Label (component) and Action Row (components) wrap them.
export interface ModalSubmitComponent {
  type: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  component?: ModalSubmitComponent;
  components?: ModalSubmitComponent[];
}

export interface Interaction {
  type: number;
  id: string;
  token: string;
  application_id: string;
  channel_id?: string;
  guild_id?: string;
  member?: { roles: string[]; user: DiscordUser };
  user?: DiscordUser;
  data?: {
    name?: string;
    custom_id?: string;
    components?: ModalSubmitComponent[];
    resolved?: { attachments?: Record<string, DiscordAttachment> };
  };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Every interaction request must be verified against the app's public key;
// Discord probes endpoints with invalid signatures and revokes URLs that
// accept them.
export async function verifyDiscordRequest(
  request: Request,
  publicKey: string,
): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  if (!signature || !timestamp) return { valid: false, body };
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
    return { valid, body };
  } catch {
    return { valid: false, body };
  }
}

export function interactionResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
}

export function ephemeralMessage(content: string): Response {
  return interactionResponse({
    type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: MessageFlags.EPHEMERAL },
  });
}

// Replace the deferred "thinking..." response once the real work is done.
// Interaction tokens stay valid for 15 minutes.
export async function editOriginalResponse(
  applicationId: string,
  token: string,
  content: string,
): Promise<void> {
  await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
}

// Post a public follow-up message in the interaction's channel. Mentions are
// rendered but never ping.
export async function followupMessage(
  applicationId: string,
  token: string,
  content: string,
): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}

// Flatten a MODAL_SUBMIT component tree (Label and Action Row wrappers) into
// a map of custom_id -> leaf input.
export function collectModalValues(
  components: ModalSubmitComponent[],
): Map<string, ModalSubmitComponent> {
  const out = new Map<string, ModalSubmitComponent>();
  const walk = (c: ModalSubmitComponent) => {
    if (c.component) walk(c.component);
    if (c.components) c.components.forEach(walk);
    if (c.custom_id && (c.value !== undefined || c.values !== undefined)) {
      out.set(c.custom_id, c);
    }
  };
  components.forEach(walk);
  return out;
}

export function displayName(user: DiscordUser | undefined): string {
  if (!user) return 'unknown user';
  return user.global_name ? `${user.global_name} (@${user.username})` : `@${user.username}`;
}
