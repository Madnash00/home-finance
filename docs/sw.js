const CACHE='home-finance-v37';
const FILES=[
  './','index.html','style.css?v=37','app.js?v=37','manifest.webmanifest',
  'branding/launch-logo.webp','branding/header-logo.webp','branding/app-icon-32.png',
  'branding/app-icon-180.png','branding/app-icon-192.png','branding/app-icon-512.png'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&new URL(e.request.url).origin===location.origin)e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
