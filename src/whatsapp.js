// --- WhatsApp imports ---
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import dotenv from 'dotenv';
dotenv.config();
const WHATSAPP_NOTIFY_NUMBER = process.env.WHATSAPP_NOTIFY_NUMBER;

// --- WhatsApp client ---
const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

whatsapp.on("qr", async (qr) => {
    try {
        // Generate QR as buffer
        const qrBuffer = await QRCode.toBuffer(qr);

        // Create an attachment for Discord
        const attachment = new AttachmentBuilder(qrBuffer, { name: "whatsapp-qr.png" });

        // Pick a text channel where you want to send it
        const channel = discordClient.channels.cache.get(process.env.RECORDING_NOTICE_CHANNEL_ID);
        if (channel) {
            channel.send({
                content: "📲 Scan this QR code to connect WhatsApp:",
                files: [attachment],
            });
        } else {
            console.error("QR_CHANNEL_ID is not valid or bot has no access.");
        }
    } catch (err) {
        console.error("Failed to generate QR for Discord:", err);
    }
});

whatsapp.on('ready', () => {
    console.log('✅ WhatsApp client is ready');
});

whatsapp.on('auth_failure', msg => {
    console.error('❌ WhatsApp authentication failed:', msg);
});

whatsapp.initialize();

const sendMessage = async (message) => {
    await whatsapp.sendMessage(WHATSAPP_NOTIFY_NUMBER, message);
};

export { whatsapp, sendMessage };