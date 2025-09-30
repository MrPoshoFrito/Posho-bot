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

whatsapp.on("qr", (qr) => {
    console.log("WhatsApp QR data (copy and paste into any QR code generator):");
    console.log(qr);
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