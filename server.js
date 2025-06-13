require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const geolib = require('geolib');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const TELEGRAM_FILE_API = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}`;

console.log('DATABASE_URL from .env:', process.env.DATABASE_URL);
// Подключение к PostgreSQL
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

db.connect().then(() => {
  console.log('✅ Connected to PostgreSQL');
}).catch(err => {
  console.error('❌ PostgreSQL connection error:', err);
});

// HTTP + WebSocket сервер
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Кеш для avatar_url на 1 час
const avatarCache = new Map(); // telegram_id => { url, expires }

// Получение CDN-ссылки на аватарку из Telegram
async function getTelegramAvatarUrl(telegram_id) {
  const now = Date.now();
  const cached = avatarCache.get(telegram_id);
  if (cached && cached.expires > now) return cached.url;

  try {
    const photosResp = await fetch(`${TELEGRAM_API}/getUserProfilePhotos?user_id=${telegram_id}&limit=1`);
    const photosData = await photosResp.json();
    const photos = photosData.result?.photos;
    if (!photos || !photos.length) return null;

    const file_id = photos[0][photos[0].length - 1].file_id;

    const fileResp = await fetch(`${TELEGRAM_API}/getFile?file_id=${file_id}`);
    const fileData = await fileResp.json();
    const file_path = fileData.result?.file_path;
    if (!file_path) return null;

    const url = `${TELEGRAM_FILE_API}/${file_path}`;
    avatarCache.set(telegram_id, { url, expires: now + 60 * 60 * 1000 });
    return url;
  } catch (e) {
    console.error('❌ Ошибка загрузки аватара:', e.message);
    return null;
  }
}

// 📥 API: Обновить или сохранить профиль
app.post('/api/profile', async (req, res) => {
  const { telegram_id, name, bio, interests, latitude, longitude } = req.body;
  try {
    const avatar_url = await getTelegramAvatarUrl(telegram_id);

    const query = `
      INSERT INTO users (telegram_id, name, interests, bio, avatar_url, latitude, longitude, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (telegram_id) DO UPDATE SET
        name = EXCLUDED.name,
        interests = EXCLUDED.interests,
        bio = EXCLUDED.bio,
        avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        last_seen = CURRENT_TIMESTAMP
    `;
    await db.query(query, [telegram_id, name, interests, bio, avatar_url, latitude, longitude]);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Ошибка при сохранении профиля:', err.message);
    res.status(500).send('Ошибка сохранения');
  }
});

// 📡 API: Получить Nearby пользователей (в радиусе 2 км)
app.get('/api/nearby/:telegram_id', async (req, res) => {
  const { telegram_id } = req.params;

  const userRes = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
  if (!userRes.rows.length) return res.json([]);

  const me = userRes.rows[0];
  const othersRes = await db.query('SELECT * FROM users WHERE telegram_id != $1', [telegram_id]);

  const nearby = await Promise.all(
    othersRes.rows.filter(u => u.latitude && u.longitude).map(async (u) => {
      const distance = geolib.getDistance(
        { latitude: me.latitude, longitude: me.longitude },
        { latitude: u.latitude, longitude: u.longitude }
      );
      if (distance > 2000) return null;

      let avatar_url = u.avatar_url;
      const fresh = await getTelegramAvatarUrl(u.telegram_id);
      if (fresh) avatar_url = fresh;

      return { ...u, avatar_url };
    })
  );

  res.json(nearby.filter(Boolean));
});

// 🛰️ WebSocket
wss.on('connection', (ws) => {
  console.log('📡 WebSocket клиент подключён');
  ws.on('close', () => console.log('❌ WebSocket отключён'));
});

// 🚀 Запуск сервера
server.listen(PORT, () => {
  console.log(`🚀 Peone backend + WS на порту ${PORT}`);
});