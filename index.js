const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'nakliyat2026secret';
const AUTH_DIR = path.join(__dirname, 'auth_info');

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let lastQRTime = 0;

// ============================================================
// WhatsApp Bağlantısı
// ============================================================
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['sehirlerarasinakliyat', 'Chrome', '120.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 30000,
    retryRequestDelayMs: 500,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = await QRCode.toDataURL(qr);
      lastQRTime = Date.now();
      connectionStatus = 'qr_ready';
      console.log('📱 QR Kod hazır — /qr adresinden okutun');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Bağlantı koptu:', statusCode, shouldReconnect ? '→ Yeniden bağlanıyor...' : '→ Çıkış yapıldı');
      connectionStatus = 'disconnected';
      qrCode = null;

      if (statusCode === DisconnectReason.loggedOut) {
        // Session temizle
        if (fs.existsSync(AUTH_DIR)) {
          fs.rmSync(AUTH_DIR, { recursive: true });
        }
        console.log('🗑️ Session silindi, yeniden QR okutun');
      }

      if (shouldReconnect) {
        await delay(3000);
        startWhatsApp();
      }
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      qrCode = null;
      console.log('✅ WhatsApp bağlandı!');
    }
  });
}

// ============================================================
// API KEY kontrolü
// ============================================================
function checkAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Geçersiz API Key' });
  }
  next();
}

// ============================================================
// ROUTES
// ============================================================

// Ana sayfa — durum bilgisi
app.get('/', (req, res) => {
  res.json({
    status: connectionStatus,
    uptime: Math.floor(process.uptime()),
    message: connectionStatus === 'connected' ? 'WhatsApp bağlı ✅' : 'WhatsApp bağlı değil',
  });
});

// QR Kod sayfası (admin panelinden iframe ile açılır)
app.get('/qr', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp QR — Emixhas Yazılım</title>
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
  .status.connected{background:#25D366;color:white}
  .status.waiting{background:#F07B2E;color:white}
  .status.disconnected{background:#EF4444;color:white}
  .refresh-btn{margin-top:16px;background:rgba(255,255,255,0.1);color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px}
  .footer{margin-top:32px;font-size:11px;color:rgba(255,255,255,0.2)}
</style>
</head><body>
<div class="container" id="app">
  <div class="brand">Emixhas Yazılım</div>
  <h1>📱 WhatsApp Bağlantısı</h1>
  <p>sehirlerarasinakliyat.com</p>
  <div id="content">Yükleniyor...</div>
  <button class="refresh-btn" onclick="loadStatus()">🔄 Yenile</button>
  <div class="footer">Powered by Emixhas Yazılım</div>
</div>
</div>
<script>
async function loadStatus() {
  try {
    const r = await fetch('/status');
    const d = await r.json();
    const el = document.getElementById('content');
    if (d.status === 'connected') {
      el.innerHTML = '<div class="status connected">✅ WhatsApp Bağlı</div><p style="margin-top:16px;color:rgba(255,255,255,0.5)">Mesajlar gönderilebilir durumda</p>';
    } else if (d.qr) {
      el.innerHTML = '<div class="qr-box"><img src="'+d.qr+'"/></div><div class="status waiting">📱 QR Kodu WhatsApp ile Okutun</div><p style="margin-top:12px;color:rgba(255,255,255,0.4)">WhatsApp → Bağlı Cihazlar → Cihaz Bağla</p>';
    } else {
      el.innerHTML = '<div class="status disconnected">❌ Bağlantı Yok</div><p style="margin-top:12px;color:rgba(255,255,255,0.4)">Bağlantı bekleniyor...</p>';
    }
  } catch(e) { document.getElementById('content').innerHTML = '<div class="status disconnected">Hata: '+e.message+'</div>'; }
}
loadStatus();
setInterval(loadStatus, 3000);
</script>
</body></html>`);
});

// Durum API (CORS açık)
app.get('/status', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    status: connectionStatus,
    qr: qrCode,
    uptime: Math.floor(process.uptime()),
  });
});

// ============================================================
// MESAJ GÖNDER — Ana API
// ============================================================
app.post('/send', checkAuth, async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ success: false, error: 'phone ve message gerekli' });
    }

    if (connectionStatus !== 'connected' || !sock) {
      return res.status(503).json({ success: false, error: 'WhatsApp bağlı değil' });
    }

    // Telefon numarası formatı: 905XXXXXXXXX
    let jid = phone.replace(/\s/g, '').replace(/^\+/, '');
    if (jid.startsWith('0')) jid = '90' + jid.substring(1);
    if (!jid.startsWith('90')) jid = '90' + jid;
    jid = jid + '@s.whatsapp.net';

    // Numara WhatsApp'ta var mı kontrol et
    const [result] = await sock.onWhatsApp(jid.replace('@s.whatsapp.net', ''));
    if (!result?.exists) {
      return res.json({ success: false, error: 'Bu numara WhatsApp kullanmıyor' });
    }

    await sock.sendMessage(jid, { text: message });

    console.log(`✅ Mesaj gönderildi → ${phone}`);
    res.json({ success: true, phone, jid });
  } catch (err) {
    console.error('❌ Mesaj hatası:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bağlantıyı kes + yeniden bağlan
app.post('/reconnect', checkAuth, async (req, res) => {
  try {
    if (sock) sock.end();
    connectionStatus = 'disconnected';
    qrCode = null;
    await delay(2000);
    startWhatsApp();
    res.json({ success: true, message: 'Yeniden bağlanıyor...' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Session sıfırla (yeni QR gerekir)
app.post('/logout', checkAuth, async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
      sock.end();
    }
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true });
    }
    connectionStatus = 'disconnected';
    qrCode = null;
    await delay(2000);
    startWhatsApp();
    res.json({ success: true, message: 'Çıkış yapıldı, yeni QR oluşturuluyor...' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// CORS
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key');
  res.sendStatus(204);
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Server — Port ${PORT}`);
  startWhatsApp();
});
