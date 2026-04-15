const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
let retryCount = 0;
let connectedPhone = '';

async function startWhatsApp() {
  try {
    if (fs.existsSync(AUTH_DIR) && retryCount > 3) {
      fs.rmSync(AUTH_DIR, { recursive: true });
      console.log('Cok fazla hata, session temizlendi');
      retryCount = 0;
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    console.log('Baileys version:', version);

    sock = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: 'silent' }),
      browser: ['Emixhas', 'Chrome', '4.0.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 2000,
      defaultQueryTimeoutMs: undefined,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = await QRCode.toDataURL(qr);
        connectionStatus = 'qr_ready';
        retryCount = 0;
        console.log('QR Kod hazir!');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log('Baglanti koptu. Status:', statusCode, 'Retry:', retryCount);
        connectionStatus = 'disconnected';
        connectedPhone = '';

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true });
          console.log('Session silindi');
          retryCount = 0;
        }

        retryCount++;
        const waitTime = Math.min(retryCount * 3000, 30000);
        await delay(waitTime);
        startWhatsApp();
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        qrCode = null;
        retryCount = 0;
        try { connectedPhone = sock.user?.id?.split(':')[0] || sock.user?.id || ''; } catch(e) { connectedPhone = ''; }
        console.log('WhatsApp baglandi! Numara:', connectedPhone);
      }
    });
  } catch (err) {
    console.error('WhatsApp baslatilamadi:', err.message);
    retryCount++;
    await delay(10000);
    startWhatsApp();
  }
}

function checkAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ success: false, error: 'Gecersiz API Key' });
  next();
}

app.get('/', (req, res) => {
  res.json({ status: connectionStatus, phone: connectedPhone, uptime: Math.floor(process.uptime()), retryCount });
});

app.get('/qr', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp - Emixhas Yazilim</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:white;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}
.logo{font-size:42px;font-weight:900;letter-spacing:-1px;margin-bottom:4px;background:linear-gradient(135deg,#25D366,#128C7E,#075E54);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.logo-sub{font-size:11px;color:rgba(255,255,255,0.25);letter-spacing:4px;text-transform:uppercase;margin-bottom:32px}
.card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:32px;max-width:400px;width:90%;text-align:center}
h2{font-size:20px;margin-bottom:6px}
.desc{font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:20px}
.qr-box{background:white;border-radius:16px;padding:20px;margin-bottom:16px}
.qr-box img{width:100%;max-width:260px}
.badge{display:inline-block;padding:10px 24px;border-radius:12px;font-size:14px;font-weight:700}
.badge-ok{background:#25D366;color:white}
.badge-qr{background:#F07B2E;color:white}
.badge-wait{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5)}
.badge-off{background:#EF4444;color:white}
.phone-info{margin-top:12px;font-size:13px;color:rgba(255,255,255,0.5)}
.phone-num{font-size:18px;font-weight:700;color:#25D366;margin-top:4px}
.btns{display:flex;gap:8px;margin-top:20px;justify-content:center;flex-wrap:wrap}
.btn{padding:10px 20px;border-radius:10px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s}
.btn-reconnect{background:rgba(37,211,102,0.15);color:#25D366}
.btn-reconnect:hover{background:rgba(37,211,102,0.3)}
.btn-change{background:rgba(239,68,68,0.15);color:#EF4444}
.btn-change:hover{background:rgba(239,68,68,0.3)}
.btn-refresh{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5)}
.btn-refresh:hover{background:rgba(255,255,255,0.12)}
.footer{margin-top:40px;font-size:10px;color:rgba(255,255,255,0.15);letter-spacing:1px}
.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<div class="logo">EMIXHAS</div>
<div class="logo-sub">Yazilim & Teknoloji</div>
<div class="card">
<h2>WhatsApp Baglantisi</h2>
<div class="desc">sehirlerarasinakliyat.com</div>
<div id="content"><div class="badge badge-wait">Yukleniyor...</div></div>
<div class="btns">
<button class="btn btn-refresh" onclick="load()">&#x21bb; Yenile</button>
<button class="btn btn-reconnect" onclick="doAction('reconnect')">&#x26A1; Yeniden Baglan</button>
<button class="btn btn-change" onclick="doAction('logout')">&#x2716; Numara Degistir</button>
</div>
</div>
<div class="footer">EMIXHAS YAZILIM &copy; 2026</div>
<script>
const API_KEY='nakliyat2026secret';
async function load(){
try{const r=await fetch('/status');const d=await r.json();const el=document.getElementById('content');
if(d.status==='connected'){
el.innerHTML='<div class="badge badge-ok">&#x2705; WhatsApp Bagli</div>'
+(d.phone?'<div class="phone-info">Bagli Numara<div class="phone-num">+'+d.phone+'</div></div>':'')
+'<div style="margin-top:14px;font-size:12px;color:rgba(255,255,255,0.3)">Mesajlar gonderilebilir durumda</div>';
}else if(d.qr){
el.innerHTML='<div class="qr-box"><img src="'+d.qr+'"/></div><div class="badge badge-qr">QR Kodu Okutun</div><div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.3)">WhatsApp > Bagli Cihazlar > Cihaz Bagla</div>';
}else{
el.innerHTML='<div class="badge badge-wait">Baglanti Bekleniyor... ('+d.retryCount+')</div><div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.25)">QR kod olusturuluyor...</div>';
}}catch(e){document.getElementById('content').innerHTML='<div class="badge badge-off">Hata: '+e.message+'</div>';}}
async function doAction(action){
if(action==='logout'&&!confirm('Mevcut WhatsApp baglantisi kesilecek ve yeni QR olusturulacak. Emin misiniz?'))return;
try{const r=await fetch('/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':API_KEY}});
const d=await r.json();alert(d.success?'Basarili! Sayfa yenilenecek...':'Hata: '+(d.error||'bilinmeyen'));
setTimeout(load,2000);}catch(e){alert('Hata: '+e.message);}}
load();setInterval(load,3000);
</script></body></html>`);
});

app.get('/status', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ status: connectionStatus, qr: qrCode, phone: connectedPhone, uptime: Math.floor(process.uptime()), retryCount });
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
  try { if (sock) sock.end(); connectionStatus = 'disconnected'; qrCode = null; connectedPhone = ''; retryCount = 0; await delay(2000); startWhatsApp(); res.json({ success: true, message: 'Yeniden baglaniliyor' }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/logout', checkAuth, async (req, res) => {
  try { if (sock) { await sock.logout(); sock.end(); } if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true }); connectionStatus = 'disconnected'; qrCode = null; connectedPhone = ''; retryCount = 0; await delay(2000); startWhatsApp(); res.json({ success: true, message: 'Cikis yapildi, yeni QR olusturuluyor' }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.options('*', (req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key'); res.sendStatus(204); });

app.listen(PORT, () => { console.log('WhatsApp Server Port ' + PORT); startWhatsApp(); });
