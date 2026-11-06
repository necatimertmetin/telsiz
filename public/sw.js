// Ağ öncelikli: güncelleme hemen gelsin, internet yoksa son kopya açılsın.
const C = 'telsiz-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin) return
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const c = r.clone(); caches.open(C).then(x => x.put(e.request, c)) } return r })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./')))
  )
})
