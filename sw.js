// ANT — service worker.
// Guarda solo la interfaz (HTML, CSS, JS, íconos, fuente) para que abra rápido y
// sin señal. NUNCA guarda respuestas del servidor: los datos no quedan en caché.
const VERSION = 'ant-v1.0.0';
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './assets/logo.png',
  './assets/fonts/inter-latin-wght-normal.woff2',
  './assets/fonts/inter-latin-ext-wght-normal.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-64.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)));
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', ev => {
  if (ev.data === 'ACTIVAR') self.skipWaiting();
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  const url = new URL(req.url);
  // Solo archivos propios por GET. Las llamadas a Apps Script no se tocan.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Red primero para recibir versiones nuevas; sin red, la copia guardada.
    ev.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  ev.respondWith(caches.match(req).then(r => r || fetch(req)));
});
