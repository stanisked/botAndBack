const form = document.getElementById('profileForm');
const status = document.getElementById('status');
const nearbyList = document.getElementById('nearby-list');

let latitude = null;
let longitude = null;

let telegram_id = 123456;
if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
  telegram_id = window.Telegram.WebApp.initDataUnsafe.user.id;
}

// Получение геолокации
navigator.geolocation.getCurrentPosition(
  (pos) => {
    latitude = pos.coords.latitude;
    longitude = pos.coords.longitude;
    status.textContent = '📍 Геолокация получена';
  },
  () => {
    status.textContent = '❌ Не удалось получить геолокацию';
  }
);

// Обработка формы профиля
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!telegram_id) {
    alert("❌ Не удалось получить Telegram ID. Открой Mini App через Telegram.");
    return;
  }

  const name = document.getElementById('name').value;
  const interests = document.getElementById('interests').value;
  const bio = document.getElementById('bio').value;

  const data = {
    telegram_id,
    name,
    interests,
    bio,
    latitude,
    longitude,
  };

  // 🚀 Сохраняем профиль
  try {
    const res = await fetch('https://fastidious-haupia-58b732.netlify.app/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    status.textContent = res.ok ? '✅ Профиль сохранён!' : '❌ Ошибка при сохранении';
  } catch (err) {
    status.textContent = '🚫 Не удалось подключиться к серверу';
  }
});

document.getElementById('find-nearby-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = '📍 Определяем ваше местоположение...';

  if (!navigator.geolocation) {
    alert('Геолокация не поддерживается');
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const telegram_id = window.Telegram.WebApp.initDataUnsafe?.user?.id;

    try {
      // Обновим профиль с координатами
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id, latitude, longitude })
      });

      // Запросим соседей
      const res = await fetch(`/api/nearby/${telegram_id}`);
      const users = await res.json();

      renderNearby(users);
      statusEl.textContent = '';
    } catch (err) {
      console.error(err);
      statusEl.textContent = '❌ Ошибка при загрузке соседей';
    }
  });
});

function renderNearby(users) {
  const container = document.getElementById('nearby-list');
  container.innerHTML = '';

  if (users.length === 0) {
    container.textContent = 'Никого рядом не найдено 😕';
    return;
  }

  users.forEach(user => {
    const card = document.createElement('div');
    card.className = 'user-card';

    card.innerHTML = `
      <img src="${getAvatar(user)}" alt="Аватар" class="avatar">
      <div>
        <strong>${user.name || 'Без имени'}</strong><br>
        <small>${user.interests || 'Без интересов'}</small><br>
        <small>⏱️ Онлайн: ${formatLastSeen(user.last_seen)}</small>
      </div>
    `;
    container.appendChild(card);
  });
}

function getAvatar(user) {
  if (user.avatar_url?.startsWith('http')) return user.avatar_url;
  return 'https://via.placeholder.com/50';
}

function formatLastSeen(ts) {
  const date = new Date(ts);
  return date.toLocaleString();
}
