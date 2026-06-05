/* Agro Bras Hortifruti — Service Worker
 * Cacheia APENAS o shell estático do app. Dados NUNCA são cacheados:
 * qualquer requisição ao Supabase (ou a qualquer origem externa) passa
 * direto pela rede. App ONLINE-ONLY.
 */
// IMPORTANTE: suba este número sempre que alterar QUALQUER arquivo do shell
// (inclusive js/supabase.js com URL/KEY/PIN), senão o navegador continua
// servindo a versão antiga em cache.
const CACHE = 'agrobras-shell-v14';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/supabase.js',
  './js/pin.js',
  './js/ui.js',
  './js/cupom.js',
  './js/app.js',
  './js/cadastros.js',
  './js/vendas.js',
  './js/compras.js',
  './js/dashboard.js',
  './js/relatorios.js',
  './assets/favicon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo-cupom.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
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
  const url = new URL(req.url);

  // Só lida com GET do nosso próprio domínio. Dados (Supabase / CDN / etc)
  // seguem para a rede sem qualquer cache.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navegação: rede primeiro, cai pro shell em cache se a rede falhar.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Assets do shell: cache primeiro (são versionados pelo nome do cache).
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
