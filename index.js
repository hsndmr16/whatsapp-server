const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || 'nakliyat2026secret';
const AUTH_DIR = path.join(__dirname, 'auth_info');

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['Emixhas', 'Chrome', '120.0.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = await QRCode.toDataURL(qr);
        connectionStatus = 'qr_ready';
        console.log('📱 QR Kod hazir');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log('Baglanti koptu:', statusCode);
        connectionStatus = 'disconnected';
        qrCode = null;

        if (statusCode === DisconnectReason.loggedOut) {
          if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, { recursive: true });
          }
          console.log('Session silindi');
        }

        if (statusCode !== DisconnectReason.loggedOut) {
          await delay(5000);
          startWhatsApp();
        }
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        qrCode = null;
        console.log('WhatsApp baglandi!');
      }
    });
  } catch (err) {
    console.error('WhatsApp baslatilamadi:', err.message);
    await delay(10000);
    startWhatsApp();
  }
}

function checkAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Gecersiz API Key' });
  }
  next();
}

app.get('/', (req, res) => {
  res.json({ status: connectionStatus, uptime: Math.floor(process.uptime()) });
});

app.get('/qr', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp QR - Emixhas Yazilim</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0B141A;color:white;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.container{padding:40px;max-width:400px}
.brand{font-size:12px;color:rgba(255,255,255,0.3);margin-bottom:24px;letter-spacing:2px;text-transform:uppercase}
h1{font-size:24px;margin-bottom:8px}
p{font-size:14px;color:rgba(255,255,255,0.6);margin-bottom:24px}
.qr-box{background:white;border-radius:16px;padding:20px;margin-bottom:20px}
.qr-box img{width:100%;max-width:280px}
.status{padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600}
.connected{background:#25D366;color:white}
.waiting{background:#F07B2E;color:white}
.disc{background:#EF4444;color:white}
.refresh-btn{margin-top:16px;background:rgba(255,255,255,0.1);color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px}
.footer{margin-top:32px;font-size:11px;color:rgba(255,255,255,0.2)}
</style>
</head><body>
<div class="container">
<div class="brand">Emixhas Yazilim</div>
<h1>WhatsApp Baglantisi</h1>
<p>sehirlerarasinakliyat.com</p>
<div id="content">Yukleniyor...</div>
<button class="refresh-btn" onclick="load()">Yenile</button>
<div class="footer">Powered by Emixhas Yazilim</div>
</div>
<script>
async function load(){
try{
const r=await fetch('/status');
const d=await r.json();
const el=document.getElementById('content');
if(d.status==='connected'){
el.innerHTML='<div class="status connected">WhatsApp Bagli</div><p style="margin-top:16px;color:rgba(255,255,255,0.5)">Mesajlar gonderilebilir</p>';
}else if(d.qr){
el.innerHTML='<div class="qr-box"><img src="'+d.qr+'"/></div><div class="status waiting">QR Kodu WhatsApp ile Okutun</div><p style="margin-top:12px;color:rgba(255,255,255,0.4)">WhatsApp > Bagli Cihazlar > Cihaz Bagla</p>';
}else{
el.innerHTML='<div class="status disc">Baglanti Bekleniyor...</div><p style="margin-top:12px;color:rgba(255,255,255,0.4)">QR kod olusturuluyor, lutfen bekleyin...</p>';
}
}catch(e){document.getElementById('content').innerHTML='<div class="status disc">Hata: '+e.message+'</div>';}
}
load();
setInterval(load,3000);
</script>
</body></html>`);
});

app.get('/status', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ status: connectionStatus, qr: qrCode, uptime: Math.floor(process.uptime()) });
});

app.post('/send', checkAuth, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ success: false, error: 'phone ve message gerekli' });
    if (connectionStatus !== 'connected' || !sock) return res.status(503).json({ success: false, error: 'WhatsApp bagli degil' });

    let jid = phone.replace(/\s/g, '').replace(/^\+/, '');
    if (jid.startsWith('0')) jid = '90' + jid.substring(1);
    if (!jid.startsWith('90')) jid = '90' + jid;
    jid = jid + '@s.whatsapp.net';

    await sock.sendMessage(jid, { text: message });
    console.log('Mesaj gonderildi: ' + phone);
    res.json({ success: true, phone, jid });
  } catch (err) {
    console.error('Mesaj hatasi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/reconnect', checkAuth, async (req, res) => {
  try {
    if (sock) sock.end();
    connectionStatus = 'disconnected';
    qrCode = null;
    await delay(2000);
    startWhatsApp();
    res.json({ success: true, message: 'Yeniden baglaniliyor' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/logout', checkAuth, async (req, res) => {
  try {
    if (sock) { await sock.logout(); sock.end(); }
    if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true });
    connectionStatus = 'disconnected';
    qrCode = null;
    await delay(2000);
    startWhatsApp();
    res.json({ success: true, message: 'Cikis yapildi' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key');
  res.sendStatus(204);
});

app.listen(PORT, () => {
  console.log('WhatsApp Server Port ' + PORT);
  startWhatsApp();
});
