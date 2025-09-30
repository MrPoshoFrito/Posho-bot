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

whatsapp.on('qr', (qr) => {
  console.log("Scan this QR string:", qr);
  qrcode.generate(qr, { small: true });
  QRCode.toFile("whatsapp-qr.png", qr, {
    color: { dark: '#000', light: '#FFF' }
  }, (err) => {
    if (err) console.error("QR save failed:", err);
    else console.log("QR code saved to whatsapp-qr.png");
  });
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