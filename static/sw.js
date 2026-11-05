// Phone app shell, artwork, and offline music cache. JSON APIs always stay on the network.
const VERSION = 'spotdlr-phone-v42';
const SHELL = `${VERSION}-shell`;
const ART = `${VERSION}-art`;
const MUSIC = 'spotdlr-music'; // stable name: survives SW version bumps so updates never wipe offline songs
const MUSIC_LIMIT = 20000; // tracks; backstop only — the client's GB budget (spotdlr-config) is the real limit
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

// Every network attempt is time-boxed: a dead DNS resolver (Tailscale down, no signal) must
// never freeze the app — fall through to cache/failure instead of hanging the page. The race
// only covers response headers; bodies stream afterwards without a deadline.
const net = (req, ms = 3000) => Promise.race([
    fetch(req).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
]);

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const winner = await net(request, 4000); // fresh HTML when it answers fast
            if (winner && winner.ok) {
                caches.open(SHELL).then((cache) => cache.put('/', winner.clone()));
                return winner;
            }
            return (await caches.match(request)) || (await caches.match('/'))
                || new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        })());
        return;
    }

    if (url.pathname.startsWith('/api/art/')) {
        event.respondWith((async () => {
            const cache = await caches.open(ART);
            const cached = await cache.match(request);
            if (cached) return cached;
            const response = await net(request);
            if (!response) return new Response('', { status: 504 });
            if (response.ok) { await cache.put(request, response.clone()); trim(ART, 150); }
            return response;
        })());
        return;
    }

    if (url.pathname.startsWith('/static/')) {
        event.respondWith((async () => {
            const cached = await caches.match(request);
            if (cached) return cached;
            const response = await net(request);
            if (response) {
                if (response.ok) caches.open(SHELL).then((cache) => cache.put(request, response.clone()));
                return response;
            }
            return (await caches.match(request)) || new Response('', { status: 503 });
        })());
        return;
    }

    if (url.pathname === '/api/library' || url.pathname === '/api/status/init' || url.pathname.startsWith('/api/preferences/')) {
        // Offline boot: last-known library and prefs when the server is unreachable.
        event.respondWith((async () => {
            const cache = await caches.open(SHELL);
            const response = await net(request);
            if (response) {
                if (response.ok) await cache.put(request, response.clone());
                return response;
            }
            const cached = await cache.match(request);
            if (cached) return cached;
            return new Response('null', { status: 504, headers: { 'Content-Type': 'application/json' } });
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
                return (await net(request)) || new Response(null, { status: 504 });
            }
            const cached = await cache.match(key);
            if (cached) return cached;
            const response = await net(request);
            if (!response) return new Response(null, { status: 504 });
            if (response.ok && response.status === 200) {
                let allow = true;
                try { // honour the user's offline storage budget before storing
                    const cfg = await caches.match('/offline-limit', { cacheName: 'spotdlr-config' });
                    const gb = cfg ? parseFloat(await cfg.text()) : NaN;
                    if (isFinite(gb)) {
                        const est = await navigator.storage.estimate();
                        if (est && est.usage >= gb * 1024 ** 3) allow = false;
                    }
                } catch { /* no known budget: quota errors are handled below */ }
                if (allow) {
                    try {
                        await cache.put(key, response.clone());
                        trim(MUSIC, MUSIC_LIMIT);
                    } catch { /* storage quota: the song plays, it just isn't kept */ }
                }
            }
            return response;
        })());
        return;
    }
});
