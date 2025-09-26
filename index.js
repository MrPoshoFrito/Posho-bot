import dotenv from 'dotenv';
dotenv.config();
import { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, Events } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import Recorder from './src/recorder.js';
import { sendMessage } from './src/whatsapp.js';

// --- ENV ---
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const RECORDING_NOTICE_CHANNEL_ID = process.env.RECORDING_NOTICE_CHANNEL_ID || null;
const SEND_WHATSAPP_MESSAGES = process.env.SEND_WHATSAPP_MESSAGES || false;
const BUFFER_MINUTES = parseInt(process.env.BUFFER_MINUTES || '5', 10);

// --- Discord client ---
if (!TOKEN) {
    console.error('BOT_TOKEN missing in ENV');
    process.exit(1);
}

const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

const recorder = new Recorder({ bufferMs: BUFFER_MINUTES * 60 * 1000 });
// --- Slash commands ---
const commands = [
    new SlashCommandBuilder().setName('join').setDescription('Invite the bot to your voice channel'),
    new SlashCommandBuilder().setName('leave').setDescription('Disconnect the bot from voice'),
    new SlashCommandBuilder().setName('save').setDescription('Save the last N minutes of voice and return the file'),
    new SlashCommandBuilder().setName('status').setDescription('Show recorder status'),
].map(cmd => cmd.toJSON());

discord.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${discord.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
            console.log('Registered guild commands.');
        } else {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('Registered global commands.');
        }
    } catch (err) {
        console.error('Failed to register commands', err);
    }
});

// --- Voice channel join listener ---
discord.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const notify = async (message) => {
        // Discord text channel
        if (RECORDING_NOTICE_CHANNEL_ID) {
            try {
                const ch = await discord.channels.fetch(RECORDING_NOTICE_CHANNEL_ID);
                if (ch && ch.isTextBased()) {
                    ch.send(message);
                }
            } catch (err) {
                console.error('Discord text notify failed', err);
            }
        }
        // WhatsApp
        if (SEND_WHATSAPP_MESSAGES) {
            try {
                await sendMessage(message);
            } catch (err) {
                console.error('WhatsApp notify failed', err);
            }
        }
    };

    if (!oldState.channelId && newState.channelId) {
        const member = newState.member;
        const voiceChannel = newState.channel;
        const message = `👋 ${member.user.tag} joined **${voiceChannel.name}**`;
        await notify(message);
    }
    if (oldState.channelId && !newState.channelId) {
        const member = oldState.member;
        const message = `👋 ${member.user.tag} left **${oldState.channel.name}**`;
        await notify(message);
    }

});

// --- Slash command handler ---
discord.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'join') {
        const member = interaction.member;
        const channel = member?.voice?.channel;
        if (!channel) return interaction.reply({ content: 'You need to join a voice channel first.', flags: 64 });

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
        });

        try {
            await recorder.start(connection, channel, interaction.channel);
            if (RECORDING_NOTICE_CHANNEL_ID) {
                const ch = await discord.channels.fetch(RECORDING_NOTICE_CHANNEL_ID).catch(() => null);
                if (ch && ch.isTextBased() && ch.send) {
                    ch.send(`⚠️ Recording buffer active in VC **${channel.name}** (keeps last ${BUFFER_MINUTES} minutes). Use /save to extract audio.`);
                }
            } else {
                interaction.reply({ content: `Joined **${channel.name}** and started buffering.`, flags: 64 });
            }
        } catch (err) {
            console.error('Start recorder error', err);
            interaction.reply({ content: 'Failed to start recorder: ' + String(err.message), flags: 64 });
        }
    }

    if (commandName === 'leave') {
        const guildConnection = getVoiceConnection(interaction.guildId);
        if (guildConnection) {
            recorder.stop();
            guildConnection.destroy();
            interaction.reply({ content: 'Left voice channel and stopped buffering.' });
        } else {
            interaction.reply({ content: 'Bot is not in a voice channel.', flags: 64 });
        }
    }

    if (commandName === 'save') {
        await interaction.deferReply({ flags: 64 });
        try {
            const userMap = new Map();
            for (const [id] of recorder.perUserBuffers.entries()) {
                const member = await discord.guilds.cache
                    .get(interaction.guildId)
                    ?.members.fetch(id)
                    .catch(() => null);
                if (member) userMap.set(id, member.user.tag);
            }
            const userFiles = await recorder.saveBuffersToFiles({ format: process.env.OUTPUT_FORMAT || 'mp3', usersMap: userMap });
            if (userFiles && Object.keys(userFiles).length > 0) {
                await interaction.editReply({
                    content: `Saved files for users:`,
                    files: Object.values(userFiles)
                });
            } else {
                interaction.editReply('No audio buffered right now.');
            }
        } catch (err) {
            console.error('Save failed', err);
            interaction.editReply('Failed to save: ' + String(err.message));
        }
    }

    if (commandName === 'status') {
        const stat = recorder.status();
        interaction.reply({ content: stat, flags: 64 });
    }
});

discord.on('error', console.error);
discord.login(TOKEN);
