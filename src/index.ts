// Discord -> MaintainX bridge.
//
// A single Cloudflare Worker serving as the Discord Interactions Endpoint:
//   /request  -> opens a modal (title, description, boat select, photo upload)
//   submit    -> creates a MaintainX work request, attaches photos, confirms.

import boatsJson from './boats.json';
import {
  ComponentType,
  type DiscordAttachment,
  displayName,
  editOriginalResponse,
  ephemeralMessage,
  type Interaction,
  InteractionCallbackType,
  InteractionType,
  interactionResponse,
  MessageFlags,
  collectModalValues,
  TextInputStyle,
  verifyDiscordRequest,
} from './discord';
import { createWorkRequest, uploadWorkRequestAttachment } from './maintainx';

interface Env {
  DISCORD_PUBLIC_KEY: string;
  MAINTAINX_API_TOKEN: string;
  MAINTAINX_ORG_ID?: string;
  ALLOWED_CHANNEL_IDS?: string;
  ALLOWED_ROLE_IDS?: string;
}

interface Boat {
  name: string;
  assetId: number;
}

const boats: Boat[] = boatsJson;

const COMMAND_NAME = 'request';
const MODAL_ID = 'work-request';
const MAX_PHOTOS = 5;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('discord-maintainx bridge is running', { status: 200 });
    }

    const { valid, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response('invalid request signature', { status: 401 });
    }

    const interaction = JSON.parse(body) as Interaction;
    switch (interaction.type) {
      case InteractionType.PING:
        return interactionResponse({ type: InteractionCallbackType.PONG });
      case InteractionType.APPLICATION_COMMAND:
        return handleCommand(interaction, env);
      case InteractionType.MODAL_SUBMIT:
        return handleModalSubmit(interaction, env, ctx);
      default:
        return ephemeralMessage('Sorry, I don’t know how to handle that interaction.');
    }
  },
} satisfies ExportedHandler<Env>;

// Returns a user-facing refusal, or null if the interaction is allowed.
function accessError(interaction: Interaction, env: Env): string | null {
  const allowedChannels = splitIds(env.ALLOWED_CHANNEL_IDS);
  if (allowedChannels.length > 0 && !allowedChannels.includes(interaction.channel_id ?? '')) {
    return 'Please use this command in the boat repair channel.';
  }
  const allowedRoles = splitIds(env.ALLOWED_ROLE_IDS);
  if (allowedRoles.length > 0) {
    const memberRoles = interaction.member?.roles ?? [];
    if (!memberRoles.some((r) => allowedRoles.includes(r))) {
      return 'This command is only available to instructors and tutors.';
    }
  }
  return null;
}

function splitIds(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function handleCommand(interaction: Interaction, env: Env): Response {
  if (interaction.data?.name !== COMMAND_NAME) {
    return ephemeralMessage('Unknown command.');
  }
  const refusal = accessError(interaction, env);
  if (refusal) return ephemeralMessage(refusal);

  return interactionResponse({
    type: InteractionCallbackType.MODAL,
    data: {
      custom_id: MODAL_ID,
      title: 'New boat repair request',
      components: [
        {
          type: ComponentType.LABEL,
          label: 'Title',
          component: {
            type: ComponentType.TEXT_INPUT,
            custom_id: 'title',
            style: TextInputStyle.SHORT,
            max_length: 100,
            required: true,
            placeholder: 'e.g. Torn jib sheet',
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Description',
          description: 'What’s wrong, and where on the boat?',
          component: {
            type: ComponentType.TEXT_INPUT,
            custom_id: 'description',
            style: TextInputStyle.PARAGRAPH,
            max_length: 4000,
            required: false,
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Boat',
          component: {
            type: ComponentType.STRING_SELECT,
            custom_id: 'boat',
            required: true,
            placeholder: 'Select a boat',
            options: boats.map((b) => ({ label: b.name, value: String(b.assetId) })),
          },
        },
        {
          type: ComponentType.LABEL,
          label: 'Photos',
          description: 'Optional — up to 5 images',
          component: {
            type: ComponentType.FILE_UPLOAD,
            custom_id: 'photos',
            min_values: 0,
            max_values: MAX_PHOTOS,
            required: false,
          },
        },
      ],
    },
  });
}

function handleModalSubmit(interaction: Interaction, env: Env, ctx: ExecutionContext): Response {
  if (interaction.data?.custom_id !== MODAL_ID) {
    return ephemeralMessage('Unknown form.');
  }

  const values = collectModalValues(interaction.data.components ?? []);
  const title = values.get('title')?.value?.trim();
  const description = values.get('description')?.value?.trim();
  const assetId = Number(values.get('boat')?.values?.[0]);
  const boatName = boats.find((b) => b.assetId === assetId)?.name ?? `asset ${assetId}`;
  const resolved = interaction.data.resolved?.attachments ?? {};
  const photos = (values.get('photos')?.values ?? [])
    .map((id) => resolved[id])
    .filter((a): a is DiscordAttachment => Boolean(a));

  if (!title || !Number.isFinite(assetId)) {
    return ephemeralMessage('Something was missing from the form — please try again.');
  }

  const user = interaction.member?.user ?? interaction.user;

  // Acknowledge within Discord's 3-second window, then do the MaintainX work
  // and edit this deferred response with the outcome.
  ctx.waitUntil(
    fileWorkRequest(interaction, env, {
      title,
      description,
      assetId,
      boatName,
      photos,
      requester: displayName(user),
    }),
  );
  return interactionResponse({
    type: InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: MessageFlags.EPHEMERAL },
  });
}

interface Submission {
  title: string;
  description?: string;
  assetId: number;
  boatName: string;
  photos: DiscordAttachment[];
  requester: string;
}

async function fileWorkRequest(interaction: Interaction, env: Env, sub: Submission): Promise<void> {
  let message: string;
  try {
    const id = await createWorkRequest(env, {
      title: sub.title,
      description: sub.description || undefined,
      assetId: sub.assetId,
      creatorContactInfo: `Discord: ${sub.requester}`,
    });

    const failed: string[] = [];
    let uploaded = 0;
    for (const photo of sub.photos) {
      try {
        const res = await fetch(photo.url);
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        await uploadWorkRequestAttachment(env, id, photo.filename, await res.arrayBuffer());
        uploaded++;
      } catch {
        failed.push(photo.filename);
      }
    }

    message = `✅ Work request filed for **${sub.boatName}**: “${sub.title}”`;
    if (uploaded > 0) message += ` with ${uploaded} photo${uploaded === 1 ? '' : 's'}`;
    message += '. The maintenance team will review it.';
    if (failed.length > 0) {
      message += `\n⚠️ Could not attach: ${failed.join(', ')}. You can add photos in MaintainX.`;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    message = `❌ Sorry, the request could not be filed (${reason}). Please try again, or report the issue directly in MaintainX.`;
  }
  await editOriginalResponse(interaction.application_id, interaction.token, message);
}
