// Service worker do Nexus Study: permite abrir o app sem internet.
// - Arquivos do próprio site: rede primeiro (pega sempre a versão nova), cache se estiver offline.
// - Bibliotecas de CDN e fontes: cache primeiro (não mudam).
// - Firebase (login e banco): nunca passa pelo cache.

const CACHE = 'nexus-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/ui.js',
  './js/app.js',
  './js/cloud.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png'
];

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com'
];

const NEVER_CACHE = [
  'firebaseio.com',
  'googleapis.com/identitytoolkit',
  'securetoken.googleapis.com',
  'firebaseapp.com',
  'accounts.google.com',
  'apis.google.com',
  'lh3.googleusercontent.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NEVER_CACHE.some((h) => url.href.includes(h))) return;

  // Bibliotecas externas: cache primeiro
  if (CDN_HOSTS.includes(url.hostname)) {
    // Firebase SDK é servido por www.gstatic.com/firebasejs — pode ficar em cache (versão fixa)
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Arquivos do próprio site: rede primeiro, cache como reserva
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
  }
});
