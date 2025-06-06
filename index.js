import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import fetch from 'node-fetch';
import express from 'express';
import bodyParser from 'body-parser';
import qrcode from 'qrcode';
import cloudinary from 'cloudinary';
import jwt from 'jsonwebtoken';

const app = express();
const PORT = process.env.PORT || 3000;

// Konfigurasi Cloudinary
cloudinary.config({
  cloud_name: 'dn4mbrhj4',
  api_key: '623695854384555',
  api_secret: '_eDLYHDoIqrzMJBBjHJ7mfyWUz8',
});

// Service Account untuk Firebase JWT
const serviceAccount = {
  private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  client_email: 'firebase-adminsdk-fbsvc@bot-wa-dd801.iam.gserviceaccount.com',
  project_id: 'bot-wa-dd801',
};

// Fungsi untuk ambil access token dari Firebase
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };

  const jwtToken = jwt.sign(payload, serviceAccount.private_key, { algorithm: 'RS256' });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwtToken,
    }),
  });

  const data = await response.json();
  return data.access_token;
}

// Inisialisasi WhatsApp client
console.log('Memulai inisialisasi WhatsApp client...');
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// QR Code login
client.on('qr', async (qr) => {
  console.log('📸 QR Code diterima, silakan scan...');
  try {
    const url = await qrcode.toDataURL(qr);
    const result = await cloudinary.v2.uploader.upload(url, {
      folder: 'whatsapp_qrcodes',
      public_id: 'qrcode_image',
      resource_type: 'image',
    });
    console.log('✅ QR Code diupload:', result.secure_url);
  } catch (err) {
    console.error('❌ Gagal membuat/mengupload QR:', err);
    console.error('Detail QR:', qr);
  }
});

// Event saat bot siap
client.on('ready', () => {
  console.log('✅ Bot WhatsApp siap digunakan!');
});

client.on('auth_failure', msg => {
  console.error('❌ Autentikasi gagal:', msg);
});

client.on('disconnected', reason => {
  console.error('❌ Bot terputus:', reason);
});

// Pesan masuk
client.on('message', async (message) => {
  if (message.fromMe) return;

  const userId = message.from;
  const userMessage = message.body;

  console.log('📥 Pesan dari', userId, ':', userMessage);

  try {
    const accessToken = await getAccessToken();

    const webhookResponse = await fetch('https://hook.eu2.make.com/fsh51ub7tasw8koialuh7h911fgrt1i7', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMessage,
        from: userId,
        access_token: accessToken,
      }),
    });

    const contentType = webhookResponse.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await webhookResponse.text();
      console.warn('⚠️ Webhook tidak mengembalikan JSON. Respons:', text);
      return;
    }

    const data = await webhookResponse.json();
    if (data.reply) {
      await message.reply(data.reply);
      console.log('✅ Balasan berhasil dikirim.');
    } else {
      console.log('ℹ️ Tidak ada balasan dari webhook.');
    }
  } catch (error) {
    console.error('❌ Gagal memproses pesan:', error);
  }
});

// Endpoint test Railway
app.get('/', (req, res) => {
  res.send('WhatsApp bot aktif.');
});

// Endpoint kirim pesan manual
app.use(bodyParser.json());
app.post('/reply', async (req, res) => {
  try {
    let payload;

    if (typeof req.body === 'string') {
      try {
        payload = JSON.parse(req.body);
      } catch (e) {
        return res.status(400).json({ error: 'Format JSON tidak valid.' });
      }
    } else if (typeof req.body.data === 'string') {
      try {
        payload = JSON.parse(req.body.data);
      } catch (e) {
        return res.status(400).json({ error: 'Format JSON dalam field "data" tidak valid.' });
      }
    } else {
      payload = req.body.data || req.body;
    }

    const { from, reply, imageUrl, caption } = payload;

    if (!from || (!reply && !imageUrl)) {
      return res.status(400).json({
        error: 'Parameter "from" dan minimal salah satu dari "reply" atau "imageUrl" wajib diisi',
        contoh_format: {
          from: '628xxxx@c.us',
          reply: 'Pesan balasan',
          imageUrl: 'https://domain.com/file.jpg',
          caption: 'Ini caption opsional',
        },
      });
    }

    if (imageUrl) {
      const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
      await client.sendMessage(from, media, { caption: caption || reply || '' });
    } else {
      await client.sendMessage(from, reply);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error di /reply:', err);
    res.status(500).json({
      error: 'Gagal memproses permintaan.',
      detail: err.message,
      raw: req.body,
    });
  }
});

// Inisialisasi bot
client.initialize()
  .then(() => console.log('✅ client.initialize() sukses'))
  .catch(err => console.error('❌ Gagal initialize WhatsApp client:', err));

// Jalankan server
app.listen(PORT, () => {
  console.log(`🚀 Server Express aktif di port ${PORT}`);
});
