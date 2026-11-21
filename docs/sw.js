const CACHE='home-finance-v40';
const FILES=[
  './','index.html','style.css?v=40','app.js?v=40','drive-sync.js?v=40','device-pairing.js?v=40','vendor/qr-tools.js','manifest.webmanifest',
  'branding/launch-logo.webp','branding/header-logo.webp','branding/app-icon-32.png',
  'branding/app-icon-180.png','branding/app-icon-192.png','branding/app-icon-512.png'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(key=>key.startsWith('home-finance-v')&&key!==CACHE).map(key=>caches.delete(key))
))));
self.addEventListener('fetch',e=>{
  const request=e.request;
  if(request.method!=='GET'||new URL(request.url).origin!==location.origin)return;
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const url=new URL(request.url);
    const scope=new URL(self.registration.scope);
    const appEntry=request.mode==='navigate'&&
      (url.pathname===scope.pathname||url.pathname===scope.pathname+'index.html');
    return await cache.match(appEntry?'index.html':request)||fetch(request);
  })());
});
