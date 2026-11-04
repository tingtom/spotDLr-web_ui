// Phone app shell, artwork, and offline music cache. JSON APIs always stay on the network.
const VERSION = 'spotdlr-phone-v42';
const SHELL = `${VERSION}-shell`;
const ART = `${VERSION}-art`;
const MUSIC = 'spotdlr-music'; // stable name: survives SW version bumps so updates never wipe offline songs
const MUSIC_LIMIT = 500; // tracks; oldest evicted first
const HOME = '__HOME_URL__'; // filled in by the server: the home Wi-Fi address, or empty
const APP_SHELL = [
    '/',
    '/static/theme.js?v=fork-5',
    '/static/app.css?v=fork-5',
    '/static/app.js?v=fork-5',
    '/static/manifest.webmanifest',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',
    '/static/icons/apple-touch-icon.png',
];
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>spotDLr</title><body style="font:16px/1.5 system-ui,sans-serif;background:#121212;color:#fff;padding:48px 24px;max-width:440px;margin:auto">
<h1 style="font-size:22px">Can't reach your computer</h1>
<p style="color:#b3b3b3">The spotDLr interface is saved on this phone, but your library and uncached music still come from your computer. Make sure it is on and awake with spotDLr running.
Away from home, check that the Tailscale app is connected on this phone.</p>
<p><a href="/" style="color:#1ed760">Try again</a></p>
${HOME ? `<p style="color:#b3b3b3;margin-top:28px">At home, with Tailscale off? Open spotDLr on your home Wi-Fi instead:<br>
<a href="${HOME}/" style="color:#1ed760">${HOME.replace(/^https?:\/\//, '')}</a><br>(the first time, scan the “Home Wi-Fi only” code in Settings → Phone access on your computer)</p>` : ''}</body>`;

async function trim(cacheName, limit) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
}

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(Promise.all([
        caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('spotdlr-phone-') && ![SHELL, ART].includes(key)).map((key) => caches.delete(key)))),
        self.clients.claim(),
    ]));
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(fetch(request).then((response) => {
            if (response.ok) caches.open(SHELL).then((cache) => cache.put('/', response.clone()));
            return response;
        }).catch(async () => (await caches.match('/')) || new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
        return;
    }

    if (url.pathname.startsWith('/api/art/')) {
        event.respondWith(caches.open(ART).then(async (cache) => {
            const cached = await cache.match(request);
            if (cached) return cached;
            const response = await fetch(request);
            if (response.ok) { await cache.put(request, response.clone()); trim(ART, 150); }
            return response;
        }));
        return;
    }

    if (url.pathname.startsWith('/static/')) {
        event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
            if (response.ok) caches.open(SHELL).then((cache) => cache.put(request, response.clone()));
            return response;
        })));
        return;
    }

    if (url.pathname === '/api/library' || url.pathname.startsWith('/api/preferences/')) {
        // Offline boot: last-known library and prefs when the server is unreachable.
        event.respondWith((async () => {
            const cache = await caches.open(SHELL);
            try {
                const response = await fetch(request);
                if (response.ok) await cache.put(request, response.clone());
                return response;
            } catch {
                const cached = await cache.match(request);
                if (cached) return cached;
                return new Response('null', { status: 504, headers: { 'Content-Type': 'application/json' } });
            }
        })());
        return;
    }

    if (url.pathname.startsWith('/api/stream/')) {
        // Offline music: full downloads are cached; range (seek) requests are
        // sliced out of the cached full file. Uncached + offline just fails
        // and the player skips to the next song.
        event.respondWith((async () => {
            const key = url.pathname + url.search;
            const cache = await caches.open(MUSIC);
            const range = request.headers.get('range');
            if (range) {
                const full = await cache.match(key);
                if (full) {
                    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
                    const buf = await full.arrayBuffer();
                    const start = match ? +match[1] : 0;
                    const end = match && match[2] !== '' ? Math.min(+match[2], buf.byteLength - 1) : buf.byteLength - 1;
                    if (start >= buf.byteLength) return new Response(null, { status: 416 });
                    const type = full.headers.get('Content-Type') || 'audio/mpeg';
                    return new Response(buf.slice(start, end + 1), {
                        status: 206,
                        headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Accept-Ranges': 'bytes' },
                    });
                }
                return fetch(request);
            }
            const cached = await cache.match(key);
            if (cached) return cached;
            try {
                const response = await fetch(request);
                if (response.ok && response.status === 200) {
                    await cache.put(key, response.clone());
                    trim(MUSIC, MUSIC_LIMIT);
                }
                return response;
            } catch {
                return new Response(null, { status: 504 });
            }
        })());
        return;
    }
});
