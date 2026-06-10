// Registers the /request slash command with Discord. Run whenever the
// command definition changes:
//
//   op run --env-file=.dev.vars.tpl -- npm run register-commands
//
// With DISCORD_GUILD_ID set, the command is registered per-guild (updates
// instantly); without it, globally (can take up to an hour to propagate).

export {}; // top-level await requires module context

const appId = process.env.DISCORD_APP_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !botToken) {
  console.error('DISCORD_APP_ID and DISCORD_BOT_TOKEN must be set.');
  process.exit(1);
}

const command = {
  name: 'request',
  type: 1, // CHAT_INPUT
  description: 'File a boat repair request with MaintainX',
  contexts: [0], // guild only
};

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const res = await fetch(url, {
  method: 'PUT', // overwrite the full command list with exactly this one
  headers: {
    authorization: `Bot ${botToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify([command]),
});

if (!res.ok) {
  console.error(`Failed (HTTP ${res.status}):`, await res.text());
  process.exit(1);
}
console.log(
  `Registered /request ${guildId ? `in guild ${guildId}` : 'globally'}.`,
);
