'use strict';
/* spotDLr frontend: library, player, Spotify search and downloads. No framework, no build step. */

// ---------- tiny helpers ----------

// html`` escapes every interpolated value unless it is already Safe (another html`` result or icon()).
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);
// false renders as '' (handy for ${cond && html`…`}), so boolean attributes need String(): aria-pressed="${String(on)}"
const toHtml = (v) => v instanceof Safe ? v.s : Array.isArray(v) ? v.map(toHtml).join('') : (v === null || v === undefined || v === false) ? '' : esc(v);
function html(strings, ...values) {
    let out = strings[0];
    values.forEach((v, i) => { out += toHtml(v) + strings[i + 1]; });
    return new Safe(out);
}
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function api(path, options = {}) {
    const response = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
}

window.addEventListener('error', (e) => { try { toast(`Error: ${(e.message || e.error || 'unknown').toString().slice(0, 160)}`, 'error'); } catch {} });
window.addEventListener('unhandledrejection', (e) => { try { toast(`Error: ${String((e.reason && e.reason.message) || e.reason || 'unknown').slice(0, 160)}`, 'error'); } catch {} });

let preferenceSyncTimer;
function syncClientPreferences() {
    clearTimeout(preferenceSyncTimer);
    preferenceSyncTimer = setTimeout(() => {
        const values = {};
        for (let index = 0; index < localStorage.length; index += 1) {
            const fullKey = localStorage.key(index);
            if (!fullKey?.startsWith('spotdlr.') || fullKey === 'spotdlr.preferencesRestored') continue;
            try { values[fullKey.slice(8)] = JSON.parse(localStorage.getItem(fullKey)); } catch { /* skip corrupt values */ }
        }
        fetch('/api/preferences/client', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
            .catch(() => {});
    }, 150);
}

const store = {
    get(key, fallback) { try { const v = localStorage.getItem('spotdlr.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('spotdlr.' + key, JSON.stringify(value)); syncClientPreferences(); } catch { /* private mode */ } },
};

// ---------- icons (24×24) ----------

const ICONS = {
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    play: '<path fill="currentColor" stroke="none" d="M7.05 3.6A1 1 0 0 0 5.5 4.44v15.12a1 1 0 0 0 1.55.84l11.68-7.56a1 1 0 0 0 0-1.68z"/>',
    pause: '<rect fill="currentColor" stroke="none" x="5.5" y="3.5" width="4.5" height="17" rx="1.2"/><rect fill="currentColor" stroke="none" x="14" y="3.5" width="4.5" height="17" rx="1.2"/>',
    next: '<path fill="currentColor" stroke="none" d="M4.5 4.9v14.2a.9.9 0 0 0 1.4.75l10.2-7.1a.9.9 0 0 0 0-1.5L5.9 4.15a.9.9 0 0 0-1.4.75z"/><rect fill="currentColor" stroke="none" x="17.3" y="4" width="2.4" height="16" rx="1"/>',
    prev: '<path fill="currentColor" stroke="none" d="M19.5 4.9v14.2a.9.9 0 0 1-1.4.75L7.9 12.75a.9.9 0 0 1 0-1.5l10.2-7.1a.9.9 0 0 1 1.4.75z"/><rect fill="currentColor" stroke="none" x="4.3" y="4" width="2.4" height="16" rx="1"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    repeatOne: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>',
    volume: '<path d="M11 4.7 6.3 8.5H3v7h3.3l4.7 3.8z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.6 5.4a9.5 9.5 0 0 1 0 13.2"/>',
    volumeLow: '<path d="M11 4.7 6.3 8.5H3v7h3.3l4.7 3.8z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    mute: '<path d="M11 4.7 6.3 8.5H3v7h3.3l4.7 3.8z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.6-4.6"/>',
    spotify: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M6.5 9c3.8-1.3 7.6-.9 11 1M7.2 12c3.3-1.1 6.8-.7 9.6.9M8 15c2.5-.8 5.1-.5 7.4.7" stroke="var(--panel)" stroke-width="1.5"/>',
    home: '<path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z"/>',
    library: '<path d="M4 3.5v17"/><path d="M9 3.5v17"/><path d="m13.6 4.3 6 16.2"/>',
    sidebarCollapse: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m7-11-3 3 3 3"/>',
    sidebarExpand: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m4-11 3 3-3 3"/>',
    download: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v9"/><path d="m8.2 12.4 3.8 3.8 3.8-3.8"/>',
    downloadPlain: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20.5h14"/>',
    check: '<circle fill="currentColor" stroke="none" cx="12" cy="12" r="10"/><path stroke="#000" stroke-width="2.4" d="m7.5 12.3 3 3 6-6.3"/>',
    clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    wave: '<path d="M2 12h3l3-7 4 14 4-10 2 3h4"/>',
    bars: '<path d="M4 20v-6"/><path d="M9 20V8"/><path d="M14 20V4"/><path d="M19 20v-9"/>',
    ring: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="m4.9 19.1 2.1-2.1"/><path d="m17 7 2.1-2.1"/>',
    sparkle: '<circle cx="5" cy="6" r="1.5"/><circle cx="17" cy="4" r="1"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="15" r="1.5"/><circle cx="6" cy="18" r="1"/>',
    vinyl: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/>',
    sun: '<path d="M7 13a5 5 0 0 1 10 0"/><path d="M3 17h18"/><path d="M6 21h12"/><path d="M12 3v3"/><path d="m5 7 1.5 1.5"/><path d="m19 7-1.5 1.5"/>',
    cassette: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><circle cx="16" cy="11" r="2"/><path d="M10 11h4"/><path d="m6.5 19 1.5-3h8l1.5 3"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3.5"/>',
    heart: '<path d="M12 20.3 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8z"/>',
    heartFilled: '<path fill="currentColor" stroke="none" d="M12 20.3 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8z"/>',
    more: '<circle fill="currentColor" stroke="none" cx="5" cy="12" r="1.8"/><circle fill="currentColor" stroke="none" cx="12" cy="12" r="1.8"/><circle fill="currentColor" stroke="none" cx="19" cy="12" r="1.8"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 20.5h14"/>',
    usb: '<rect x="7" y="9" width="10" height="12.5" rx="2"/><path d="M9.5 9V3h5v6"/><path d="M11 5.5h.01"/><path d="M13 5.5h.01"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13.5h9l1-13.5"/>',
    listAdd: '<path d="M4 6h11"/><path d="M4 12h11"/><path d="M4 18h7"/><path d="M18 14v7"/><path d="M14.5 17.5h7"/>',
    ear: '<path d="M6 8.5a6 6 0 1 1 12 0c0 3.5-3 4.5-3 7.5a3.5 3.5 0 0 1-6.5 1.8"/><path d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.5-1.5 2-1.5 3.5"/>',
    apple: '<path d="M12 7.5c0-2 1.4-3.6 3.3-4"/><path d="M8 7.2c-2.8 0-4.5 2.3-4.5 5.4 0 4 2.6 8.4 4.8 8.4 1 0 1.6-.6 3.7-.6s2.7.6 3.7.6c2.2 0 4.8-4.4 4.8-8.4 0-3.1-1.7-5.4-4.5-5.4-1.6 0-2.6.8-4 .8s-2.4-.8-4-.8z"/>',
    checkPlain: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    queue: '<path d="M3 5h12"/><path d="M3 10h12"/><path d="M3 15h7"/><path d="M14 13.5v7l5.5-3.5z" fill="currentColor"/>',
    playNext: '<path d="M3 6h9"/><path d="M3 11h9"/><path d="M3 16h5"/><path d="m14 9 6 4.5-6 4.5z" fill="currentColor"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    grip: '<circle fill="currentColor" stroke="none" cx="9" cy="6" r="1.4"/><circle fill="currentColor" stroke="none" cx="15" cy="6" r="1.4"/><circle fill="currentColor" stroke="none" cx="9" cy="12" r="1.4"/><circle fill="currentColor" stroke="none" cx="15" cy="12" r="1.4"/><circle fill="currentColor" stroke="none" cx="9" cy="18" r="1.4"/><circle fill="currentColor" stroke="none" cx="15" cy="18" r="1.4"/>',
    viewList: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
    viewGrid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    off: '<circle cx="12" cy="12" r="9.5"/><path d="m5.3 5.3 13.4 13.4"/>',
    fullscreen: '<path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/>',
    shrink: '<path d="M9 4v5H4"/><path d="M20 9h-5V4"/><path d="M15 20v-5h5"/><path d="M4 15h5v5"/>',
    expand: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/>',
    forward: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    settings: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1.5 14h5"/><path d="M9.5 8h5"/><path d="M17.5 16h5"/>',
    note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    user: '<circle cx="12" cy="8" r="4.5"/><path d="M3.5 21a8.5 8.5 0 0 1 17 0"/>',
    disc: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="2.5"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.2-8.56"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    speaker: '<path fill="currentColor" stroke="none" d="M11 4.7 6.3 8.5H3v7h3.3l4.7 3.8z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10 18.5h4"/>',
    computer: '<rect x="2.5" y="3.5" width="19" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17.5V21"/>',
    warn: '<path d="M12 3 2 20.5h20z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
    chart: '<path d="M3 20.5h18"/><path d="M6 17V11"/><path d="M11 17V5"/><path d="M16 17v-8"/><path d="M21 17v-4"/>',
    spotDLr: '<path fill="currentColor" stroke="none" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v6.6l2.3-2.3 1.4 1.4L12 17.4l-4.7-4.7 1.4-1.4 2.3 2.3z"/>',
};
const icon = (name, size = 16, cls = '') => new Safe(
    `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
);
const eq = () => html`<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>`;

// ---------- formatting ----------

const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function fmtLong(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    if (h) return `about ${h} hr ${m} min`;
    return m ? `${m} min ${s} sec` : `${s} sec`;
}
function fmtAdded(ts) {
    const days = (Date.now() / 1000 - ts) / 86400;
    if (days < 1) return 'Today';
    if (days < 2) return 'Yesterday';
    if (days < 7) return `${Math.floor(days)} days ago`;
    if (days < 28) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
    return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

// ---------- state ----------

const S = {
    tracks: [],
    collections: [],
    byId: new Map(),
    bySpotifyId: new Map(),
    byVideoId: new Map(),
    byTitleArtist: new Map(),
    artists: [],            // derived from tags: [{ name, trackIds, coverId }]
    genres: [],             // derived from track.genre: [{ name, trackIds, coverIds }]
    liked: new Set(),       // track ids you liked (♥)
    likedOrder: [],         // the same, newest like first
    genrePending: 0,
    jobs: [],
    init: { initialized: true },
    libFilter: store.get('libFilter', 'all'),
    libSort: store.get('libSort', 'recents'),
    trackView: store.get('trackView', 'list'), // song tables as a 'list' or a 'grid' of covers
    songsView: { q: '', genre: null, sort: store.get('songsSort', 'added'), dir: store.get('songsDir', 'desc') }, // All songs: search, filter, sort
    recent: store.get('recentContexts', {}), // context key (as on the sidebar items) -> when it was last played
    libQuery: '',
    settings: { format: 'm4a', bitrate: 'auto', lyrics: false, ...store.get('settings', {}) },
    spotifyCache: new Map(), // "kind/id" or "search/q" -> { time, data }
};

const artUrl = (trackId) => `/api/art/${encodeURIComponent(trackId)}`;
const artistHref = (name) => `#/artist/${encodeURIComponent(name)}`;
// "feat."/"with" credits are dropped so "Bad Haircut (feat. JVKE)" matches "Bad Haircut"; other parentheses
// stay, so "golden hour (piano version)" doesn't match "golden hour"
const songKey = (title, artist) => `${String(title || '').toLowerCase().replace(/\s*[([](feat|ft|with)\b[^)\]]*[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, '')}|${String(artist || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}`;
// Remote track → local id: exact id first (Spotify or YouTube), then title + main artist
const owned = (t) => (t.source === 'ytm' ? S.byVideoId.get(t.id) : S.bySpotifyId.get(t.id))
    || S.byTitleArtist.get(songKey(t.name, t.artists[0] && t.artists[0].name)) || null;
const remoteHref = (item, kind) => `#/${item.source || 'spotify'}/${kind}/${encodeURIComponent(item.id)}`;

async function loadLibrary() {
    const data = await api('/library');
    S.tracks = data.tracks;
    S.collections = data.collections;
    S.likedOrder = (data.liked || []).filter((id) => data.tracks.some((t) => t.id === id));
    S.liked = new Set(S.likedOrder);
    S.byId = new Map(S.tracks.map((t) => [t.id, t]));
    S.bySpotifyId = new Map();
    S.byVideoId = new Map();
    S.byTitleArtist = new Map();
    for (const t of S.tracks) {
        if (t.spotify_id && !S.bySpotifyId.has(t.spotify_id)) S.bySpotifyId.set(t.spotify_id, t.id);
        if (t.youtube_id && !S.byVideoId.has(t.youtube_id)) S.byVideoId.set(t.youtube_id, t.id);
        const key = songKey(t.title, t.artists[0]);
        if (!S.byTitleArtist.has(key)) S.byTitleArtist.set(key, t.id);
    }
    const artists = new Map();
    for (const t of S.tracks) {
        for (const name of t.artists) {
            if (!artists.has(name)) artists.set(name, { name, trackIds: [], coverId: null });
            const a = artists.get(name);
            a.trackIds.push(t.id);
            if (!a.coverId && t.has_cover) a.coverId = t.id;
        }
    }
    S.artists = [...artists.values()].sort((a, b) => b.trackIds.length - a.trackIds.length || a.name.localeCompare(b.name));
    const genres = new Map();
    for (const t of S.tracks) {
        if (!t.genre) continue;
        if (!genres.has(t.genre)) genres.set(t.genre, { name: t.genre, trackIds: [], coverIds: [], albums: new Set() });
        const g = genres.get(t.genre);
        g.trackIds.push(t.id);
        if (t.has_cover && g.coverIds.length < 4 && !g.albums.has(t.album)) { g.coverIds.push(t.id); g.albums.add(t.album); }
    }
    S.genres = [...genres.values()].sort((a, b) => b.trackIds.length - a.trackIds.length || a.name.localeCompare(b.name));
    renderSidebar();
}

// ---------- art ----------

function trackArt(track, cls = '') {
    if (track && track.has_cover) return html`<div class="art ${cls}"><img src="${artUrl(track.id)}" alt="" loading="lazy" decoding="async"></div>`;
    return html`<div class="art ${cls}">${icon('note', 20)}</div>`;
}
// Remote covers go through /api/img: cached on disk and fetched politely, because Google's
// image host answers bursts (a search page = 30-40 covers) with HTTP 429
const proxied = (url) => /^https:\/\//.test(url || '') ? `/api/img?u=${encodeURIComponent(url)}` : url;

function imageArt(url, cls = '', fallbackIcon = 'note') {
    url = proxied(url);
    // No crossorigin here: i.ytimg.com sends no CORS headers, so it would block the image.
    // applyHeroColor samples colour from its own separate request instead.
    if (url) return html`<div class="art ${cls}"><img src="${url}" alt="" loading="lazy" decoding="async"></div>`;
    return html`<div class="art ${cls}">${icon(fallbackIcon, 24)}</div>`;
}
function collectionArt(c, cls = '') {
    const ids = c.cover_ids;
    if (ids.length >= 4) {
        return html`<div class="art mosaic ${cls}">${ids.slice(0, 4).map((id) => html`<img src="${artUrl(id)}" alt="" loading="lazy">`)}</div>`;
    }
    return ids.length ? trackArt(S.byId.get(ids[0]), cls) : html`<div class="art ${cls}">${icon('note', 24)}</div>`;
}
const likedArt = (cls = '') => html`<div class="art liked-songs ${cls}">${icon('heartFilled', 24)}</div>`;
const allSongsArt = (cls = '') => html`<div class="art all-songs ${cls}">${icon('note', 24)}</div>`;
function artistArt(a, cls = '') {
    return a.coverId ? html`<div class="art round ${cls}"><img src="${artUrl(a.coverId)}" alt="" loading="lazy"></div>` : html`<div class="art round ${cls}">${icon('user', 24)}</div>`;
}

// Average colour of an image, darkened a little so white text stays readable. Resolves to null when
// it can't be read. Only same-origin images work (our /api/art and /api/img), since it reads pixels.
const coverColors = new Map(); // url -> Promise<colour | null>
function coverColor(imgUrl) {
    if (!imgUrl) return Promise.resolve(null);
    if (!coverColors.has(imgUrl)) {
        coverColors.set(imgUrl, new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onerror = () => resolve(null);
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = 12;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 12, 12);
                    const px = ctx.getImageData(0, 0, 12, 12).data;
                    let r = 0, g = 0, b = 0, n = 0;
                    for (let i = 0; i < px.length; i += 4) {
                        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                        if (lum < 18 || lum > 240) continue; // ignore near-black/white borders
                        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
                    }
                    if (!n) return resolve(null);
                    const scale = Math.min(1, 150 / Math.max(r / n, g / n, b / n));
                    resolve(`rgb(${Math.round(r / n * scale)}, ${Math.round(g / n * scale)}, ${Math.round(b / n * scale)})`);
                } catch { resolve(null); }
            };
            img.src = imgUrl;
        }));
    }
    return coverColors.get(imgUrl);
}

function applyHeroColor(imgUrl) {
    const view = $('#view');
    view.dataset.heroSrc = imgUrl || '';
    view.style.setProperty('--hero', '#535353');
    coverColor(imgUrl).then((color) => {
        if (color && view.dataset.heroSrc === imgUrl) view.style.setProperty('--hero', color);
    });
}

// ---------- player ----------

const P = {
    audio: new Audio(),
    queue: [],           // local track ids in context order
    order: [],           // play order (indexes into queue), shuffled when shuffle is on
    pos: -1,             // position in order
    context: null,       // { key, label, href }
    upNext: [],          // "Next in queue": songs you added, played before the rest of the context
    queued: null,        // id of the song playing now when it came from upNext (P.pos then stays on the context song before it)
    shuffle: store.get('shuffle', false),
    repeat: store.get('repeat', 'off'), // off | all | one
    seeking: false,
};
P.audio.preload = 'auto';

const R = {
    mode: ['local', 'listen', 'remote'].includes(store.get('playbackDevice', 'local')) ? store.get('playbackDevice', 'local') : 'local',
    online: false,
    source: null,
    state: null,
    timer: 0,
    publishing: false,
};
const remoteActive = () => !!S.init.on_phone && R.mode === 'remote';
const playbackIsPlaying = () => remoteActive() ? !!R.state?.playing : (!P.audio.paused && !!currentTrack());

function remoteCommand(action, value = null) {
    if (!remoteActive()) return false;
    api('/remote/command', { method: 'POST', body: JSON.stringify({ action, value }) })
        .then(() => { clearTimeout(R.timer); R.timer = setTimeout(remoteSyncTick, 100); })
        .catch((error) => toast(error.message, 'error'));
    return true;
}

// iPhone/iPad Safari (and every iOS browser, which are all Safari inside) has two rules that matter here:
// - it suspends Web Audio when the screen locks, so music routed through it (for the visualizer) goes silent;
// - audio.volume is read-only (always 1): pages can't turn music down, only the phone's buttons can.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const VOLUME_WORKS = (() => { const probe = new Audio(); probe.volume = 0.5; return probe.volume === 0.5; })();

// ---------- volume: yours × the song's loudness adjustment × crossfade × sleep-timer fade ----------
// Everything that changes loudness goes through applyVolume(), so they never fight over audio.volume.
const PB = { // playback settings (Settings → Playback)
    normalize: store.get('normalize', false), // "Even out volume"
    crossfade: store.get('crossfade', 0),     // seconds, 0 = off
};
P.userVolume = store.get('volume', 0.8);
P.trackGain = 1;   // < 1 turns a loud song down to TARGET_LUFS ("Even out volume")
P.fadeIn = 1;      // crossfade: the incoming song's share
P.sleepGain = 1;   // sleep timer: fades out over its last 10 s
P.wakeGain = 1;    // a scheduled play's fade-in
P.balance = store.get('balance', 0); // -1 left only … 0 both … 1 right only: Settings → Sound and the Hi-Fi Deck's knob (needs Web Audio, see applySound)
const XF = { el: new Audio(), active: false, prepared: null, ready: null, out: 1, outGain: 1, timer: null, switching: false };
XF.el.preload = 'auto';
// The two <audio> elements can swap roles: the spare loads the next song ahead (readyNext) and becomes P.audio when
// that song starts. So the player's listeners go on both and only act for whichever is P.audio at the time.
function onPlayer(type, fn) {
    for (const el of [P.audio, XF.el]) el.addEventListener(type, (e) => { if (e.currentTarget === P.audio) fn(e); });
}

// Holden's idea: 10 s before a song ends, the spare player loads the next one, so it starts the moment this one
// ends instead of after a trip to the computer. Measured on a slow phone connection (120 ms, 8 Mbit/s): 312–319 ms of
// silence between songs. Not with crossfade on: the spare plays the outgoing song's tail then, and the fade hides
// the load. iPhone Safari may not buffer a player that isn't playing; then the swap just loads at play, as before.
const READY_AHEAD = 10;
function readyNext() {
    // Never on iPhone/iPad (any browser there is WebKit): with the screen locked iOS only lets the element that was
    // already playing carry on, so the swapped-in one stayed silent until the page was opened (Holden, Oct 31)
    if (IOS) return;
    if (XF.active || XF.prepared || XF.ready || P.audio.paused || P.repeat === 'one' || SL.endOfSong) return;
    if (VOLUME_WORKS && PB.crossfade) return;
    const left = P.audio.duration - P.audio.currentTime;
    if (!(left <= READY_AHEAD)) return; // also false while the duration is unknown (NaN)
    const t = neighbour(1);
    if (!t) return;
    XF.ready = t.id;
    XF.el.src = `/api/stream/${encodeURIComponent(t.id)}`;
}
// At a song change: if the spare holds exactly this song, it becomes the player (true). Anything else it holds is
// dropped: the queue changed, or you went back.
// After a swap: the player feeds the analyser, meters and volume; the spare, the crossfade's gain
function wirePlayers() {
    if (!V.sources) return; // tap mode: both players are permanently tapped, nothing to rewire (iPhone: synthetic, nothing to rewire)
    for (const source of V.sources.values()) source.disconnect();
    V.sources.get(P.audio).connect(V.analyser);
    V.sources.get(XF.el).connect(xfVolume);
}
function unswapPlayers(t) {
    [P.audio, XF.el] = [XF.el, P.audio];
    XF.el.pause();
    XF.el.removeAttribute('src');
    XF.el.load();
    wirePlayers();
    applyVolume();
    P.audio.src = `/api/stream/${encodeURIComponent(t.id)}`;
}
function takeReadyPlayer(id) {
    const ready = XF.ready;
    XF.ready = null;
    if (!ready) return false;
    if (ready !== id || XF.active || XF.el.error) { XF.el.removeAttribute('src'); XF.el.load(); return false; } // a failed load: load it the usual way
    const old = P.audio;
    [P.audio, XF.el] = [XF.el, old];
    P.audio.muted = old.muted;
    old.pause();
    old.removeAttribute('src');
    old.load();
    wirePlayers();
    return true;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Progress bars fill by sliding a full-width bar in from the left (a transform, so no layout on each update)
const setProgress = (el, fraction) => el.style.setProperty('--p', clamp01(fraction || 0));
let graphVolume = null; // a GainNode once the music goes through Web Audio (ensureAudioGraph)
let xfVolume = null;    // the same for the crossfade's second player
function applyVolume() {
    const level = clamp01(P.userVolume * P.trackGain * P.fadeIn * P.sleepGain * P.wakeGain);
    const xfLevel = clamp01(P.userVolume * XF.outGain * XF.out * P.sleepGain);
    if (graphVolume) {
        // Routed through Web Audio (a visualizer or a sound effect), WebKit (the Mac app, Safari) ignores
        // audio.volume: measured, 20% sounded exactly like 100%. So the levels go on gain nodes instead,
        // after the analyser (the bars don't shrink with the volume), and the elements stay at full volume.
        const now = graphVolume.context.currentTime;
        P.audio.volume = XF.el.volume = 1;
        graphVolume.gain.setTargetAtTime(P.audio.muted ? 0 : level, now, 0.015); // 15 ms: no clicks
        xfVolume.gain.setTargetAtTime(P.audio.muted ? 0 : xfLevel, now, 0.015);
    } else {
        P.audio.volume = level;
        XF.el.volume = xfLevel;
    }
    XF.el.muted = P.audio.muted;
}
applyVolume();

// Loudness (LUFS) per song from /api/loudness, measured by FFmpeg on the server and cached there
const TARGET_LUFS = -14; // what Spotify and YouTube normalize to
const LOUD = new Map();  // track id -> {lufs, peak} | Promise
function loudnessOf(id) {
    if (!LOUD.has(id)) LOUD.set(id, api(`/loudness/${encodeURIComponent(id)}`).then((r) => { LOUD.set(id, r); return r; }).catch(() => { LOUD.delete(id); return null; }));
    const v = LOUD.get(id);
    return v instanceof Promise ? v : Promise.resolve(v);
}
const gainFor = (r) => (r && r.lufs !== null && r.lufs !== undefined) ? 10 ** (Math.min(0, TARGET_LUFS - r.lufs) / 20) : null; // only ever turns down

// Called when a song starts: its gain now if known, else a typical guess, eased to the real value when it arrives
function setTrackGain(id) {
    if (!PB.normalize || !VOLUME_WORKS) { P.trackGain = 1; applyVolume(); return; }
    const known = LOUD.get(id);
    if (known && !(known instanceof Promise)) { P.trackGain = gainFor(known) ?? 1; applyVolume(); }
    else {
        P.trackGain = 0.5; // ≈ -6 dB: most downloads are -7 to -10 LUFS
        applyVolume();
        loudnessOf(id).then((r) => {
            if (currentTrack()?.id !== id) return;
            const target = gainFor(r) ?? 1, start = P.trackGain, t0 = performance.now();
            const step = setInterval(() => {
                const x = Math.min(1, (performance.now() - t0) / 800);
                P.trackGain = start + (target - start) * x;
                applyVolume();
                if (x >= 1) clearInterval(step);
            }, 40);
        });
    }
    const after = neighbour(1); // measure the next song ahead of time
    if (after) loudnessOf(after.id);
}

const contextTrackId = () => P.queue[P.order[P.pos]];
const currentTrack = () => S.byId.get(P.queued || contextTrackId()) || null;

function buildOrder(startIndex) {
    const idx = P.queue.map((_, i) => i);
    if (P.shuffle) {
        const rest = idx.filter((i) => i !== startIndex);
        for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
        P.order = startIndex >= 0 ? [startIndex, ...rest] : rest;
        P.pos = 0;
    } else {
        P.order = idx;
        P.pos = Math.max(0, startIndex);
    }
}

function playContext(trackIds, startIndex, context) {
    const ids = trackIds.filter((id) => S.byId.has(id));
    if (!ids.length) return;
    if (remoteCommand('play_context', { track_ids: ids, start_index: startIndex, context })) return;
    const start = startIndex === null || startIndex === undefined ? (P.shuffle ? -1 : 0) : ids.indexOf(trackIds[startIndex]);
    P.queue = ids;
    P.context = context;
    P.queued = null; // a new context starts now; songs you queued still play next, as in Spotify
    if (context?.key) rememberRecent(context.key);
    buildOrder(start);
    loadAndPlay();
}

// For "Recents" in Your Library: the newest 200 played playlists/albums/artists, newest first
function rememberRecent(key) {
    S.recent[key] = Date.now();
    const keys = Object.keys(S.recent).sort((a, b) => S.recent[b] - S.recent[a]);
    for (const old of keys.slice(200)) delete S.recent[old];
    store.set('recentContexts', S.recent);
    if (S.libSort === 'recents') renderSidebar();
}

// ---------- listening history (for the Stats page) ----------
// Count only time actually heard: each timeupdate adds the step since the last one if it's small and
// forward. A seek is a jump, not listening. The server decides if it counts (30 s, or half a short song).
const listen = { id: null, seconds: 0, last: null };

function startListen(trackId) {
    flushListen();
    listen.id = trackId;
    listen.seconds = 0;
    listen.last = null;
}

function flushListen(useBeacon = false) {
    if (listen.id && listen.seconds >= 10) {
        const body = JSON.stringify({ track_id: listen.id, seconds: Math.round(listen.seconds * 10) / 10 });
        if (useBeacon && navigator.sendBeacon) navigator.sendBeacon('/api/plays', new Blob([body], { type: 'application/json' }));
        else fetch('/api/plays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
    listen.id = null;
    listen.seconds = 0;
    listen.last = null;
}

// ---------- resume where you left off ----------
// The queue, play order, position in it, context (the playlist/album/…) and time in the song, saved in
// localStorage. On launch the player comes back paused at that spot and the app opens that playlist.
// ~17 bytes per queued song, so even All songs (600) is ~10 KB.

function saveSession() {
    const t = currentTrack();
    if (!t) return;
    const key = S.init.on_phone && R.mode === 'listen' ? 'transferSession' : 'session';
    store.set(key, {
        queue: P.queue, order: P.order, pos: P.pos, context: P.context,
        trackId: contextTrackId(), queued: P.queued, upNext: P.upNext, time: Math.floor(P.audio.currentTime || 0),
    });
}

const RESUMABLE_PAGE = /^#\/(songs$|liked$|collection\/|artist\/|genre\/)/; // library pages only: a search page would re-run a YouTube search

function restoreSession(key = 'session') {
    const saved = store.get(key, null);
    if (!saved || !Array.isArray(saved.queue)) return false;
    // Songs deleted since are dropped; rebuild the order around what's left
    const queue = saved.queue.filter((id) => S.byId.has(id));
    const start = queue.indexOf(saved.trackId);
    if (start < 0) return false;
    const oldToNew = new Map(saved.queue.map((id, i) => [i, queue.indexOf(id)]));
    const order = (saved.order || []).map((i) => oldToNew.get(i)).filter((i) => i !== undefined && i >= 0);
    P.queue = queue;
    P.context = saved.context || null;
    if (order.length === queue.length) { P.order = order; P.pos = order.indexOf(start); } else buildOrder(start);
    P.upNext = (saved.upNext || []).filter((id) => S.byId.has(id));
    P.queued = S.byId.has(saved.queued) ? saved.queued : null;
    const t = currentTrack();
    startListen(t.id);   // counting only happens while it actually plays
    P.audio.src = `/api/stream/${encodeURIComponent(t.id)}`;
    setTrackGain(t.id);
    if (saved.time > 0) P.audio.addEventListener('loadedmetadata', () => { if (saved.time < P.audio.duration - 1) P.audio.currentTime = saved.time; }, { once: true });
    updateNowPlaying();
    updateControls();
    return P.context && RESUMABLE_PAGE.test(P.context.href || '') ? P.context.href : null;
}

function loadAndPlay() {
    const t = currentTrack();
    if (!t) return;
    const ready = takeReadyPlayer(t.id); // before endFade, which would empty the spare
    resetPlaybackRecovery(t.id);
    if (!XF.switching) endFade(); // you skipped: drop any crossfade in progress
    setTrackGain(t.id);
    startListen(t.id);
    if (!ready) P.audio.src = `/api/stream/${encodeURIComponent(t.id)}`;
    const play = () => P.audio.play().then(() => true);
    const started = play().catch((err) => {
        // A browser that won't start the swapped-in player (in the background, say): back to the one that was playing
        if (ready && err.name === 'NotAllowedError' && currentTrack() === t) { unswapPlayers(t); return play(); }
        throw err;
    }).catch((err) => {
        if (err.name === 'AbortError') return false;
        if (document.hidden) {
            // Screen locked: no tap is possible, Android may throttle background network, and
            // Chrome can refuse background play(). Keep trying — reloading the source when the
            // load itself failed — instead of parking on an overlay nobody can press.
            const url = `/api/stream/${encodeURIComponent(t.id)}`;
            let tries = 0;
            const retry = () => P.audio.play().then(() => {}).catch((e2) => {
                if (e2.name === 'AbortError') return; // a newer track took over
                if (e2.name === 'NotSupportedError' || e2.name === 'NetworkError') {
                    try { P.audio.src = url; P.audio.load(); } catch { /* next try */ }
                }
                if (++tries < 60 && document.hidden) setTimeout(retry, 3000); // ~3 minutes while locked
                else if (document.hidden) mediaSessionRetryHint(); // give up quietly; the app is out of sight
                else showTapToPlay(P.context?.label || t.title); // visible again and still failing
            });
            setTimeout(retry, 2000);
            return false;
        }
        if (err.name === 'NotAllowedError') showTapToPlay(P.context?.label || t.title); // no click on this page yet
        else toast(`Couldn't play "${t.title}"`, 'error');
        return false;
    });
    updateNowPlaying();
    saveSession();
    return started;
}

function mediaSessionRetryHint() { // background play still refused: remember it for the next time the app is seen
    try { sessionStorage.setItem('spotdlr.bgPlayFailed', String(Date.now())); } catch { /* private mode */ }
}

function togglePlay() {
    if (remoteCommand('toggle')) return;
    if (!currentTrack()) {
        if (S.tracks.length) playContext(S.tracks.map((t) => t.id), null, { key: 'songs', label: 'All songs', href: '#/songs' });
        return;
    }
    if (P.audio.paused) { resetPlaybackRecovery(currentTrack().id); P.audio.play(); } else P.audio.pause();
}

function next(auto = false) {
    if (!auto && remoteCommand('next')) return;
    if (!currentTrack()) return;
    if (auto && P.repeat === 'one') { startListen(currentTrack().id); P.audio.currentTime = 0; P.audio.play(); return; }
    // Songs you queued come first; P.pos stays put, so the context carries on where it was afterwards
    if (P.upNext.length) { P.queued = P.upNext.shift(); return loadAndPlay(); }
    if (P.pos < P.order.length - 1) P.pos++;
    else if (P.repeat !== 'off') { if (P.shuffle) buildOrder(-1); else P.pos = 0; }
    else { if (auto) { P.audio.pause(); P.audio.currentTime = 0; } return; }
    P.queued = null;
    return loadAndPlay();
}

function prev() {
    if (remoteCommand('previous')) return;
    if (!currentTrack()) return;
    if (P.audio.currentTime > 3 || (!P.queued && P.pos === 0 && P.repeat === 'off')) { P.audio.currentTime = 0; return; }
    if (P.queued) { P.queued = null; loadAndPlay(); return; } // back to the context song before the queued one
    P.pos = P.pos > 0 ? P.pos - 1 : P.order.length - 1;
    loadAndPlay();
}

function toggleShuffle() {
    if (remoteCommand('shuffle')) return;
    P.shuffle = !P.shuffle;
    store.set('shuffle', P.shuffle);
    const cur = P.order[P.pos];
    if (P.queue.length) buildOrder(cur ?? -1);
    updateControls();
    renderNowView();  // the previous/next songs changed
    saveSession();
}

function cycleRepeat() {
    if (remoteCommand('repeat')) return;
    P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat];
    store.set('repeat', P.repeat);
    updateControls();
    renderNowView();
}

const isContextPlaying = (key) => P.context && P.context.key === key && playbackIsPlaying();

function updateNowPlaying() {
    const t = currentTrack();
    $('#player').classList.toggle('idle', !t);
    if (!t) return;
    $('#npArt').outerHTML = trackArt(t).toString().replace('class="art ', 'id="npArt" class="art ');
    $('#npTitle').textContent = t.title;
    $('#npTitle').href = P.context ? P.context.href : '#/songs';
    $('#npArtist').innerHTML = html`${t.artists.map((a, i) => html`${i ? ', ' : ''}<a href="${artistHref(a)}">${a}</a>`)}`.toString();
    document.title = `${t.title} • ${t.artists.join(', ')}`;
    $('#npLike').innerHTML = likeButton(t.id).s;
    renderNowView();
    renderQueue();
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: t.title,
            artist: t.artists.join(', '),
            album: t.album,
            artwork: t.has_cover ? [{ src: location.origin + artUrl(t.id), sizes: '640x640', type: 'image/jpeg' }] : [],
        });
    }
    markPlaying();
}

function updateControls() {
    const playing = playbackIsPlaying();
    $('#playBtn').innerHTML = icon(playing ? 'pause' : 'play', 16).s;
    $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    const shuffle = $('#shuffleBtn');
    shuffle.classList.toggle('on', P.shuffle);
    shuffle.setAttribute('aria-pressed', P.shuffle);
    const repeat = $('#repeatBtn');
    repeat.innerHTML = icon(P.repeat === 'one' ? 'repeatOne' : 'repeat', 16).s;
    repeat.classList.toggle('on', P.repeat !== 'off');
    repeat.setAttribute('aria-pressed', P.repeat !== 'off');
    repeat.setAttribute('aria-label', { off: 'Repeat', all: 'Repeat all', one: 'Repeat one' }[P.repeat]);
    document.body.classList.toggle('is-playing', playing);
    document.body.classList.toggle('remote-playback', remoteActive());
    refreshVolumeControls();
    updateNowControls();
    // Big play buttons in the view reflect whether their context is the one playing
    $$('[data-play-context]').forEach((btn) => {
        const on = isContextPlaying(btn.dataset.playContext);
        btn.innerHTML = icon(on ? 'pause' : 'play', btn.dataset.size ? +btn.dataset.size : 24).s;
        btn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    });
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function remoteSnapshot() {
    const track = currentTrack();
    return {
        track_id: track?.id || null,
        queue: P.queue, order: P.order, pos: P.pos, context: P.context,
        up_next: P.upNext, queued: P.queued,
        playing: !P.audio.paused && !!track,
        time: P.audio.currentTime || 0, duration: P.audio.duration || track?.duration || 0,
        shuffle: P.shuffle, repeat: P.repeat,
        volume: P.audio.muted ? 0 : P.userVolume, muted: P.audio.muted,
        captured_at: Date.now(),
    };
}

function prepareListenHere(state) {
    if (!S.init.on_phone || !state?.track_id || !S.byId.has(state.track_id)) return;
    const source = `/api/stream/${encodeURIComponent(state.track_id)}`;
    if (P.audio.getAttribute('src') === source) return;
    P.audio.pause();
    P.audio.src = source;
    P.audio.load();
}

function adoptPlaybackState(state) {
    if (!state || !S.byId.has(state.track_id)) return false;
    P.audio.pause();
    P.queue = Array.isArray(state.queue) ? state.queue.filter((id) => S.byId.has(id)) : [];
    P.order = Array.isArray(state.order) ? state.order.filter((i) => Number.isInteger(i) && i >= 0 && i < P.queue.length) : [];
    P.pos = Number.isInteger(state.pos) ? state.pos : -1;
    P.context = state.context || null;
    P.upNext = Array.isArray(state.up_next) ? state.up_next.filter((id) => S.byId.has(id)) : [];
    P.queued = S.byId.has(state.queued) ? state.queued : null;
    P.shuffle = !!state.shuffle;
    P.repeat = ['off', 'all', 'one'].includes(state.repeat) ? state.repeat : 'off';
    store.set('shuffle', P.shuffle);
    store.set('repeat', P.repeat);

    if (currentTrack()?.id !== state.track_id) {
        const queueIndex = P.queue.indexOf(state.track_id);
        const orderPosition = P.order.indexOf(queueIndex);
        if (orderPosition >= 0) { P.pos = orderPosition; P.queued = null; }
        else P.queued = state.track_id;
    }

    const track = currentTrack();
    if (!track) return false;
    const elapsed = state.playing && Number.isFinite(+state.captured_at)
        ? Math.max(0, (Date.now() - +state.captured_at) / 1000) : 0;
    const end = +state.duration || track.duration || Infinity;
    const resumeAt = Math.max(0, Math.min(end, (+state.time || 0) + elapsed));
    startListen(track.id);
    setTrackGain(track.id);
    const source = `/api/stream/${encodeURIComponent(track.id)}`;
    if (P.audio.getAttribute('src') !== source) P.audio.src = source;
    try { P.audio.currentTime = resumeAt; } catch { /* applied again when metadata is ready */ }
    P.audio.addEventListener('loadedmetadata', () => {
        if (currentTrack()?.id === track.id && resumeAt < P.audio.duration) P.audio.currentTime = resumeAt;
    }, { once: true });
    if (state.playing) P.audio.play().catch((error) => {
        if (error.name === 'NotAllowedError') showTapToPlay(P.context?.label || track.title);
        else if (error.name !== 'AbortError') toast(`Couldn't continue playing "${track.title}"`, 'error');
    });
    updateNowPlaying();
    updateControls();
    saveSession();
    return true;
}

function runRemoteCommand(command) {
    const value = command.value;
    if (command.action === 'play') { if (P.audio.paused) togglePlay(); }
    else if (command.action === 'pause') { if (!P.audio.paused) togglePlay(); }
    else if (command.action === 'toggle') togglePlay();
    else if (command.action === 'next') next();
    else if (command.action === 'previous') prev();
    else if (command.action === 'seek' && Number.isFinite(+value) && P.audio.duration) P.audio.currentTime = Math.max(0, Math.min(P.audio.duration, +value));
    else if (command.action === 'volume' && Number.isFinite(+value)) {
        P.audio.muted = false;
        P.userVolume = clamp01(+value);
        store.set('volume', P.userVolume);
        applyVolume();
    } else if (command.action === 'mute') { P.audio.muted = !P.audio.muted; applyVolume(); }
    else if (command.action === 'transfer') adoptPlaybackState(value);
    else if (command.action === 'shuffle') toggleShuffle();
    else if (command.action === 'repeat') cycleRepeat();
    else if (command.action === 'play_context' && Array.isArray(value?.track_ids)) {
        playContext(value.track_ids, value.start_index, value.context || null);
    } else if (command.action === 'queue_add' && Array.isArray(value?.track_ids)) {
        addToQueue(value.track_ids, { next: !!value.next });
    } else if (command.action === 'queue_remove' && Number.isInteger(+value)) {
        P.upNext.splice(+value, 1); queueChanged();
    } else if (command.action === 'queue_clear') {
        P.upNext = []; queueChanged();
    } else if (command.action === 'queue_play' && value && Number.isInteger(+value.index)) {
        if (value.kind === 'user') P.queued = P.upNext.splice(+value.index, 1)[0];
        else { P.pos = +value.index; P.queued = null; }
        loadAndPlay();
    } else if (command.action === 'queue_move' && value && Number.isInteger(+value.from) && Number.isInteger(+value.to)) {
        P.upNext.splice(+value.to, 0, ...P.upNext.splice(+value.from, 1)); queueChanged();
    }
}

function applyRemoteState(status) {
    R.online = !!status.online;
    R.source = status.source || null;
    if (!status.online || !status.state) {
        R.state = null;
        updateControls();
        setRemoteDeviceStatus('Computer unavailable. Keep spotDLr open on it.', false);
        return;
    }
    const state = status.state;
    const before = currentTrack()?.id;
    R.state = state;
    P.queue = Array.isArray(state.queue) ? state.queue.filter((id) => S.byId.has(id)) : [];
    P.order = Array.isArray(state.order) ? state.order.filter((i) => Number.isInteger(i) && i >= 0 && i < P.queue.length) : [];
    P.pos = Number.isInteger(state.pos) ? state.pos : -1;
    P.context = state.context || null;
    P.upNext = Array.isArray(state.up_next) ? state.up_next.filter((id) => S.byId.has(id)) : [];
    P.queued = S.byId.has(state.queued) ? state.queued : null;
    P.shuffle = !!state.shuffle;
    P.repeat = ['off', 'all', 'one'].includes(state.repeat) ? state.repeat : 'off';
    const track = currentTrack();
    prepareListenHere(state);
    if (track && track.id !== before) updateNowPlaying();
    else markPlaying();
    const seek = $('#seekBar'), duration = +state.duration || track?.duration || 0;
    if (seek && !P.seeking) {
        seek.value = duration ? Math.round(((+state.time || 0) / duration) * 1000) : 0;
        setRangeFill(seek);
        $('#timeCurrent').textContent = fmtTime(state.time);
        $('#timeTotal').textContent = fmtTime(duration);
        updateNowProgress();
    }
    updateControls();
    setRemoteDeviceStatus(`Connected to ${R.source?.name || 'the computer'}`, true);
}

function setRemoteDeviceStatus(message, connected) {
    const status = $('#remoteDeviceStatus');
    if (!status) return;
    const copy = $('span', status);
    if (copy) copy.textContent = message;
    status.classList.toggle('connected', !!connected);
}

async function remoteSyncTick() {
    clearTimeout(R.timer);
    try {
        if (S.init.on_phone) {
            if (remoteActive()) applyRemoteState(await api('/remote/status'));
        } else if (!R.publishing) {
            R.publishing = true;
            const result = await api('/remote/source?wait=1', { method: 'POST', body: JSON.stringify({
                device_id: DEVICE_ID, device_name: DEVICE_NAME, state: remoteSnapshot(),
            }) });
            for (const command of result.commands || []) runRemoteCommand(command);
        }
    } catch {
        if (remoteActive()) applyRemoteState({ online: false });
    } finally {
        R.publishing = false;
        const delay = S.init.on_phone
            ? !remoteActive() ? 10_000 : document.hidden ? 5_000 : R.state?.playing ? 1_000 : 2_000
            : 50;
        R.timer = setTimeout(remoteSyncTick, delay);
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.init.on_phone) { clearTimeout(R.timer); R.timer = setTimeout(remoteSyncTick, 50); }
});

function setPlaybackDevice(mode) {
    const nextMode = ['local', 'listen', 'remote'].includes(mode) ? mode : 'local';
    if (nextMode === R.mode) return;
    const previousMode = R.mode;
    const localState = remoteSnapshot();
    const remoteState = R.state;
    P.audio.pause();
    R.mode = nextMode;
    store.set('playbackDevice', R.mode);

    if (nextMode === 'remote') {
        if (previousMode === 'listen' && localState.track_id) remoteCommand('transfer', localState);
        remoteSyncTick();
    } else if (nextMode === 'listen') {
        const listenHere = (state) => {
            if (!state?.track_id) { toast('Nothing is playing on the computer', 'error'); return; }
            api('/remote/command', { method: 'POST', body: JSON.stringify({ action: 'pause', value: null }) }).catch(() => {});
            adoptPlaybackState(state);
        };
        if (remoteState?.track_id) listenHere(remoteState);
        else api('/remote/status').then((status) => {
            R.online = !!status.online; R.source = status.source || null; R.state = status.state || null;
            listenHere(status.state);
        }).catch((error) => toast(error.message, 'error'));
    } else {
        R.state = null;
        R.online = false;
        if (restoreSession('session') === false) {
            P.queue = []; P.order = []; P.pos = -1; P.context = null; P.upNext = []; P.queued = null;
            P.audio.removeAttribute('src'); P.audio.load();
        }
        updateNowPlaying();
        updateControls();
    }
}

function markPlaying() {
    const t = currentTrack();
    $$('.track[data-id]').forEach((row) => row.classList.toggle('playing', !!t && row.dataset.id === t.id));
    $$('.lib-item[data-key]').forEach((item) => item.classList.toggle('playing', !!P.context && P.context.key === item.dataset.key));
}

// ---------- crossfade ----------
// The last N seconds of a song overlap the start of the next. A second <audio> (XF.el) takes over the
// outgoing song's tail at the same spot, fading out, while P.audio starts the next song fading in, so
// everything else (seek bar, visualizer, media keys) keeps working with P.audio as the one player.
// Timers, not requestAnimationFrame: rAF stops while the window is hidden, which would freeze the fade.

function maybeCrossfade() {
    const secs = VOLUME_WORKS ? PB.crossfade : 0; // without volume control both songs would play at full volume
    if (!secs || XF.active || P.seeking || P.audio.paused || P.repeat === 'one' || SL.endOfSong) return;
    const d = P.audio.duration, left = d - P.audio.currentTime;
    if (!d || d < secs * 2 + 5 || !neighbour(1)) return;
    if (left <= secs + 4 && XF.prepared !== P.audio.src) { // load the tail on the spare player ahead of time
        XF.prepared = P.audio.src;
        XF.ready = null; // crossfade switched on after the next song was readied: the spare is the tail's now
        XF.el.src = P.audio.src;
        XF.el.currentTime = Math.max(0, d - secs - 1);
    }
    if (left <= secs) startFade(secs);
}

function startFade(secs) {
    XF.active = true;
    XF.el.currentTime = P.audio.currentTime + 0.02;
    XF.outGain = P.trackGain;
    XF.out = 1;
    applyVolume();
    XF.el.play().then(() => {
        if (!XF.active) return;
        flushListen(); // the outgoing song's listening counts now
        P.fadeIn = 0;
        XF.switching = true;
        const loadStarted = performance.now();
        const incoming = next(true);
        XF.switching = false;
        Promise.resolve(incoming).then((started) => {
            if (!XF.active) return;
            if (started === false) { endFade(); return; }
            const elapsed = (performance.now() - loadStarted) / 1000;
            const fadeSecs = Math.max(0.25, secs - elapsed);
            const t0 = performance.now();
            clearInterval(XF.timer);
            XF.timer = setInterval(() => {
                const x = Math.min(1, (performance.now() - t0) / (fadeSecs * 1000));
                XF.out = Math.cos((x * Math.PI) / 2); // equal power: the sum sounds steady, not dipping in the middle
                P.fadeIn = Math.sin((x * Math.PI) / 2);
                applyVolume();
                if (x >= 1) endFade();
            }, 50);
        });
    }).catch(() => endFade());
}

function endFade() {
    clearInterval(XF.timer);
    XF.timer = null;
    if (XF.active || XF.prepared) {
        XF.el.pause();
        XF.el.removeAttribute('src');
        XF.el.load();
    }
    XF.active = false;
    XF.prepared = null;
    XF.out = 1;
    P.fadeIn = 1;
    applyVolume();
}

// ---------- mobile stream recovery ----------
// Mobile browsers occasionally leave a Wi-Fi audio request waiting forever without raising `error`.
// A manual pause/play works because it opens a new Range request. Do that automatically after eight
// seconds with no progress; if the browser got stuck at the final frame, advance the queue instead.
const RECOVERY_WAIT_MS = 8000;
const playbackRecovery = { timer: null, trackId: null, time: 0, attempts: 0, serial: 0 };

function playbackRecoveryAction({ paused, ended, sameTrack, advanced, currentTime, duration, attempts, hidden }) {
    if (ended || !sameTrack || advanced) return null;
    if (paused && !hidden) return null; // on screen, a paused player is the user's choice
    if (paused && hidden && attempts >= 10) return null; // locked: keep trying, but not forever
    if (Number.isFinite(duration) && duration > 0 && duration - currentTime <= 1 && !paused) return 'next';
    if (hidden && paused) return 'retry';   // locked and not sounding: reload + play, up to the cap above
    if (hidden) return 'watch';             // locked and merely stalled: the stream resumes itself when the network does
    return attempts < 3 ? 'retry' : 'wait';
}

function resetPlaybackRecovery(trackId = null) {
    clearTimeout(playbackRecovery.timer);
    playbackRecovery.timer = null;
    playbackRecovery.trackId = trackId;
    playbackRecovery.time = P.audio.currentTime || 0;
    playbackRecovery.attempts = 0;
}

function armPlaybackRecovery() {
    const t = currentTrack();
    if (!t || P.audio.paused || P.audio.ended || playbackRecovery.timer) return;
    if (playbackRecovery.trackId !== t.id) resetPlaybackRecovery(t.id);
    const trackId = t.id, stalledAt = P.audio.currentTime || 0;
    playbackRecovery.time = stalledAt;
    const check = () => {
        playbackRecovery.timer = null;
        const current = currentTrack();
        const action = playbackRecoveryAction({
            paused: P.audio.paused, ended: P.audio.ended, sameTrack: current?.id === trackId,
            advanced: (P.audio.currentTime || 0) > stalledAt + 0.25,
            currentTime: P.audio.currentTime || 0, duration: P.audio.duration,
            attempts: playbackRecovery.attempts, hidden: document.hidden,
        });
        if (action === 'next') { next(true); return; }
        if (action === 'watch') { playbackRecovery.timer = setTimeout(check, RECOVERY_WAIT_MS * 2); return; } // locked: keep watching, no tap needed
        if (action === 'wait') { toast('Playback is still waiting for the connection. Tap pause, then play to retry.', 'error'); return; }
        if (action !== 'retry') return;

        playbackRecovery.attempts++;
        playbackRecovery.serial++;
        endFade();
        const resumeAt = stalledAt;
        P.audio.src = `/api/stream/${encodeURIComponent(trackId)}?retry=${playbackRecovery.serial}`;
        P.audio.addEventListener('loadedmetadata', () => {
            if (currentTrack()?.id === trackId && resumeAt < P.audio.duration - 1) P.audio.currentTime = resumeAt;
        }, { once: true });
        P.audio.play().catch((error) => {
            if (error.name === 'AbortError') return;
            if (document.hidden) { playbackRecovery.timer = setTimeout(check, RECOVERY_WAIT_MS); return; } // locked: try again next round
            if (error.name !== 'NotAllowedError') toast(`Couldn't resume "${current?.title || 'song'}"`, 'error');
        });
    };
    playbackRecovery.timer = setTimeout(check, RECOVERY_WAIT_MS);
}

function notePlaybackProgress() {
    if (!playbackRecovery.timer) return;
    if ((P.audio.currentTime || 0) <= playbackRecovery.time + 0.25) return;
    clearTimeout(playbackRecovery.timer);
    playbackRecovery.timer = null;
    playbackRecovery.attempts = 0;
}

// ---------- sound: equalizer, reverb, balance ----------
// All three are Web Audio nodes after the volume, so they need the music routed through Web Audio
// (ensureAudioGraph): never on iPhone/iPad, where Safari would stop it when the screen locks. Saved per device.

const SOUND_WORKS = !IOS && !!(window.AudioContext || window.webkitAudioContext);
// Six bands like Spotify's, each a bump (a peaking filter) [centre, Q, label]. Q 1 is about 1.4 octaves wide, as far
// apart as the bands are; 15 kHz is wider (Q 0.7), its neighbour being 2.6 octaves away. Not shelves at the ends: a
// shelf is only halfway at its own frequency, so its dot sat off the line, and forcing it on overshot the deep bass.
const EQ_BANDS = [[60, 1, '60 Hz'], [150, 1, '150 Hz'], [400, 1, '400 Hz'], [1000, 1, '1 kHz'], [2400, 1, '2.4 kHz'], [15000, 0.7, '15 kHz']];
const eqFilters = (ctx) => EQ_BANDS.map(() => Object.assign(ctx.createBiquadFilter(), { type: 'peaking' }))
    .map((f, i) => { f.frequency.value = EQ_BANDS[i][0]; f.Q.value = EQ_BANDS[i][1]; return f; });
const EQ_RANGE = 12; // dB either way
const EQ_PRESETS = {
    flat: ['Flat', [0, 0, 0, 0, 0, 0]],
    bass: ['Bass booster', [6, 4, 1, 0, 0, 0]],
    bassCut: ['Bass reducer', [-6, -4, -1, 0, 0, 0]],
    treble: ['Treble booster', [0, 0, 0, 1, 4, 6]],
    trebleCut: ['Treble reducer', [0, 0, 0, -1, -4, -6]],
    vocal: ['Vocal booster', [-2, -1, 2, 4, 3, 0]],
    speakers: ['Small speakers', [5, 3, 0, -1, 1, 3]],
    acoustic: ['Acoustic', [4, 3, 1, 1, 2, 2]],
    dance: ['Dance', [6, 4, 1, -1, 2, 3]],
    hiphop: ['Hip-hop', [6, 5, 1, -1, 1, 2]],
    jazz: ['Jazz', [3, 2, -1, 1, 2, 3]],
    pop: ['Pop', [-1, 1, 3, 3, 1, -1]],
    rock: ['Rock', [4, 2, -1, -1, 2, 4]],
    spoken: ['Spoken word', [-3, -1, 2, 4, 3, -2]],
};
// A room is how long its echoes take to fade by 60 dB (RT60), the number acousticians measure rooms by
const ROOMS = { small: ['Small room', 0.4], studio: ['Studio', 0.8], hall: ['Concert hall', 1.8], cathedral: ['Cathedral', 4] };
const FX = {
    eq: { on: false, preset: 'flat', gains: [0, 0, 0, 0, 0, 0], ...store.get('eq', {}) },
    reverb: { room: 'off', amount: 0.3, ...store.get('reverb', {}) },
    nodes: null, rooms: {},
};
const soundInUse = () => SOUND_WORKS && ((FX.eq.on && FX.eq.gains.some(Boolean)) || !!ROOMS[FX.reverb.room] || !!P.balance);

// The curve in dB at each frequency, from the same filters the music goes through (an offline context: no
// sound, no click needed, works before the real one exists)
const EQ_FREQS = Float32Array.from({ length: 160 }, (_, i) => 20 * 1000 ** (i / 159)); // 20 Hz to 20 kHz, evenly on a log scale
const EQ_CENTERS = Float32Array.from(EQ_BANDS, ([freq]) => freq);
let eqProbe = null;
function eqResponse(filterGains, freqs = EQ_FREQS) {
    // At the rate the music plays at (most computers: 48 kHz, assumed until the audio starts). A peaking filter is
    // back to 0 dB at half that rate, so above 15 kHz the line depends on it: +6 at 15 kHz is +0.9 at 20 kHz at 44.1
    // kHz, +1.9 at 48. The dots don't: each filter is exact at its own centre whatever the rate.
    const rate = V.ctx?.sampleRate || 48000;
    if (eqProbe?.rate !== rate) {
        eqProbe = eqFilters(new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, rate));
        eqProbe.rate = rate;
        eqSolved.clear();
    }
    const total = new Float32Array(freqs.length), mag = new Float32Array(freqs.length), phase = new Float32Array(freqs.length);
    eqProbe.forEach((f, i) => {
        f.gain.value = filterGains[i];
        f.getFrequencyResponse(freqs, mag, phase);
        for (let k = 0; k < total.length; k++) total[k] += 20 * Math.log10(mag[k]);
    });
    return total;
}
// The bumps overlap (a band's neighbours add about a quarter of their gain at its centre), so a filter can't simply
// get its slider's value: Pop's +3 at 400 Hz and 1 kHz came out +3.7 and +3.8. So: set each filter to its slider,
// measure the line at the six dots, move each filter by how far its dot was missed, repeat. Each round removes most
// of the error; 8 land every dot within 0.05 dB, even a ±12 zigzag. What you set is then exactly what you hear.
const eqSolved = new Map();
function eqSolve(sliders) {
    const key = sliders.join();
    if (!eqSolved.has(key)) {
        let gains = sliders.slice();
        for (let round = 0; round < 8; round++) {
            const line = eqResponse(gains, EQ_CENTERS);
            gains = gains.map((g, i) => Math.max(-30, Math.min(30, g + sliders[i] - line[i])));
        }
        if (eqSolved.size > 500) eqSolved.clear();
        eqSolved.set(key, gains);
    }
    return eqSolved.get(key);
}
// Headroom: a boost of +6 dB doubles a band, and a song already peaking near full scale would then clip (flat-topped:
// crackle). So the whole thing first goes down by the line's highest point, which can sit between the dots. The bass
// ends up where you set it, nothing clips; the price is that boosting can't make it louder.
const eqHeadroom = (sliders) => -Math.max(0, ...eqResponse(eqSolve(sliders)));

// A room's echo, made rather than recorded: noise that dies away, different in each ear, highs fading twice as fast as
// lows (as walls and air absorb them). tail(t) = noise · e^(−t/τ), τ = RT60 / ln 1000 (60 dB = 1/1000 of the amplitude).
// Scaled to unit energy, so the room alone is about as loud as the song, and the dry/wet mix keeps the loudness.
function roomImpulse(ctx, seconds) {
    const rate = ctx.sampleRate, delay = Math.round(rate * Math.min(0.04, seconds * 0.01)); // first echo 4-40 ms late
    const length = delay + Math.ceil(rate * seconds), tau = seconds / Math.log(1000);
    const impulse = ctx.createBuffer(2, length, rate);
    let energy = 0;
    for (let side = 0; side < 2; side++) {
        const data = impulse.getChannelData(side);
        let low = 0;
        for (let i = delay; i < length; i++) {
            const t = (i - delay) / rate, noise = Math.random() * 2 - 1;
            low += (noise - low) * 0.2;                         // one-pole low-pass, about 1.5 kHz
            data[i] = (noise - low) * Math.exp((-2 * t) / tau) + low * Math.exp(-t / tau);
            energy += data[i] * data[i];
        }
    }
    const scale = 1 / Math.sqrt(energy / 2);
    for (let side = 0; side < 2; side++) { const data = impulse.getChannelData(side); for (let i = 0; i < length; i++) data[i] *= scale; }
    return impulse;
}

// A gain that is always stereo: mono is copied to both sides ('speakers'), 5.1 is folded down
function twoChannels(ctx) {
    return Object.assign(ctx.createGain(), { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
}

// bus → headroom → 6 bands → dry + room (wet) → left/right levels (balance) → speakers
function buildSound(ctx, bus) {
    const preamp = ctx.createGain();
    const bands = eqFilters(ctx);
    bus.connect(preamp);
    [preamp, ...bands].reduce((from, to) => { from.connect(to); return to; });
    const out = bands[bands.length - 1], dry = ctx.createGain(), wet = ctx.createGain(), sum = twoChannels(ctx);
    out.connect(dry);
    dry.connect(sum);
    wet.connect(sum);
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    sum.connect(split);
    const sides = [0, 1].map((side) => { const level = ctx.createGain(); split.connect(level, side); level.connect(merge, 0, side); return level; });
    merge.connect(ctx.destination);
    FX.nodes = { preamp, bands, out, dry, wet, sides, room: null, roomKey: 'off' };
}

function applySound() {
    const n = FX.nodes;
    if (!n) return;
    const ctx = n.dry.context, now = ctx.currentTime, glide = (param, value) => param.setTargetAtTime(value, now, 0.03);
    const sliders = FX.eq.on ? FX.eq.gains : EQ_BANDS.map(() => 0);
    eqSolve(sliders).forEach((g, i) => glide(n.bands[i].gain, g));
    glide(n.preamp.gain, 10 ** (eqHeadroom(sliders) / 20));
    // Reverb: a new convolver per room (not a new buffer on the old one, which some browsers refuse); none when off
    const room = ROOMS[FX.reverb.room] ? FX.reverb.room : 'off';
    if (room !== n.roomKey) {
        if (n.room) { const old = n.room; setTimeout(() => old.disconnect(), 200); n.out.disconnect(old); } // after the wet fade
        n.room = null;
        if (room !== 'off') {
            FX.rooms[room] = FX.rooms[room] || roomImpulse(ctx, ROOMS[room][1]);
            n.room = Object.assign(ctx.createConvolver(), { normalize: false });
            n.room.buffer = FX.rooms[room];
            n.out.connect(n.room);
            n.room.connect(n.wet);
        }
        n.roomKey = room;
    }
    // Equal power, like the crossfade: dry² + wet² = 1, so the total stays about as loud. At most 60% room: the song stays in front.
    const mix = room === 'off' ? 0 : clamp01(FX.reverb.amount) * 0.6;
    glide(n.dry.gain, Math.cos((mix * Math.PI) / 2));
    glide(n.wet.gain, Math.sin((mix * Math.PI) / 2));
    const b = P.balance; // turning right lowers the left side, and the other way round
    glide(n.sides[0].gain, b > 0 ? 1 - b : 1);
    glide(n.sides[1].gain, b < 0 ? 1 + b : 1);
}

// Changing a setting: save it, and route the music through Web Audio if that's the first effect (this runs in the click
// or drag that changed it, so the browser lets the audio start)
function setSound(change) {
    change();
    store.set('eq', { on: FX.eq.on, preset: FX.eq.preset, gains: FX.eq.gains });
    store.set('reverb', FX.reverb);
    store.set('balance', P.balance);
    if (!FX.nodes && soundInUse()) ensureAudioGraph();
    applySound();
}
const setBalance = (value) => setSound(() => { P.balance = Math.abs(value) < 0.05 ? 0 : Math.round(value * 100) / 100; }); // a little dead zone: the middle is easy to find

// Settings → Playback → Sound. The equalizer is a graph: drag a band's point (or anywhere above or below it), or
// use the arrow keys on it; the line is the real filters' response.
const EQ_VIEW = { w: 560, h: 180, left: 40, right: 14, top: 14, bottom: 14 };
const eqX = (freq) => EQ_VIEW.left + (Math.log(freq / 20) / Math.log(1000)) * (EQ_VIEW.w - EQ_VIEW.left - EQ_VIEW.right);
const eqY = (db) => EQ_VIEW.top + ((EQ_RANGE - db) / (2 * EQ_RANGE)) * (EQ_VIEW.h - EQ_VIEW.top - EQ_VIEW.bottom);
const dbText = (db) => (db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0') + ' dB';
const balanceText = (b) => (b ? `${Math.round(Math.abs(b) * 100)}% ${b < 0 ? 'left' : 'right'}` : 'Center');

function soundSettings() {
    const { w, h, left, right } = EQ_VIEW;
    return html`<h3 class="sound-title">Sound</h3>
        ${SOUND_WORKS ? '' : html`<p class="field-note">On iPhone and iPad, Safari stops music that goes through sound effects when the screen locks, so these only work on a computer or Android.</p>`}
        <fieldset class="sound" ${SOUND_WORKS ? '' : new Safe('disabled')}>
            <div class="field">
                <div class="eq-head">
                    <label class="check"><input type="checkbox" id="setEq" ${FX.eq.on ? new Safe('checked') : ''}> Equalizer</label>
                    <select id="setEqPreset" aria-label="Equalizer preset">
                        ${Object.entries(EQ_PRESETS).map(([key, [label]]) => html`<option value="${key}">${label}</option>`)}
                        <option value="custom">Custom</option>
                    </select>
                    <button type="button" class="pill-btn" id="eqReset">Reset</button>
                </div>
                <div class="eq-panel" id="eqPanel">
                    <svg class="eq-graph" viewBox="0 0 ${w} ${h}" role="group" aria-label="Equalizer bands">
                        ${[EQ_RANGE, EQ_RANGE / 2, 0, -EQ_RANGE / 2, -EQ_RANGE].map((db) => html`<line class="${db ? 'eq-grid' : 'eq-grid zero'}" x1="${left}" x2="${w - right}" y1="${eqY(db)}" y2="${eqY(db)}"></line><text class="eq-db" x="${left - 8}" y="${eqY(db) + 4}">${db > 0 ? `+${db}` : db}</text>`)}
                        <path class="eq-curve" d=""></path>
                        ${EQ_BANDS.map(([freq, , label], i) => html`<g class="eq-band" data-band="${i}" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="${-EQ_RANGE}" aria-valuemax="${EQ_RANGE}" aria-orientation="vertical">
                            <line class="eq-stem" x1="${eqX(freq)}" x2="${eqX(freq)}" y1="${eqY(EQ_RANGE)}" y2="${eqY(-EQ_RANGE)}"></line><circle class="eq-dot" cx="${eqX(freq)}" r="8"></circle></g>`)}
                    </svg>
                    <div class="eq-labels" aria-hidden="true">${EQ_BANDS.map(([freq, , label]) => html`<span style="left:${(eqX(freq) / w) * 100}%">${label}</span>`)}</div>
                </div>
                <small id="eqNote" role="status"></small>
            </div>
            <div class="field">
                <label for="setRoom">Reverb</label>
                <select id="setRoom">
                    <option value="off">Off</option>
                    ${Object.entries(ROOMS).map(([key, [label]]) => html`<option value="${key}" ${key === FX.reverb.room ? new Safe('selected') : ''}>${label}</option>`)}
                </select>
                <label for="setRoomAmount">Amount <span class="field-value" id="roomAmountValue">${Math.round(FX.reverb.amount * 100)}%</span></label>
                <input type="range" class="bar" id="setRoomAmount" min="0" max="100" step="1" value="${Math.round(FX.reverb.amount * 100)}">
                <small>The echo of a room around the music. Songs already have some from their recording, so a little goes a long way.</small>
            </div>
            <div class="field">
                <label for="setBalance">Balance <span class="field-value" id="balanceValue">${balanceText(P.balance)}</span></label>
                <input type="range" class="bar" id="setBalance" min="-100" max="100" step="1" value="${Math.round(P.balance * 100)}" aria-valuetext="${balanceText(P.balance)}">
            </div>
        </fieldset>`;
}

function drawEq() {
    const panel = $('#eqPanel');
    if (!panel) return;
    const gains = FX.eq.gains, curve = eqResponse(eqSolve(gains)); // passes through every dot
    $('.eq-curve', panel).setAttribute('d', `M${Array.from(EQ_FREQS, (f, k) => `${eqX(f).toFixed(1)},${eqY(Math.max(-EQ_RANGE - 1, Math.min(EQ_RANGE + 1, curve[k]))).toFixed(1)}`).join('L')}`);
    $$('.eq-band', panel).forEach((band, i) => {
        $('.eq-dot', band).setAttribute('cy', eqY(gains[i]));
        band.setAttribute('aria-valuenow', gains[i]);
        band.setAttribute('aria-valuetext', dbText(gains[i]));
    });
    panel.classList.toggle('off', !FX.eq.on);
    $('#setEq').checked = FX.eq.on;
    $('#setEqPreset').value = FX.eq.preset;
    const headroom = eqHeadroom(gains);
    $('#eqNote').textContent = !SOUND_WORKS ? '' : !FX.eq.on ? 'Off: the music plays as it was recorded.'
        : headroom < -0.05 ? `Everything is turned down ${dbText(+(-headroom).toFixed(1)).replace('+', '')} first, so the boost can't distort.` : '';
}

// Any change to the bands makes it your own curve (and turns the equalizer on)
function setEqGains(gains, preset = 'custom') {
    setSound(() => { FX.eq.gains = gains.map((g) => Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Math.round(g * 2) / 2))); FX.eq.preset = preset; FX.eq.on = true; });
    drawEq();
}

function bindSoundSettings() {
    const panel = $('#eqPanel');
    if (!panel) return;
    drawEq();
    if (!SOUND_WORKS) return;
    $('#setEq').addEventListener('change', (e) => { setSound(() => { FX.eq.on = e.target.checked; }); drawEq(); });
    $('#setEqPreset').addEventListener('change', (e) => { if (EQ_PRESETS[e.target.value]) setEqGains(EQ_PRESETS[e.target.value][1], e.target.value); });
    $('#eqReset').addEventListener('click', () => setEqGains(EQ_PRESETS.flat[1], 'flat'));
    const svg = $('.eq-graph', panel);
    const dbAt = (e) => { const r = svg.getBoundingClientRect(), y = ((e.clientY - r.top) / r.height) * EQ_VIEW.h; return EQ_RANGE - ((y - EQ_VIEW.top) / (EQ_VIEW.h - EQ_VIEW.top - EQ_VIEW.bottom)) * 2 * EQ_RANGE; };
    const bandAt = (e) => { // the band nearest the pointer, left to right
        const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * EQ_VIEW.w;
        return EQ_BANDS.reduce((best, [freq], i) => (Math.abs(eqX(freq) - x) < Math.abs(eqX(EQ_BANDS[best][0]) - x) ? i : best), 0);
    };
    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const i = bandAt(e);
        $(`.eq-band[data-band="${i}"]`, svg).focus({ preventScroll: true });
        const set = (ev) => { const gains = FX.eq.gains.slice(); gains[i] = dbAt(ev); setEqGains(gains); };
        set(e);
        svg.setPointerCapture(e.pointerId);
        const move = (ev) => set(ev);
        const end = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', end); svg.removeEventListener('pointercancel', end); };
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
    });
    svg.addEventListener('keydown', (e) => {
        const band = e.target.closest('.eq-band');
        const step = { ArrowUp: 0.5, ArrowRight: 0.5, PageUp: 3, ArrowDown: -0.5, ArrowLeft: -0.5, PageDown: -3 }[e.key];
        if (!band || (step === undefined && e.key !== 'Home' && e.key !== 'End')) return;
        e.preventDefault();
        const i = +band.dataset.band, gains = FX.eq.gains.slice();
        gains[i] = e.key === 'Home' ? -EQ_RANGE : e.key === 'End' ? EQ_RANGE : gains[i] + step;
        setEqGains(gains);
    });
    const room = $('#setRoom'), amount = $('#setRoomAmount'), balance = $('#setBalance');
    const showRoom = () => { amount.disabled = room.value === 'off'; $('#roomAmountValue').textContent = `${amount.value}%`; setRangeFill(amount); };
    room.addEventListener('change', () => { setSound(() => { FX.reverb.room = room.value; }); showRoom(); });
    amount.addEventListener('input', () => { setSound(() => { FX.reverb.amount = amount.value / 100; }); showRoom(); });
    showRoom();
    const showBalance = () => { $('#balanceValue').textContent = balanceText(P.balance); balance.setAttribute('aria-valuetext', balanceText(P.balance)); setRangeFill(balance); };
    balance.addEventListener('input', () => { setBalance(balance.value / 100); showBalance(); });
    balance.addEventListener('change', () => { balance.value = Math.round(P.balance * 100); showBalance(); }); // shows the dead zone's snap to the middle
    showBalance();
}

// ---------- sleep timer ----------
// Pauses after N minutes (fading out over the last 10 s) or at the end of the song.

const SL = { until: 0, endOfSong: false, timer: null };
const SLEEP_FADE = 10; // seconds

function setSleep(minutes) {
    clearInterval(SL.timer);
    SL.timer = null;
    SL.until = 0;
    SL.endOfSong = minutes === 'end';
    P.sleepGain = 1;
    applyVolume();
    if (typeof minutes === 'number' && minutes > 0) {
        SL.until = Date.now() + minutes * 60_000;
        SL.timer = setInterval(sleepTick, 1000);
        toast(`Sleep timer: pausing in ${minutes < 60 ? `${minutes} minutes` : '1 hour'}`);
    } else if (SL.endOfSong) {
        toast('Sleep timer: pausing at the end of this song');
        endFade();
    }
    paintSleep();
}

function sleepTick() {
    const left = (SL.until - Date.now()) / 1000;
    if (left <= 0) { stopForSleep(); return; }
    P.sleepGain = left < SLEEP_FADE ? left / SLEEP_FADE : 1;
    applyVolume();
    paintSleep();
}

function stopForSleep() {
    P.audio.pause();
    endFade();
    setSleep(0);
    toast('Sleep timer: paused. Good night');
}

const sleepLeft = () => SL.endOfSong ? 'End of song' : SL.until ? fmtTime(Math.max(0, (SL.until - Date.now()) / 1000)) : '';
function paintSleep() {
    const on = !!(SL.until || SL.endOfSong), left = sleepLeft();
    $$('[data-action="sleep-menu"]').forEach((btn) => {
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-label', on ? `Sleep timer: ${left === 'End of song' ? 'at the end of this song' : `${left} left`}` : 'Sleep timer');
        const label = $('.sleep-left', btn);
        if (label) label.textContent = on ? (SL.endOfSong ? 'End' : left) : '';
    });
}

function sleepMenu(anchor) {
    const on = !!(SL.until || SL.endOfSong);
    showMenu([{ heading: on ? `Sleep timer · ${sleepLeft()}${SL.endOfSong ? '' : ' left'}` : 'Sleep timer' },
        ...[5, 15, 30, 45, 60].map((m) => ({ label: m < 60 ? `${m} minutes` : '1 hour', icon: 'clock', run: () => setSleep(m) })),
        { label: 'End of this song', icon: 'note', disabled: !currentTrack(), run: () => setSleep('end') },
        ...(on ? ['-', { label: 'Turn off', icon: 'off', run: () => { setSleep(0); toast('Sleep timer off'); } }] : []),
        '-', { label: 'Scheduled plays…', icon: 'clock', run: () => { closeNowView(); location.hash = '#/schedules'; } },
    ], { anchor, label: 'Sleep timer' });
}
function sleepButton(extra = '') { // drawn with its current state; paintSleep() keeps the countdown going
    const on = !!(SL.until || SL.endOfSong), left = sleepLeft();
    return html`<button type="button" class="icon-btn sleep-btn ${extra} ${on ? 'on' : ''}" data-action="sleep-menu" aria-haspopup="menu" title="Sleep timer"
        aria-label="${on ? `Sleep timer: ${SL.endOfSong ? 'at the end of this song' : `${left} left`}` : 'Sleep timer'}">${icon('moon', 18)}<span class="sleep-left">${on ? (SL.endOfSong ? 'End' : left) : ''}</span></button>`;
}

// ---------- scheduled plays ----------
// "Play Reanimation at 7:00 on weekdays." Schedules are stored on the server (schedules.py) and each one
// belongs to the device it was made on: this page checks every 15 s and starts the ones that are due here.
// The server's /fired claim makes each occurrence start once, even with two windows open. A page that
// isn't running can't play, so a phone has to have spotDLr on screen at that time (iOS freezes it otherwise).

const DEVICE_ID = (() => { let id = store.get('deviceId', null); if (!id) { id = Math.random().toString(36).slice(2, 12); store.set('deviceId', id); } return id; })();
const DEVICE_NAME = IOS ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && navigator.platform === 'MacIntel' ? 'iPad' : 'iPhone')
    : /Android/.test(navigator.userAgent) ? 'Android phone' : /Win/.test(navigator.platform) ? 'Windows PC' : /Mac/.test(navigator.platform) ? 'Mac' : 'This computer';
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SCH = { list: [], loaded: 0, timer: null };
const SCHEDULE_GRACE = 3 * 60_000; // start a schedule up to 3 minutes late (a sleeping laptop, a slow load), not later

const pad2 = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const weekdayMon0 = (d) => (d.getDay() + 6) % 7;

function repeatText(s) {
    const d = s.days;
    if (!d.length) return new Date(`${s.date}T${s.time}`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (d.length === 7) return 'Every day';
    if (d.join() === '0,1,2,3,4') return 'Weekdays';
    if (d.join() === '5,6') return 'Weekends';
    return d.map((i) => DAY_NAMES[i]).join(', ');
}
const timeText = (hhmm) => new Date(`2000-01-01T${hhmm}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// The occurrence due now ("2026-10-20T07:00"), if it started less than SCHEDULE_GRACE ago
function dueOccurrence(s, now = new Date()) {
    const today = localDate(now);
    if (s.days.length ? !s.days.includes(weekdayMon0(now)) : s.date !== today) return null;
    const at = new Date(`${today}T${s.time}`);
    const late = now - at;
    return late >= 0 && late < SCHEDULE_GRACE ? `${today}T${s.time}` : null;
}

async function loadSchedules() {
    try { SCH.list = (await api('/schedules')).schedules; SCH.loaded = Date.now(); } catch { /* next tick */ }
}

async function checkSchedules() {
    if (Date.now() - SCH.loaded > 60_000) await loadSchedules();
    for (const s of SCH.list) {
        if (!s.enabled || s.device !== DEVICE_ID) continue;
        const occurrence = dueOccurrence(s);
        if (!occurrence || s.last_run === occurrence) continue;
        let claim;
        try { claim = await api(`/schedules/${s.id}/fired`, { method: 'POST', body: JSON.stringify({ occurrence }) }); } catch { continue; }
        s.last_run = occurrence;
        if (claim.play) startScheduled(s);
    }
}

function startScheduled(s) {
    // A playlist or album plays as it is now (songs added since included); a song or a removed playlist as saved
    const c = s.what.kind === 'collection' && S.collections.find((x) => x.key === s.what.key);
    const ids = (c ? c.track_ids : s.what.kind === 'liked' ? S.likedOrder : s.what.ids).filter((id) => S.byId.has(id));
    if (!ids.length) { toast(`Scheduled play: nothing left to play in ${s.what.label}`, 'error'); return; }
    if (P.shuffle !== s.shuffle) toggleShuffle();
    endFade();
    P.wakeGain = s.fade_in && VOLUME_WORKS ? 0.05 : 1;
    playContext(ids, null, { key: s.what.key ? `${s.what.kind === 'collection' ? 'collection:' : ''}${s.what.key}` : `scheduled:${s.id}`, label: s.what.label, href: s.what.href });
    toast(`Scheduled play: ${s.what.label}`);
    if (P.wakeGain < 1) { // fade in over a minute
        const t0 = Date.now();
        clearInterval(SCH.fade);
        SCH.fade = setInterval(() => {
            P.wakeGain = Math.min(1, 0.05 + 0.95 * ((Date.now() - t0) / 60_000));
            applyVolume();
            if (P.wakeGain >= 1) clearInterval(SCH.fade);
        }, 500);
    }
}

function startScheduler() {
    clearInterval(SCH.timer);
    SCH.timer = setInterval(checkSchedules, 15_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSchedules(); });
    checkSchedules();
}

// When the browser refuses to start music without a tap (a page nobody has clicked yet), ask for one
function showTapToPlay(label) {
    $('#tapToPlay')?.remove();
    document.body.insertAdjacentHTML('beforeend', html`<div class="tap-to-play" id="tapToPlay" role="alert">
        <span>${icon('clock', 18)} ${label} is ready to play</span>
        <button type="button" class="pill-btn primary small">Play</button></div>`.s);
    const bar = $('#tapToPlay');
    $('button', bar).addEventListener('click', () => { P.audio.play().catch(() => {}); bar.remove(); });
}

// What a menu schedules: a song, or a playlist/album (Liked Songs included)
const whatForTrack = (t) => ({ kind: 'track', key: t.id, label: t.title, href: location.hash || '#/', ids: [t.id] });
const whatForCollection = (c) => ({ kind: 'collection', key: c.key, label: c.name, href: `#/collection/${encodeURIComponent(c.key)}`, ids: c.track_ids });
const whatForLiked = () => ({ kind: 'liked', key: 'liked', label: 'Liked Songs', href: '#/liked', ids: S.likedOrder });

function scheduleDialog(what, existing = null) {
    const now = new Date();
    const nextHour = `${pad2((now.getHours() + 1) % 24)}:00`;
    const s = existing || { time: nextHour, days: [], date: null, shuffle: false, fade_in: true };
    const presets = [['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['custom', 'Choose days']];
    const presetOf = (days) => !days.length ? 'once' : days.length === 7 ? 'daily' : days.join() === '0,1,2,3,4' ? 'weekdays' : days.join() === '5,6' ? 'weekends' : 'custom';
    const defaultDate = () => { const t = $('#schTime')?.value || s.time, d = new Date(); if (new Date(`${localDate(d)}T${t}`) <= d) d.setDate(d.getDate() + 1); return localDate(d); };
    openModal({
        title: existing ? 'Edit scheduled play' : 'Schedule play',
        body: html`<form id="schForm" class="dialog-form">
            <p class="dialog-note">Plays <strong>${what.label}</strong>${what.kind === 'track' ? '' : html` (${plural(what.ids.length, 'song')})`}.</p>
            <div class="sch-row">
                <label class="field"><span>Time</span><input class="field-input plain" type="time" id="schTime" value="${s.time}" required></label>
                <label class="field"><span>Repeat</span><select id="schRepeat">${presets.map(([k, label]) => html`<option value="${k}" ${presetOf(s.days) === k ? new Safe('selected') : ''}>${label}</option>`)}</select></label>
            </div>
            <label class="field" id="schDateField"><span>Date</span><input class="field-input plain" type="date" id="schDate" value="${s.date || defaultDate()}" min="${localDate(now)}"></label>
            <div class="sch-days" id="schDays" role="group" aria-label="Days">${DAY_NAMES.map((d, i) => html`<button type="button" class="chip ${s.days.includes(i) ? 'active' : ''}" data-day="${i}" aria-pressed="${String(s.days.includes(i))}">${d}</button>`)}</div>
            <label class="check"><input type="checkbox" id="schShuffle" ${s.shuffle ? new Safe('checked') : ''}> Shuffle</label>
            <label class="check"><input type="checkbox" id="schFade" ${s.fade_in && VOLUME_WORKS ? new Safe('checked') : ''} ${VOLUME_WORKS ? '' : new Safe('disabled')}> Start quietly and fade in over a minute${VOLUME_WORKS ? '' : ' (not on iPhone)'}</label>
            <p class="field-note">Plays on <strong>${existing ? existing.device_name || 'the device it was made on' : `this ${DEVICE_NAME}`}</strong>, if spotDLr is open there at that time.${IOS ? ' On iPhone it has to be on screen: iOS pauses web pages in the background.' : ''}</p>
            <p class="form-error" id="schError" hidden></p>
            <div class="modal-actions">${existing ? html`<button type="button" class="pill-btn" id="schDelete">Delete</button>` : ''}<button type="button" class="pill-btn" data-close>Cancel</button><button type="submit" class="pill-btn primary">${existing ? 'Save' : 'Schedule'}</button></div>
        </form>`,
        onOpen: (modal, close) => {
            const repeat = $('#schRepeat', modal), days = $('#schDays', modal), dateField = $('#schDateField', modal);
            const chosen = new Set(s.days);
            const sync = () => {
                const v = repeat.value;
                if (v === 'daily') [0, 1, 2, 3, 4, 5, 6].forEach((i) => chosen.add(i));
                if (v === 'weekdays') { chosen.clear(); [0, 1, 2, 3, 4].forEach((i) => chosen.add(i)); }
                if (v === 'weekends') { chosen.clear(); [5, 6].forEach((i) => chosen.add(i)); }
                if (v === 'once') chosen.clear();
                dateField.hidden = v !== 'once';
                days.hidden = v === 'once';
                $$('[data-day]', days).forEach((b) => { const on = chosen.has(+b.dataset.day); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
            };
            repeat.addEventListener('change', sync);
            days.addEventListener('click', (e) => {
                const b = e.target.closest('[data-day]');
                if (!b) return;
                const i = +b.dataset.day;
                if (chosen.has(i)) chosen.delete(i); else chosen.add(i);
                repeat.value = presetOf([...chosen].sort());
                if (repeat.value === 'once') repeat.value = 'custom'; // no days picked yet, but you're picking days
                sync();
            });
            sync();
            $('#schDelete', modal)?.addEventListener('click', async () => {
                try { await api(`/schedules/${existing.id}`, { method: 'DELETE' }); close(); toast('Scheduled play deleted'); await loadSchedules(); if (route().name === 'schedules') rerender(); }
                catch (err) { toast(err.message, 'error'); }
            });
            $('#schForm', modal).addEventListener('submit', async (e) => {
                e.preventDefault();
                const body = {
                    id: existing?.id, device: existing?.device || DEVICE_ID, device_name: existing?.device_name || DEVICE_NAME, what,
                    time: $('#schTime', modal).value, days: repeat.value === 'once' ? [] : [...chosen].sort(), date: repeat.value === 'once' ? $('#schDate', modal).value : null,
                    shuffle: $('#schShuffle', modal).checked, fade_in: $('#schFade', modal).checked, enabled: existing ? existing.enabled : true,
                };
                if (repeat.value !== 'once' && !body.days.length) { const err = $('#schError', modal); err.textContent = 'Pick at least one day'; err.hidden = false; return; }
                try {
                    const saved = await api('/schedules', { method: 'POST', body: JSON.stringify(body) });
                    close();
                    const when = repeatText(saved);
                    toast(`${what.label}: ${timeText(saved.time)}, ${['Every day', 'Weekdays', 'Weekends'].includes(when) ? when.toLowerCase() : when}`);
                    await loadSchedules();
                    if (route().name === 'schedules') rerender();
                } catch (err) { const el = $('#schError', modal); el.textContent = err.message; el.hidden = false; }
            });
        },
    });
}

async function viewSchedules() {
    await loadSchedules();
    const mine = (s) => s.device === DEVICE_ID;
    const list = [...SCH.list].sort((a, b) => (b.enabled - a.enabled) || a.time.localeCompare(b.time));
    return html`<div class="view-pad">
        <h1 class="greeting" style="margin-top:8px">Scheduled plays</h1>
        <p class="tidy-intro">Music that starts by itself, like an alarm. Add one from <b>⋯</b> on a song, album or playlist → <b>Schedule play</b>. It plays on the device it was made on, if spotDLr is open there at that time.</p>
        ${list.length ? html`<ul class="sch-list">${list.map((s) => html`
            <li class="sch-item ${s.enabled ? '' : 'off'}">
                <div class="sch-when"><span class="sch-time">${timeText(s.time)}</span><span class="sch-repeat">${repeatText(s)}</span></div>
                <div class="sch-what"><a href="${s.what.href}" class="title-name">${s.what.label}</a>
                    <span class="title-sub">${s.shuffle ? 'Shuffle · ' : ''}${s.fade_in ? 'Fades in · ' : ''}on ${mine(s) ? `this ${DEVICE_NAME}` : s.device_name || 'another device'}</span></div>
                <label class="switch" title="${s.enabled ? 'On' : 'Off'}"><input type="checkbox" data-sch-toggle="${s.id}" ${s.enabled ? new Safe('checked') : ''} aria-label="${s.what.label} at ${timeText(s.time)}"><span></span></label>
                <button type="button" class="icon-btn" data-sch-edit="${s.id}" aria-label="Edit">${icon('more', 18)}</button>
            </li>`)}</ul>`
        : html`<div class="empty stats-empty">${icon('clock', 40)}<h2>Nothing scheduled</h2><p>⋯ on a song, album or playlist → Schedule play.</p></div>`}
    </div>`;
}

// ---------- queue ----------
// A side panel, like Spotify's: Now playing, "Next in queue" (P.upNext, songs you added: drag to reorder,
// ✕ to remove) and "Next from <playlist>" (the rest of the context, in play order). Q opens and closes it.

const Q = { open: false, opener: null };
const QUEUE_SHOWN = 60; // rows of "Next from …": the rest of a 900-song shuffle isn't worth drawing

function addToQueue(ids, { next = false } = {}) {
    ids = ids.filter((id) => S.byId.has(id));
    if (!ids.length) return;
    if (remoteCommand('queue_add', { track_ids: ids, next })) return;
    if (!currentTrack()) { // nothing playing: start with these
        playContext(ids, 0, { key: 'queue', label: 'Your queue', href: location.hash || '#/' });
        return;
    }
    if (next) P.upNext.unshift(...ids); else P.upNext.push(...ids);
    toast(next ? (ids.length === 1 ? `${S.byId.get(ids[0]).title} plays next` : `${plural(ids.length, 'song')} play next`)
        : `Added ${ids.length === 1 ? S.byId.get(ids[0]).title : plural(ids.length, 'song')} to the queue`);
    queueChanged();
}

function queueChanged() {
    saveSession();
    renderQueue();
    renderNowView(); // its "Up next" line
}

function toggleQueue(open = !Q.open) {
    if (open && !Q.open) Q.opener = document.activeElement;
    Q.open = open;
    $('#queueBtn')?.setAttribute('aria-pressed', String(open));
    $('#queueBtn')?.classList.toggle('on', open);
    renderQueue();
    if (open) $('#queueRoot .queue-panel')?.focus();
    else if (Q.opener?.isConnected) Q.opener.focus();
}

function playFromQueue(row) {
    const i = +row.dataset.sortIndex;
    if (remoteCommand('queue_play', { kind: row.dataset.queueKind, index: i })) return;
    if (row.dataset.queueKind === 'user') { P.queued = P.upNext.splice(i, 1)[0]; }
    else { P.pos = i; P.queued = null; }
    loadAndPlay();
}

function queueRow(t, { kind, index }) {
    const now = kind === 'now';
    return html`<li class="queue-row ${now ? 'now' : ''}" data-queue-kind="${kind}" ${now ? '' : html`data-sort-index="${index}"`}>
        ${now ? html`<span class="queue-art">${trackArt(t)}${eq()}</span>`
            : html`<button type="button" class="queue-art" data-action="queue-play" aria-label="Play ${t.title}">${trackArt(t)}<span class="queue-play">${icon('play', 16)}</span></button>`}
        <span class="queue-text"><span class="title-name">${t.title}</span><span class="title-sub">${t.artists.join(', ')}</span></span>
        ${kind === 'user' ? html`<button type="button" class="icon-btn drag-handle" aria-label="Move ${t.title}: drag, or use the up and down arrow keys" title="Drag to reorder">${icon('grip', 16)}</button>
            <button type="button" class="icon-btn" data-action="queue-remove" aria-label="Remove ${t.title} from the queue">${icon('close', 14)}</button>` : ''}
    </li>`;
}

function renderQueue() {
    const root = $('#queueRoot');
    if (!root) return;
    if (!Q.open) { root.innerHTML = ''; return; }
    const t = currentTrack();
    const mine = P.upNext.map((id, i) => [S.byId.get(id), i]).filter(([x]) => x);
    const from = t ? P.pos + 1 : P.order.length;
    const rest = P.order.slice(from, from + QUEUE_SHOWN).map((qi, k) => [S.byId.get(P.queue[qi]), from + k]).filter(([x]) => x);
    const more = Math.max(0, P.order.length - from - QUEUE_SHOWN);
    const hadFocus = root.contains(document.activeElement);
    root.innerHTML = html`<aside class="queue-panel" role="dialog" aria-label="Queue" tabindex="-1">
        <div class="queue-head"><h2>Queue</h2><button type="button" class="icon-btn" data-action="queue-close" aria-label="Close the queue">${icon('close', 18)}</button></div>
        <div class="queue-body">
            ${t ? html`<h3 class="queue-h">Now playing</h3><ol class="queue-list">${queueRow(t, { kind: 'now' })}</ol>` : html`<p class="queue-empty">Nothing is playing.</p>`}
            ${mine.length ? html`<div class="queue-h-row"><h3 class="queue-h">Next in queue</h3><button type="button" class="link-btn" data-action="queue-clear">Clear queue</button></div>
                <ol class="queue-list" id="queueMine">${mine.map(([x, i]) => queueRow(x, { kind: 'user', index: i }))}</ol>` : ''}
            ${rest.length ? html`<h3 class="queue-h">Next from: ${P.context ? html`<a href="${P.context.href}">${P.context.label}</a>` : 'your songs'}</h3>
                <ol class="queue-list">${rest.map(([x, i]) => queueRow(x, { kind: 'context', index: i }))}</ol>
                ${more ? html`<p class="queue-more">and ${plural(more, 'more song')}</p>` : ''}` : ''}
            ${t && !mine.length && !rest.length ? html`<p class="queue-empty">Nothing after this song. Use ⋯ → <b>Add to queue</b> on any song.</p>` : ''}
        </div>
    </aside>`.s;
    const panel = $('.queue-panel', root);
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); toggleQueue(false); } });
    makeSortable('#queueMine', (a, b) => {
        if (remoteCommand('queue_move', { from: a, to: b })) return;
        P.upNext.splice(b, 0, ...P.upNext.splice(a, 1)); queueChanged();
    });
    if (hadFocus && !root.contains(document.activeElement)) panel.focus();
    markPlaying();
}

// Drag to reorder by a .drag-handle (mouse, touch or pen), or ↑/↓ on a focused handle. The items are the
// list's children, each with data-sort-index. onMove(from, to) changes the data and redraws; it may be async.
function makeSortable(selector, onMove) {
    const list = $(selector);
    if (!list) return;
    const items = () => [...list.children].filter((c) => c.matches('[data-sort-index]'));
    const refocus = (to) => requestAnimationFrame(() => $$(`${selector} > [data-sort-index]`)[to]?.querySelector('.drag-handle')?.focus());
    list.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle || e.button > 0) return;
        e.preventDefault();
        const item = handle.closest('[data-sort-index]');
        const from = items().indexOf(item);
        // Listen on window, not with pointer capture: moving the row in the DOM would release the capture
        item.classList.add('dragging');
        list.classList.add('sorting');
        const scroller = list.closest('.queue-body, .main');
        const move = (ev) => {
            const after = items().find((c) => c !== item && ev.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
            if (after !== item.nextElementSibling) list.insertBefore(item, after || null);
            if (scroller) { // scroll while dragging near the top or bottom edge
                const r = scroller.getBoundingClientRect();
                if (ev.clientY < r.top + 40) scroller.scrollTop -= 12; else if (ev.clientY > r.bottom - 40) scroller.scrollTop += 12;
            }
        };
        const done = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', done);
            window.removeEventListener('pointercancel', done);
            item.classList.remove('dragging');
            list.classList.remove('sorting');
            const to = items().indexOf(item);
            if (ev.type === 'pointerup' && to !== from) onMove(from, to);
            else if (to !== from) { const rest = items().filter((c) => c !== item); list.insertBefore(item, rest[from] || null); } // cancelled: put it back
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', done);
        window.addEventListener('pointercancel', done);
    });
    list.addEventListener('keydown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const from = items().indexOf(handle.closest('[data-sort-index]'));
        const to = from + (e.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= items().length) return;
        Promise.resolve(onMove(from, to)).then(() => refocus(to));
    });
}

// ---------- Now Playing view ----------
// Full view of the current song: info + genre on the left, a vertical feed of the previous / current / next
// covers in the middle (scroll, ↑/↓ or click to move), background tinted from the cover.

const NV = { open: false, opener: null, prevId: null, nextId: null, wheel: 0, wheelLock: 0, lyrics: store.get('nvLyrics', false), colors: new Map() };

// ---------- lyrics ----------
// /api/lyrics gives {lines: [{t, text}] | null, plain, instrumental}. While shown, a rAF loop finds the
// current line: the last one whose time has passed, by binary search (~6 steps for 60 lines), checked
// every frame because timeupdate only fires ~4x/s and would light lines up to 250 ms late.

const LYRICS_LEAD = 0.25;   // seconds early: a line should light up as it starts, not just after
const L = { data: new Map(), raf: 0, index: -2, userScrollUntil: 0 }; // data: track id -> {state, result|error}
const savingLyrics = new Set();

async function saveTrackLyrics(track) {
    if (savingLyrics.has(track.id)) return;
    savingLyrics.add(track.id);
    toast(`Looking up lyrics for ${track.title}…`);
    try {
        const result = await api(`/lyrics/${encodeURIComponent(track.id)}`, { method: 'POST' });
        const message = result.status === 'saved' ? `Lyrics saved beside ${track.title}`
            : result.status === 'existing' ? `${track.title} already has an .lrc file`
            : `No synced lyrics available for ${track.title}`;
        toast(message);
    } catch (error) { toast(`Couldn't save lyrics: ${error.message}`, 'error'); }
    finally { savingLyrics.delete(track.id); }
}

function fetchLyrics(trackId) {
    const known = L.data.get(trackId);
    if (known && known.state !== 'error') return;
    L.data.set(trackId, { state: 'loading' });
    api(`/lyrics/${encodeURIComponent(trackId)}`)
        .then((result) => L.data.set(trackId, { state: 'ok', result }))
        .catch((err) => L.data.set(trackId, { state: 'error', error: err.message }))
        .finally(() => { const t = currentTrack(); if (NV.open && NV.lyrics && t && t.id === trackId) fillLyrics(); });
}

function lyricsBody(trackId) {
    const entry = L.data.get(trackId);
    if (!entry || entry.state === 'loading') {
        return html`<div class="nv-lyrics-msg" aria-busy="true">${[70, 55, 80, 45, 65].map((w) => html`<div class="skeleton nv-lyrics-skel" style="width:${w}%"></div>`)}</div>`;
    }
    if (entry.state === 'error') {
        return html`<div class="nv-lyrics-msg"><p>Couldn't load lyrics. ${entry.error}</p><button class="pill-btn" data-lyrics-retry>Try again</button></div>`;
    }
    const r = entry.result;
    if (r.lines) {
        return html`<div class="nv-lines">${r.lines.map((line, i) => line.text
            ? html`<button class="nv-line" data-line="${i}" data-t="${line.t}" tabindex="-1">${line.text}</button>`
            : html`<div class="nv-line gap" data-line="${i}" aria-hidden="true">♪</div>`)}</div>
            <p class="nv-lyrics-credit">Lyrics from ${r.source === 'file' ? 'the song\'s .lrc file' : 'LRCLIB'}</p>`;
    }
    if (r.plain) {
        return html`<div class="nv-lines plain">${r.plain.split('\n').map((text) => html`<p class="nv-line">${text || '\u00a0'}</p>`)}</div>
            <p class="nv-lyrics-credit">Not time-synced • LRCLIB</p>`;
    }
    if (r.instrumental) return html`<div class="nv-lyrics-msg"><p class="big">♪ Instrumental</p></div>`;
    return html`<div class="nv-lyrics-msg"><p class="big">No lyrics for this song</p><p>LRCLIB doesn't have them yet.</p></div>`;
}

function fillLyrics() {
    const box = $('#nowRoot .nv-lyrics');
    const t = currentTrack();
    if (!box || !t) return;
    box.innerHTML = lyricsBody(t.id).toString();
    box.scrollTop = 0;
    L.index = -2;
    startLyrics();
}

// The last line with t <= now, or -1 before the first
function lineAt(lines, now) {
    let lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t <= now) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
}

function lyricsTick() {
    L.raf = 0;
    const t = currentTrack();
    const entry = t && L.data.get(t.id);
    const box = $('#nowRoot .nv-lyrics');
    if (!NV.open || !NV.lyrics || !box || !entry || entry.state !== 'ok' || !entry.result.lines || document.hidden) return;
    const index = lineAt(entry.result.lines, P.audio.currentTime + LYRICS_LEAD);
    if (index !== L.index) {
        L.index = index;
        $$('.nv-line[data-line]', box).forEach((el) => {
            const i = +el.dataset.line;
            el.classList.toggle('active', i === index);
            el.classList.toggle('past', i < index);
        });
        const active = index >= 0 && $(`.nv-line[data-line="${index}"]`, box);
        if (Date.now() > L.userScrollUntil) {
            // Keep the current line ~40% down the box, like Spotify
            const top = active ? active.offsetTop - box.clientHeight * 0.4 + active.offsetHeight / 2 : 0;
            box.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
        }
    }
    L.raf = requestAnimationFrame(lyricsTick);
}

function startLyrics() {
    if (!L.raf && NV.open && NV.lyrics) L.raf = requestAnimationFrame(lyricsTick);
}

function toggleLyrics() {
    NV.lyrics = !NV.lyrics;
    store.set('nvLyrics', NV.lyrics);
    NV.prevId = NV.nextId = null; // no slide animation for the swap
    renderNowView();
}

// ---------- visualizer ----------
// The <audio> element feeds an AnalyserNode, which hands us the sound as numbers 60 times a second:
// getByteFrequencyData = loudness (0-255) per frequency band, getByteTimeDomainData = the waveform itself.
// Works because songs stream from our own server; the browser zeroes the data for other-site audio.
// Once connected, ALL playback goes through the AudioContext, so it's created on a click (browsers start
// a context made without one suspended = silence) and resumed on every play.

const VIZ_MODES = [
    ['bars', 'Bars', 'bars'], ['wave', 'Wave', 'wave'], ['ring', 'Ring', 'ring'], ['particles', 'Particles', 'sparkle'],
    ['vinyl', 'Vinyl', 'vinyl'], ['retro', 'Retro', 'sun'], ['cassette', 'Cassette', 'cassette'], ['off', 'Off', 'off'],
];
const VIZ = Object.fromEntries(VIZ_MODES.map(([key, label, iconName]) => [key, { label, icon: iconName }]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const V = {
    mode: store.get('vizMode', reducedMotion.matches ? 'off' : 'bars'),
    ctx: null, analyser: null, freq: null, wave: null,
    canvas: null, raf: 0, color: [83, 83, 83], bands: {}, last: 0, drawLast: 0,
    smooth: { bass: 0, treble: 0, level: 0 },
    particles: null, stars: null, rotation: 0, arm: null, ridge: null, cover: null, // per-mode state
};
if (!VIZ[V.mode]) V.mode = 'bars';
V.analysis = store.get('analysis', 'clone'); // default clone: live players never touch Web Audio, a silent twin feeds the visualizer

// One MediaElementSource per element, kept for the session (creating a second one throws).
function audioSource(el) {
    if (!V.elemSources) V.elemSources = new Map();
    let s = V.elemSources.get(el);
    if (!s) { s = V.ctx.createMediaElementSource(el); V.elemSources.set(el, s); }
    else { try { s.disconnect(); } catch {} } // re-seat: never double-connect
    return s;
}

// Tap mode: both players go straight to the speakers; the analyser is a side-tap that never
// touches the output path (some devices attenuate when analysis sits inline). Paused players
// contribute silence, so both connections are permanent — no rewiring on song swaps.
function buildTap() {
    stopClone();
    const a = audioSource(P.audio), x = audioSource(XF.el);
    try { V.analyser.disconnect(); } catch {}
    try { xfVolume.disconnect(); } catch {} // orphaned crossfade tail must not double through the old chain
    graphVolume = null; xfVolume = null; // stale gains must not hijack applyVolume
    a.connect(V.analyser);
    x.connect(V.analyser);
}

// Clone mode: the live players are never touched — they play straight to the speakers — and a
// hidden twin of the same song feeds the analyser, its own output killed by a zero gain, so the
// Web Audio path can't change what you hear (some phones quietly attenuate it).
function buildClone() {
    graphVolume = null; xfVolume = null; // stale gains must not hijack applyVolume
    try { V.analyser.disconnect(); } catch {}
    // createMediaElementSource is a one-way door: a player that was ever routed has no path back
    // to the speakers on its own. Re-seat it on the destination (straight out, no processing)
    // instead of stranding it; a fresh page load never routes the players at all.
    if (V.elemSources) V.elemSources.forEach((src) => { try { src.disconnect(); src.connect(V.ctx.destination); } catch {} });
    if (!V.cloneEl) {
        V.cloneEl = new Audio();
        V.cloneEl.preload = 'auto';
        V.cloneSrc = V.ctx.createMediaElementSource(V.cloneEl); // one source node per element, for the session
        V.cloneZero = V.ctx.createGain();
        V.cloneZero.gain.value = 0;
        V.cloneSrc.connect(V.cloneZero);
        V.cloneZero.connect(V.ctx.destination); // silence: the device never plays the twin
        V.cloneSrc.connect(V.analyser);
    }
    if (V.cloneEl.src !== P.audio.src) V.cloneEl.src = P.audio.src;
    if (!V.cloneTick) {
        V.cloneTick = setInterval(() => {
            const live = P.audio;
            if (document.hidden) { if (!V.cloneEl.paused) V.cloneEl.pause(); return; } // battery: idle with the screen off
            if (!live.src || !V.cloneEl) return;
            if (V.cloneEl.src !== live.src) V.cloneEl.src = live.src;
            if (live.paused) { if (!V.cloneEl.paused) V.cloneEl.pause(); return; }
            if (V.cloneEl.paused) V.cloneEl.play().catch(() => {});
            else if (Math.abs(V.cloneEl.currentTime - live.currentTime) > 0.3) {
                try { V.cloneEl.currentTime = live.currentTime; } catch { /* seeking mid-load */ }
            }
        }, 500);
    }
}

function stopClone() {
    if (V.cloneTick) { clearInterval(V.cloneTick); V.cloneTick = null; }
    if (V.cloneEl) { try { V.cloneEl.pause(); V.cloneEl.removeAttribute('src'); } catch {} }
}

function setAnalysis(mode) {
    V.analysis = mode === 'clone' ? 'clone' : 'tap';
    store.set('analysis', V.analysis);
    stopClone();
    if (!V.ctx) return;
    try { V.analyser && V.analyser.disconnect(); } catch {}
    if (V.elemSources) V.elemSources.forEach((src) => { try { src.disconnect(); src.connect(V.ctx.destination); } catch {} }); // never strand a routed player
    V.sources = null; V.meters = null; V.wireMode = null;
    graphVolume = null; xfVolume = null;
    applyVolume();
    ensureAudioGraph(); // rebuild immediately when the visualizer is up
    toast(V.analysis === 'clone' ? 'Direct sound + silent-twin analysis on.' : 'Side-tap analysis on.');
}

// Full graph: analyser feeds the effects chain instead of the speakers directly.
function buildFull() {
    stopClone(); // effects take over the real signal; the twin has no job here
    try { V.analyser.disconnect(); } catch {}
    try { xfVolume.disconnect(); } catch {}
    const a = audioSource(P.audio), x = audioSource(XF.el);
    // Then left and right apart, each through its own meter (the Hi-Fi Deck's VU needles), and back together.
    // Through a 2-channel gain first: a splitter takes channels as they come, so a mono song would light the
    // left needle only (and, through the balance below, play from the left speaker only).
    const stereo = twoChannels(V.ctx), split = V.ctx.createChannelSplitter(2), merge = V.ctx.createChannelMerger(2);
    V.analyser.connect(stereo);
    a.connect(V.analyser);
    stereo.connect(split);
    V.meters = [0, 1].map((side) => {
        const meter = V.ctx.createAnalyser();
        meter.fftSize = 1024;                  // 23 ms of sound per reading
        split.connect(meter, side);
        meter.connect(merge, 0, side);
        return { meter, samples: new Float32Array(meter.fftSize) };
    });
    graphVolume = V.ctx.createGain();          // the volume, from here on (see applyVolume)
    merge.connect(graphVolume);
    // The crossfade's second player joins here, so the song fading out gets the effects too
    xfVolume = V.ctx.createGain();
    V.sources = new Map([[P.audio, a], [XF.el, x]]);
    x.connect(xfVolume);
    const bus = twoChannels(V.ctx);
    graphVolume.connect(bus);
    xfVolume.connect(bus);
    buildSound(V.ctx, bus);                    // equalizer, reverb, balance, and on to the speakers
}

function ensureAudioGraph() {
    // Visualizations never touch the live players' path (clone mode: a silent twin feeds the
    // analyser); the full graph is only built when an effect is actually in use.
    const want = soundInUse() ? 'full' : (V.analysis === 'clone' ? 'clone' : 'tap');
    if (V.analyser && V.wireMode === want) return true;
    if (IOS) { // never route the music through Web Audio here: it would stop when the screen locks
        V.ctx = { sampleRate: 44100, state: 'running', resume() {} };
        V.analyser = syntheticAnalyser();
        V.freq = new Uint8Array(1024);
        V.wave = new Uint8Array(2048);
        V.generated = true;
        return true;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
        if (!V.ctx) {
            V.ctx = new AudioCtx();
            V.analyser = V.ctx.createAnalyser();
            V.analyser.fftSize = 2048;               // 1024 frequency bins, each sampleRate/2048 ≈ 21.5 Hz wide
            V.analyser.smoothingTimeConstant = 0.8;  // blend 80% of the last frame in, so bars fall smoothly
            for (const el of [P.audio, XF.el]) el.addEventListener('play', () => V.ctx.state === 'suspended' && V.ctx.resume());
            if (!V.kickArmed) { // contexts built outside a gesture start suspended: wake on the next one
                V.kickArmed = true;
                const kick = () => { try { if (V.ctx && V.ctx.state === 'suspended') V.ctx.resume().catch(() => {}); } catch {} };
                ['pointerdown', 'pointerup', 'keydown', 'touchend'].forEach((t) => document.addEventListener(t, kick, true));
                kick();
            }
        }
        if (!soundInUse()) {
            if (V.analysis === 'clone') buildClone(); else buildTap();
            V.sources = null; V.meters = null;
            V.wireMode = V.analysis === 'clone' ? 'clone' : 'tap';
        } else {
            buildFull();
            V.wireMode = 'full';
        }
        applyVolume();
        applySound();
        V.freq = new Uint8Array(V.analyser.frequencyBinCount);
        V.wave = new Uint8Array(V.analyser.fftSize);
        return true;
    } catch { return false; }
}

// iPhone: no access to the real sound, so a generated stand-in with the same interface: a spectrum shaped
// like typical music (loud bass, falling off towards treble) moving on slow waves plus a 120 BPM pulse, and a
// matching waveform. It eases to silence when paused. The visualizer menu says it's generated.
function syntheticAnalyser() {
    const phase = Array.from({ length: 24 }, () => Math.random() * Math.PI * 2);
    let level = 0;
    return {
        frequencyBinCount: 1024, fftSize: 2048,
        getByteFrequencyData(out) {
            const t = performance.now() / 1000;
            level += ((P.audio.paused ? 0 : 1) - level) * 0.08;
            const beat = Math.max(0, Math.cos(t * Math.PI * 4)) ** 6; // 2 beats per second
            for (let k = 0; k < out.length; k++) {
                const band = Math.min(23, Math.floor(Math.log2(k + 2) * 2.4));
                const drift = 0.65 + 0.35 * Math.sin(t * (0.7 + band * 0.13) + phase[band]);
                const shape = 235 * Math.exp(-k / 220) + 40 * Math.exp(-k / 900);
                const kick = k < 12 ? 70 * beat : 0;
                out[k] = Math.min(255, Math.max(0, (shape * drift + kick) * level));
            }
        },
        getByteTimeDomainData(out) {
            const t = performance.now() / 1000;
            for (let i = 0; i < out.length; i++) {
                const x = i / out.length;
                const v = Math.sin(x * 40 + t * 9) * 0.5 + Math.sin(x * 97 - t * 13) * 0.3 + Math.sin(x * 11 + t * 3) * 0.2;
                out[i] = 128 + v * 60 * level;
            }
        },
    };
}

// Bars on a log scale, like hearing: 30 Hz to 16 kHz in equal *ratios*. Linear bins would give the bass
// (where most of the energy is) 3 bars and spend 50 on hiss. Returns [firstBin, lastBin] per bar.
function vizBands(count, sampleRate) {
    const binHz = sampleRate / 2048;
    const bands = [];
    for (let i = 0; i < count; i++) {
        const lo = 30 * Math.pow(16000 / 30, i / count);
        const hi = 30 * Math.pow(16000 / 30, (i + 1) / count);
        const first = Math.floor(lo / binHz);
        bands.push([first, Math.max(first, Math.floor(hi / binHz))]);
    }
    return bands;
}

function setVizColor(css) {
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(css || '');
    V.color = m ? [+m[1], +m[2], +m[3]] : [83, 83, 83];
}

const bandsFor = (count) => V.bands[count] || (V.bands[count] = vizBands(count, V.ctx.sampleRate));
// Loudness 0-1 of each log-spaced band: its loudest bin
function bandLevels(count) {
    return bandsFor(count).map(([first, last]) => {
        let peak = 0;
        for (let k = first; k <= last; k++) peak = Math.max(peak, V.freq[k]);
        return peak / 255;
    });
}
const binAverage = (from, to) => { let sum = 0; for (let k = from; k <= to; k++) sum += V.freq[k]; return sum / ((to - from + 1) * 255); };
const lerp = (a, b, t) => a + (b - a) * t;
const tint = (alpha, lift = 0.55) => { const [r, g, b] = V.color.map((c) => Math.round(c + (255 - c) * lift)); return `rgba(${r}, ${g}, ${b}, ${alpha})`; };

// Each mode draws one frame onto the full-panel canvas. f = { w, h, dt, now, bass, treble, level, card, playing }
// card = the current cover's box inside the panel ({ x, y, size, cx, cy }), so Ring and Vinyl follow it as it slides.
const VIZ_DRAW = {
    bars(g, f) {
        // On a phone the title, ♥ and progress sit at the bottom, right where the bars grow: keep them low and faint there
        const compact = f.w < 700 || f.h < 500;
        const levels = bandLevels(compact ? 40 : 64), stripH = f.h * (compact ? 0.14 : 0.32), gap = 3, barW = (f.w - gap * (levels.length - 1)) / levels.length;
        levels.forEach((v, i) => {
            const barH = Math.max(2, v * v * stripH);      // squared: quiet stays low, loud jumps out
            g.fillStyle = tint((0.14 + 0.36 * v) * (NV.lyrics ? 0.6 : 1) * (compact ? 0.7 : 1)); // faint enough that white text on top stays readable
            g.beginPath();
            g.roundRect(i * (barW + gap), f.h - barH, barW, barH, [3, 3, 0, 0]);
            g.fill();
        });
    },
    wave(g, f) {
        V.analyser.getByteTimeDomainData(V.wave);          // 2048 samples, 128 = silence
        // Every 8th sample: 256 points is smoother than 2048 (~2 per pixel, jagged) and ⅛ of the work
        const compact = f.w < 700 || f.h < 500; // phones: a thin line along the bottom, under the song info
        const points = V.wave.length / 8, step = f.w / (points - 1), mid = f.h * (compact ? 0.93 : 0.8), amp = f.h * (compact ? 0.05 : 0.18);
        g.lineWidth = 2;
        g.strokeStyle = tint(NV.lyrics ? 0.5 : 0.85);
        g.beginPath();
        for (let i = 0; i < points; i++) {
            const y = mid + ((V.wave[i * 8] - 128) / 128) * amp;
            i ? g.lineTo(i * step, y) : g.moveTo(0, y);
        }
        g.stroke();
    },
    // The spectrum bent into a circle around the (now round) cover, mirrored left/right so it's symmetric:
    // bass at the top, treble meeting at the bottom.
    ring(g, f) {
        if (!f.card) return;
        const levels = bandLevels(48), inner = f.card.size / 2 + 10, maxLen = f.card.size * 0.2;
        g.lineCap = 'round';
        g.lineWidth = Math.max(2, f.card.size * 0.012);
        for (let side = -1; side <= 1; side += 2) {
            levels.forEach((v, i) => {
                const angle = -Math.PI / 2 + side * (i + 0.5) * (Math.PI / 48);
                const len = 3 + v * v * maxLen;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                g.strokeStyle = tint(0.35 + 0.6 * v);
                g.beginPath();
                g.moveTo(f.card.cx + cos * inner, f.card.cy + sin * inner);
                g.lineTo(f.card.cx + cos * (inner + len), f.card.cy + sin * (inner + len));
                g.stroke();
            });
        }
        // A soft glow behind the cover that swells with the bass
        const glow = g.createRadialGradient(f.card.cx, f.card.cy, inner * 0.8, f.card.cx, f.card.cy, inner + maxLen * (0.6 + f.bass));
        glow.addColorStop(0, tint(0.25 * f.bass + 0.05, 0.3));
        glow.addColorStop(1, tint(0, 0.3));
        g.fillStyle = glow;
        g.fillRect(0, 0, f.w, f.h);
    },
    // From VYBE: drifting dots. Bass = faster and bigger, treble = brighter, overall loudness = more opaque.
    particles(g, f) {
        if (!V.particles) {
            V.particles = Array.from({ length: 700 }, () => ({
                x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.04, vy: (Math.random() - 0.5) * 0.04, size: 0.6 + Math.random() * 1.4,
            }));
        }
        const speed = (0.3 + f.bass * 2.4) * f.dt, grow = 1 + f.bass * 1.6;
        const alpha = Math.min(1, (0.35 + f.treble * 0.65) * (0.5 + f.level * 0.8) + 0.1);
        g.fillStyle = tint(Math.min(0.75, alpha), 0.4);
        g.beginPath();
        for (const p of V.particles) {
            p.x = (p.x + p.vx * speed + 1) % 1;            // wrap around the edges
            p.y = (p.y + p.vy * speed + 1) % 1;
            const r = p.size * grow;
            g.moveTo(p.x * f.w + r, p.y * f.h);
            g.arc(p.x * f.w, p.y * f.h, r, 0, Math.PI * 2);
        }
        g.fill();                                         // one fill for all dots: ~1 draw call instead of 700
    },
    // From VYBE: a record at real 33⅓ RPM with the cover as its label; the tonearm swings off when paused.
    vinyl(g, f) {
        if (!f.card) return;
        const { cx, cy } = f.card, R = f.card.size / 2;
        if (f.playing) V.rotation += (33.333 / 60) * Math.PI * 2 * f.dt; // revolutions/s → radians this frame
        const glowR = R * (1.12 + f.bass * 0.25);
        const glow = g.createRadialGradient(cx, cy, R * 0.7, cx, cy, glowR);
        glow.addColorStop(0, tint(0.2 + f.bass * 0.35, 0.3));
        glow.addColorStop(1, tint(0, 0.3));
        g.fillStyle = glow;
        g.beginPath(); g.arc(cx, cy, glowR, 0, Math.PI * 2); g.fill();

        g.save();
        g.translate(cx, cy);
        g.rotate(V.rotation);
        g.fillStyle = '#0b0b0e';
        g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
        for (let i = 0; i < 26; i++) {                     // grooves
            g.strokeStyle = i % 4 === 0 ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.04)';
            g.lineWidth = 1;
            g.beginPath(); g.arc(0, 0, R * (0.36 + (i / 26) * 0.6), 0, Math.PI * 2); g.stroke();
        }
        const sheen = g.createLinearGradient(-R, -R, R, R);
        sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.48, 'rgba(255,255,255,.06)');
        sheen.addColorStop(0.52, 'rgba(255,255,255,.06)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sheen;
        g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
        const label = R * 0.36;
        g.save();
        g.beginPath(); g.arc(0, 0, label, 0, Math.PI * 2); g.clip();
        if (V.cover && V.cover.complete && V.cover.naturalWidth) {
            const side = Math.min(V.cover.naturalWidth, V.cover.naturalHeight); // centre-crop, like object-fit: cover
            g.drawImage(V.cover, (V.cover.naturalWidth - side) / 2, (V.cover.naturalHeight - side) / 2, side, side, -label, -label, label * 2, label * 2);
        } else { g.fillStyle = tint(1, 0); g.fillRect(-label, -label, label * 2, label * 2); }
        g.restore();
        g.fillStyle = '#050507';
        g.beginPath(); g.arc(0, 0, R * 0.025, 0, Math.PI * 2); g.fill();
        g.restore();

        // Tonearm: aimed at a real point on the record (not guessed), easing between playing and resting
        const pivotX = cx + R * 1.08, pivotY = cy - R * 1.02;
        const tipX = cx + Math.cos(-0.85) * R * 0.75, tipY = cy + Math.sin(-0.85) * R * 0.75;
        const armLen = Math.hypot(tipX - pivotX, tipY - pivotY), playAngle = Math.atan2(tipY - pivotY, tipX - pivotX);
        V.arm = lerp(V.arm ?? playAngle - 1.15, f.playing ? playAngle : playAngle - 1.15, Math.min(1, f.dt * 3));
        const armW = Math.max(2, R * 0.03);
        g.save();
        g.translate(pivotX, pivotY);
        g.rotate(V.arm);
        g.strokeStyle = '#d8d8de'; g.lineWidth = armW; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, 0); g.lineTo(armLen, 0); g.stroke();
        g.fillStyle = '#c9c9d2'; g.fillRect(armLen - armW * 1.6, -armW * 0.9, armW * 3.2, armW * 1.8);
        g.fillStyle = '#2a2a32'; g.beginPath(); g.arc(0, 0, armW * 1.8, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c9c9d2'; g.beginPath(); g.arc(0, 0, armW * 0.6, 0, Math.PI * 2); g.fill();
        g.restore();
    },
    // From VYBE: synthwave. Starfield, a striped sun, a scrolling perspective grid, and the spectrum as a
    // mountain range mirrored from the centre (bass at the edges), so both sides rise together.
    retro(g, f) {
        const horizon = f.h * 0.66, cx = f.w / 2;
        const sky = g.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, '#0c0616'); sky.addColorStop(1, '#1b0a2e');
        g.fillStyle = sky; g.fillRect(0, 0, f.w, horizon);
        const ground = g.createLinearGradient(0, horizon, 0, f.h);
        ground.addColorStop(0, '#170a28'); ground.addColorStop(1, '#040207');
        g.fillStyle = ground; g.fillRect(0, horizon, f.w, f.h - horizon);
        if (!V.stars) V.stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.3, phase: Math.random() * 6.28 }));
        const t = f.now / 1000;
        g.fillStyle = '#ffe3f7';
        for (const star of V.stars) {
            g.globalAlpha = 0.25 + 0.3 * (1 + Math.sin(t * 1.4 + star.phase));
            g.beginPath(); g.arc(star.x * f.w, star.y * horizon, star.r, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        const sunR = f.h * 0.17;
        g.save();
        g.beginPath(); g.arc(cx, horizon, sunR, 0, Math.PI * 2); g.clip();
        const sun = g.createLinearGradient(0, horizon - sunR, 0, horizon + sunR);
        sun.addColorStop(0, '#ffd23f'); sun.addColorStop(0.5, '#ff7a3d'); sun.addColorStop(1, '#ff2f8f');
        g.fillStyle = sun; g.fillRect(cx - sunR, horizon - sunR, sunR * 2, sunR * 2);
        g.fillStyle = '#1b0a2e';
        for (let y = horizon - sunR * 0.05, gap = sunR * 0.05; y < horizon + sunR; y += gap, gap *= 1.22) g.fillRect(cx - sunR, y, sunR * 2, gap * 0.6);
        g.restore();
        g.strokeStyle = 'rgba(255, 90, 210, .35)'; g.lineWidth = 1;
        for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo(cx, horizon); g.lineTo(f.w * (i / 16 - 0.5) * 2.6 + cx, f.h); g.stroke(); }
        const scroll = (t * 0.12) % 1;
        for (let i = 0; i <= 14; i++) {
            const k = ((i + scroll) / 14) % 1, y = horizon + (f.h - horizon) * k ** 1.9;
            g.globalAlpha = 0.15 + (1 - k) * 0.1;
            g.beginPath(); g.moveTo(0, y); g.lineTo(f.w, y); g.stroke();
        }
        g.globalAlpha = 1;
        // Mountains: 36 log bands, eased, bass at the outer edge, mirrored onto the right half
        const levels = bandLevels(36);
        V.ridge = V.ridge || new Float32Array(36);
        levels.forEach((v, i) => { V.ridge[i] = lerp(V.ridge[i], v, Math.min(1, f.dt * 12)); });
        const half = f.w / 2, step = half / 36, peak = f.h * 0.3;
        const pts = Array.from(V.ridge, (v, i) => ({ x: i * step + step / 2, y: horizon - v * peak }));
        pts.push({ x: half, y: pts[35].y });
        const trace = () => {
            g.moveTo(0, horizon); g.lineTo(pts[0].x, pts[0].y);
            for (let i = 0; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
            for (let i = pts.length - 1; i > 0; i--) g.quadraticCurveTo(f.w - pts[i].x, pts[i].y, f.w - (pts[i].x + pts[i - 1].x) / 2, (pts[i].y + pts[i - 1].y) / 2);
            g.lineTo(f.w - pts[0].x, pts[0].y); g.lineTo(f.w, horizon);
        };
        g.save();
        g.shadowColor = 'rgba(255, 47, 200, .65)'; g.shadowBlur = 18;
        g.beginPath(); trace(); g.closePath();
        const fill = g.createLinearGradient(0, horizon - peak, 0, horizon);
        fill.addColorStop(0, '#ff2fd0'); fill.addColorStop(0.55, '#ff4d7a'); fill.addColorStop(1, '#ff9a3d');
        g.fillStyle = fill; g.fill();
        g.restore();
        g.beginPath(); trace();
        g.strokeStyle = 'rgba(255, 220, 245, .8)'; g.lineWidth = 1.5; g.stroke();
    },
    // A deck from a photo; nothing on the canvas (see cassetteFrame)
    cassette(g, f) { cassetteFrame(f); },
};
const PULSE_MODES = new Set(['bars', 'wave', 'ring', 'particles', 'retro']); // Vinyl replaces the cover; no pulse

function vizFrame(now) {
    V.raf = 0;
    if (!NV.open || V.mode === 'off' || !V.analyser || document.hidden) {
        if (V.cloneTick && (!NV.open || V.mode === 'off')) stopClone();
        return;
    }
    const frameMs = 1000 / (V.mode === 'cassette' ? 24 : 30);
    if (V.drawLast && now - V.drawLast < frameMs) { V.raf = requestAnimationFrame(vizFrame); return; }
    V.drawLast = now;
    const canvas = V.canvas, section = canvas.parentElement;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const drawsCanvas = V.mode !== 'cassette';
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (drawsCanvas && (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    } else if (!drawsCanvas && (canvas.width !== 1 || canvas.height !== 1)) {
        canvas.width = canvas.height = 1; // the cassette is DOM-based; release the full-window canvas backing store
    }
    const g = drawsCanvas ? canvas.getContext('2d') : null;
    if (g) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
    }

    V.analyser.getByteFrequencyData(V.freq);
    const dt = Math.min(0.1, (now - (V.last || now)) / 1000); // seconds since last frame, so speed doesn't depend on refresh rate
    V.last = now;
    // bins 2-6 ≈ 43-150 Hz (kick, bass); 140-460 ≈ 3-10 kHz (hi-hats, sibilance); eased so they don't flicker
    V.smooth.bass = lerp(V.smooth.bass, binAverage(2, 6), 0.35);
    V.smooth.treble = lerp(V.smooth.treble, binAverage(140, 460), 0.25);
    V.smooth.level = lerp(V.smooth.level, binAverage(0, 511), 0.2);

    const cardEl = drawsCanvas ? $('.nv-card.current', section) : null;
    let card = null;
    if (cardEl) {
        const a = cardEl.getBoundingClientRect(), b = section.getBoundingClientRect();
        const size = cardEl.offsetWidth;                  // unscaled size: the pulse shouldn't feed back into the ring
        card = { size, cx: a.left - b.left + a.width / 2, cy: a.top - b.top + a.height / 2 };
    }
    const bass = V.smooth.bass;
    VIZ_DRAW[V.mode](g, { w, h, dt, now, bass, treble: V.smooth.treble, level: V.smooth.level, card, playing: !P.audio.paused });
    if (cardEl) cardEl.style.transform = PULSE_MODES.has(V.mode) && !reducedMotion.matches ? `scale(${1 + 0.035 * bass * bass})` : '';
    V.raf = requestAnimationFrame(vizFrame);
}

function startViz() {
    if (V.raf || !NV.open || V.mode === 'off' || !ensureAudioGraph()) return;
    if (V.ctx.state === 'suspended') V.ctx.resume();
    V.last = V.drawLast = 0;
    V.raf = requestAnimationFrame(vizFrame);
}

function stopViz() {
    cancelAnimationFrame(V.raf);
    V.raf = 0;
    if (V.canvas) V.canvas.getContext('2d').clearRect(0, 0, V.canvas.width, V.canvas.height);
    const cover = $('#nowRoot .nv-card.current');
    if (cover) cover.style.transform = '';
}

function setVizMode(mode) {
    if (!VIZ[mode]) return;
    const was = V.mode;
    V.mode = mode;
    store.set('vizMode', mode);
    if ((mode === 'cassette') !== (was === 'cassette') && NV.open && !NV.lyrics) {
        // The deck replaces the whole view rather than drawing behind it
        const refocus = $('#nowRoot .nv')?.contains(document.activeElement);
        renderNowView();
        if (refocus) $('#nowRoot [data-nv-viz]').focus();
    }
    const section = $('#nowRoot .nv');
    if (section) section.dataset.viz = mode;               // CSS: round cover for Ring, hidden cover for Vinyl
    const btn = $('#nowRoot [data-nv-viz]');
    if (btn) { btn.innerHTML = vizButtonInner().s; btn.classList.toggle('on', mode !== 'off'); }
    $$('#nowRoot [data-viz-option]').forEach((item) => item.setAttribute('aria-checked', item.dataset.vizOption === mode));
    stopViz();
    startViz();
}
const cycleVizMode = () => setVizMode(VIZ_MODES[(VIZ_MODES.findIndex(([k]) => k === V.mode) + 1) % VIZ_MODES.length][0]);
const vizButtonInner = () => html`${icon(VIZ[V.mode].icon, 16)}<span>${VIZ[V.mode].label}</span>${icon('down', 14, 'chev')}`;
const vizMenu = () => html`<div class="nv-viz-menu" role="menu" aria-label="Visualizer" hidden>
    ${IOS ? html`<p class="nv-viz-note" role="note">On iPhone these follow a generated pattern, not the song: Safari stops music that visualizers listen to when the screen locks.</p>` : ''}
    ${VIZ_MODES.map(([key, label, iconName]) => html`<button role="menuitemradio" aria-checked="${String(key === V.mode)}" data-viz-option="${key}" tabindex="-1">${icon(iconName, 16)}<span>${label}</span>${icon('checkPlain', 16, 'tick')}</button>`)}
</div>`;

// Dropdown: button toggles, ↑/↓ move, Enter/Space pick, Esc/Tab/click-outside close (Esc here doesn't close the view)
function vizMenuOpen() { const m = $('#nowRoot .nv-viz-menu'); return !!m && !m.hidden; }
function openVizMenu(focusCurrent = true) {
    const menu = $('#nowRoot .nv-viz-menu'), btn = $('#nowRoot [data-nv-viz]');
    if (!menu) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (focusCurrent) ($('[aria-checked="true"]', menu) || $('[data-viz-option]', menu)).focus();
}
function closeVizMenu(returnFocus = true) {
    const menu = $('#nowRoot .nv-viz-menu'), btn = $('#nowRoot [data-nv-viz]');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
}

// ---------- cassette ----------
// A deck from a photo (static/cassette/): the portable on small screens, the Hi-Fi Deck otherwise. The photos
// have their moving parts painted out; the reels, tape, needles, knob pointers, screens and the lit PLAY button
// are put back on top, placed in the photo's own pixels (DECKS), and the whole deck is scaled to fit. The
// portable was drawn for a phone held upright, on its side: turn the phone and it stands up.

const CASSETTE_SMALL = matchMedia('(max-width: 600px), (max-height: 500px)');
const DECKS = {
    portable: {
        w: 1672, h: 941, plate: 'portable.webp', lit: { play: [436, 8, 242, 90], pause: [700, 8, 237, 90], stop: [960, 8, 235, 90] },
        hub: 100, full: 280, reels: [[532, 474], [1105, 474]], tape: [632, 392, 371, 164],
        buttons: [['rew', 185, 10, 225, 86], ['play', 436, 10, 242, 86], ['pause', 700, 10, 237, 86], ['stop', 960, 10, 235, 86], ['ff', 1215, 10, 217, 86]],
        power: [1548, 478, 80, 96],
    },
    hifi: {
        w: 1672, h: 595, plate: 'deck.webp', lit: { play: [362, 423, 115, 80], pause: [482, 423, 107, 80], stop: [247, 423, 110, 80] }, maxScale: 1.25,
        hub: 40, full: 95, reels: [[328, 252], [523, 252]], tape: [232, 190, 390, 140],
        buttons: [['rew', 133, 425, 107, 75], ['stop', 248, 425, 107, 75], ['play', 363, 425, 112, 75], ['pause', 483, 425, 104, 75], ['ff', 595, 425, 110, 75]],
        power: [1458, 462, 64, 50],
    },
};
const DECK_BUTTONS = {
    rew: 'Rewind: previous song, hold to wind back', play: 'Play', pause: 'Pause', stop: 'Stop',
    ff: 'Fast-forward: next song, hold to wind on',
};
const DECK_LOCKED = { volume: 'On iPhone and iPad, use the volume buttons on the side', balance: "Balance isn't available on iPhone and iPad" };
const CS = {
    kind: null, stage: null, deck: null, el: null, scale: 1, turn: false, flip: store.get('cassetteFlip', false), ui: {},
    radius: [0, 0], angle: [0, 0], needle: [0, 0], swing: [0, 0], leds: [], wind: null, held: false, holdTimer: 0,
};

// The VU scale as printed, measured off the photo: [VU, needle angle in degrees from upright]. A real meter's
// marks are spaced by voltage (0 at 71% of the arc); this drawn face spaces them more evenly, and the needle
// has to agree with the print, so it follows these marks rather than the formula.
const VU_MARKS = [[-20, -23.5], [-10, -14.6], [-7, -7.7], [-5, 0], [-3, 7.8], [0, 16.5], [3, 26.6]];
const VU_REST = -25.8, VU_PIN = 28.5; // the needle's two stops
function vuAngle(vu) {
    if (vu <= -20) return VU_REST + (VU_MARKS[0][1] - VU_REST) * 10 ** ((vu + 20) / 20); // by amplitude, down to silence
    for (let i = 1; i < VU_MARKS.length; i++) {
        const [v0, a0] = VU_MARKS[i - 1], [v1, a1] = VU_MARKS[i];
        if (vu <= v1) return a0 + ((a1 - a0) * (vu - v0)) / (v1 - v0);
    }
    return VU_PIN;
}

// Each side's loudness in VU. A VU meter shows the average (RMS), not peaks; 0 VU = -10 dBFS, about where
// loud modern masters sit, so they swing around 0 and into the red.
function vuLevels(f) {
    if (!V.meters) { // iPhone: no real sound to measure, so the generated level, the sides drifting a little apart
        const t = f.now / 1000, vu = f.playing ? -15 + f.level * 24 : -60;
        return [vu + 1.2 * Math.sin(t * 1.7), vu + 1.2 * Math.sin(t * 2.3 + 1)];
    }
    return V.meters.map(({ meter, samples }) => {
        meter.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        return 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6) + 10;
    });
}

const px = ([x, y, w, h]) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
const deckFile = (name) => `/static/cassette/${name}`;

function cassetteDeck(kind) {
    const d = DECKS[kind], [tx, ty] = d.tape;
    return html`<div class="cs-deck cs-${kind}" style="width:${d.w}px;height:${d.h}px">
        <img class="cs-plate" src="${deckFile(d.plate)}" alt="" draggable="false">
        <div class="cs-tape" style="${px(d.tape)}">${d.reels.map(([x, y]) => html`<i class="cs-pack" style="${px([x - tx - d.full, y - ty - d.full, d.full * 2, d.full * 2])}"></i>`)}</div>
        ${d.reels.map(([x, y]) => html`<img class="cs-reel" src="${deckFile('reel.webp')}" alt="" draggable="false" style="${px([x - d.hub, y - d.hub, d.hub * 2, d.hub * 2])}">`)}
        ${kind === 'hifi' ? html`<i class="cs-strip" style="${px([240, 290, 372, 28])}"></i>` : ''}
        ${Object.entries(d.lit).map(([name, box]) => html`<img class="cs-lit" data-lit="${name}" src="${deckFile(d.plate.replace('.webp', `-${name}.webp`))}" alt="" draggable="false" style="${px(box)}">`)}
        ${d.buttons.map(([name, ...box]) => html`<button type="button" class="cs-btn" data-cs="${name}" style="${px(box)}" aria-label="${DECK_BUTTONS[name]}" title="${DECK_BUTTONS[name]}"></button>`)}
        <button type="button" class="cs-power" data-nv-close style="${px(d.power)}" aria-label="Power: close Now Playing" title="Close"></button>
        ${kind === 'portable' ? html`
            <div class="cs-label" style="${px([360, 262, 845, 76])}"><span data-cs-title></span></div>
            <div class="cs-lcd" style="${px([468, 765, 985, 125])}">
                <span class="cs-note">${icon('note', 34)}</span>
                <b data-cs-name></b><span class="cs-artist" data-cs-artist></span><span class="cs-time" data-cs-time></span>
                <input type="range" class="bar cs-portable-seek" data-nv-seek min="0" max="1000" step="1" value="0" aria-label="Seek">
                <span class="cs-leds">${Array.from({ length: 6 }, () => html`<span>${Array.from({ length: 8 }, () => html`<i></i>`)}</span>`)}</span>
            </div>
            <div class="cs-slider" data-cs-control="volume" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-disabled="${String(!VOLUME_WORKS)}" style="${px([1560, 160, 66, 270])}"><img class="cs-thumb" src="${deckFile('portable-thumb.webp')}" alt="" draggable="false"></div>`
        : html`
            ${[782, 1086].map((x) => html`<div class="cs-vu" style="${px([x, 130, 266, 144])}"><i class="cs-needle"></i></div>`)}
            <div class="cs-screen" style="${px([755, 330, 625, 165])}">
                <span class="cs-cover" data-cs-cover></span>
                <b data-cs-name></b><span class="cs-artist" data-cs-artist></span>
                <span class="cs-time"><span data-nv-time></span> / <span data-nv-dur></span></span>
                <input type="range" class="bar cs-seek" data-nv-seek min="0" max="1000" step="1" value="0" aria-label="Seek">
            </div>
            <div class="cs-knob" data-cs-control="volume" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-disabled="${String(!VOLUME_WORKS)}" style="${px([1430, 152, 124, 124])}"><i class="cs-pointer"></i></div>
            <div class="cs-knob small" data-cs-control="balance" role="slider" tabindex="0" aria-label="Balance" aria-valuemin="-100" aria-valuemax="100" aria-disabled="${String(IOS)}" style="${px([1463, 364, 54, 54])}"><i class="cs-pointer"></i></div>`}
    </div>`;
}

// One deck element for as long as the size class stays, moved into each re-render like the canvas:
// rebuilding it would reload the photo and restart the reels on every song.
function cassetteStage() {
    const kind = CASSETTE_SMALL.matches ? 'portable' : 'hifi';
    if (CS.kind === kind) return CS.stage;
    CS.kind = kind;
    CS.stage = document.createElement('div');
    CS.stage.className = 'cs';
    CS.stage.innerHTML = cassetteDeck(kind).toString();
    const deck = CS.deck = CS.stage.firstElementChild;
    CS.el = {
        packs: $$('.cs-pack', deck), reels: $$('.cs-reel', deck), needles: $$('.cs-needle', deck),
        time: $('[data-cs-time]', deck), nvTime: $('[data-nv-time]', deck), nvDur: $('[data-nv-dur]', deck),
        progress: $('[data-cs-progress]', deck), seek: $('[data-nv-seek]', deck),
        play: $('[data-cs="play"]', deck), pause: $('[data-cs="pause"]', deck),
    };
    CS.leds = $$('.cs-leds > span', deck).map((column) => ({ segments: [...column.children], lit: -1, level: 0 }));
    CS.radius = [0, 0];
    CS.needle = [VU_REST, VU_REST];
    CS.swing = [0, 0];
    CS.ui = {};
    CS.observer?.disconnect();
    CS.observer = new ResizeObserver(fitCassette);
    CS.observer.observe(CS.stage);
    return CS.stage;
}

function fitCassette() {
    const { stage, deck, kind } = CS;
    if (!stage?.isConnected) return;
    const d = DECKS[kind], w = stage.clientWidth, h = stage.clientHeight;
    CS.turn = kind === 'portable' && h > w;
    const [across, down] = CS.turn ? [d.h, d.w] : [d.w, d.h];
    CS.scale = Math.min(w / across, h / down, d.maxScale || Infinity);
    // Turned a quarter clockwise its buttons face right; flipped (double-tap, flipCassette), a quarter the other way: left
    deck.style.transform = `translate(-50%, -50%)${CS.turn ? ` rotate(${CS.flip ? -90 : 90}deg)` : ''} scale(${CS.scale})`;
}

// Double-tap the portable (phone upright) to turn it round, buttons on the left instead of the right. Remembered.
function flipCassette() {
    if (!CS.turn) return; // sideways phone: the deck is already level
    CS.flip = !CS.flip;
    store.set('cassetteFlip', CS.flip);
    CS.deck.classList.add('cs-flipping');
    fitCassette();
    setTimeout(() => CS.deck?.classList.remove('cs-flipping'), 600);
}

function showCassetteSong(t) {
    const deck = CS.deck;
    $$('[data-cs-name]', deck).forEach((el) => { el.textContent = t.title; });
    $$('[data-cs-artist]', deck).forEach((el) => { el.textContent = t.artists.join(', '); });
    const label = $('[data-cs-title]', deck);
    if (label) { // handwritten on the cassette: as big as fits on the label
        label.textContent = t.title;
        let size = 60;
        label.style.fontSize = `${size}px`;
        while (label.scrollWidth > label.parentElement.clientWidth && size > 24) label.style.fontSize = `${(size -= 4)}px`;
    }
    const cover = $('[data-cs-cover]', deck);
    if (cover) cover.innerHTML = (t.has_cover ? html`<img src="${artUrl(t.id)}" alt="">` : icon('note', 44)).toString();
    CS.ui = {}; // the time, buttons and knobs redraw on the next frame
}

// Reels: the tape moves at one speed, 4.76 cm/s, past both. A reel turns at ω = v / r, so the thin one spins
// fast and the full one slowly, and the tape fills area, so a reel holding fraction q of it has
// r = √(hub² + (full² − hub²)·q). Hub radius 1.1 cm: 4.33 rad/s (41 rpm) on an empty hub.
const HUB_SPIN = 4.76 / 1.1;

function cassetteFrame(f) {
    const deck = CS.deck;
    if (!deck?.isConnected) return;
    const d = DECKS[CS.kind], el = CS.el, dur = P.audio.duration || 0;
    let pos = P.audio.currentTime || 0, rate = f.playing ? 1 : 0;
    if (CS.wind) { // holding REW or FF: the tape winds faster the longer you hold (8× up to 40×), silent like a real deck
        const w = CS.wind, speed = Math.min(40, 8 + ((f.now - w.from) / 1000) * 16);
        w.pos = Math.max(0, Math.min(dur - 0.25, w.pos + w.dir * speed * f.dt));
        pos = w.pos;
        rate = w.dir * speed;
    }
    const progress = dur ? Math.min(1, pos / dur) : 0, area = d.full ** 2 - d.hub ** 2;
    [1 - progress, progress].forEach((share, i) => {
        const target = Math.sqrt(d.hub ** 2 + area * share);
        CS.radius[i] = CS.radius[i] ? lerp(CS.radius[i], target, Math.min(1, f.dt * 6)) : target; // a new song rewinds visibly
        const omega = Math.max(-18, Math.min(18, (rate * d.hub * HUB_SPIN) / CS.radius[i])); // faster only strobes
        if (!reducedMotion.matches) CS.angle[i] -= omega * f.dt;                            // counter-clockwise in play
        el.packs[i].style.transform = `scale(${CS.radius[i] / d.full})`;
        el.reels[i].style.transform = `rotate(${CS.angle[i]}rad)`;
    });

    const state = CS.wind ? 'wind' : f.playing ? 'play' : pos > 0.5 ? 'pause' : 'stop';
    if (CS.ui.state !== state) { // CSS lights PLAY, PAUSE or STOP to match, and holds PLAY or PAUSE down like a deck's latches
        CS.ui.state = deck.dataset.state = state;
        el.play.setAttribute('aria-pressed', String(state === 'play'));
        el.pause.setAttribute('aria-pressed', String(state === 'pause'));
    }
    const second = Math.floor(pos);
    if (CS.ui.second !== second || CS.ui.dur !== dur) {
        CS.ui.second = second;
        CS.ui.dur = dur;
        if (el.time) el.time.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
        if (el.nvTime && !NV.seeking) el.nvTime.textContent = fmtTime(pos);
        if (el.nvDur) el.nvDur.textContent = fmtTime(dur);
    }
    const tenth = Math.floor(pos * 10);
    if (CS.ui.tenth !== tenth || CS.ui.dur !== dur) {
        CS.ui.tenth = tenth;
        if (el.progress) setProgress(el.progress, progress);
        if (el.seek && !NV.seeking) { el.seek.value = Math.round(progress * 1000); setRangeFill(el.seek); }
    }

    if (el.needles.length) {
        // A VU needle has weight: it reaches a reading in 300 ms and swings about 1% past it, which is a damped
        // spring (stiffness 441, damping 34). Small steps, because one 100 ms step would overshoot wildly.
        vuLevels(f).forEach((vu, i) => {
            const target = vuAngle(vu);
            for (let left = f.dt; left > 0; left -= 1 / 240) {
                const dt = Math.min(left, 1 / 240);
                CS.swing[i] += ((target - CS.needle[i]) * 441 - CS.swing[i] * 34) * dt;
                CS.needle[i] += CS.swing[i] * dt;
                if (CS.needle[i] < VU_REST || CS.needle[i] > VU_PIN) { CS.needle[i] = Math.max(VU_REST, Math.min(VU_PIN, CS.needle[i])); CS.swing[i] = 0; }
            }
            el.needles[i].style.transform = `rotate(${CS.needle[i]}deg)`;
        });
    }
    if (CS.leds.length) { // the portable's 6 bars, bass to treble: up at once, falling back at 1.5 screens a second
        bandLevels(6).forEach((level, i) => {
            const column = CS.leds[i];
            column.level = Math.max(level, column.level - f.dt * 1.5);
            const lit = Math.round(column.level * 8);
            if (lit !== column.lit) { column.lit = lit; column.segments.forEach((seg, k) => seg.classList.toggle('on', k < lit)); }
        });
    }
    const volume = P.audio.muted ? 0 : P.userVolume;
    if (CS.ui.volume !== volume) { CS.ui.volume = volume; showDeckControl('volume', volume); }
    if (CS.ui.balance !== P.balance) { CS.ui.balance = P.balance; showDeckControl('balance', P.balance); }
}

function showDeckControl(name, value) {
    const control = $(`[data-cs-control="${name}"]`, CS.deck);
    if (!control) return;
    if (control.matches('.cs-slider')) control.firstElementChild.style.top = `${413 - value * 236 - 160 - 9.5}px`; // the 0-10 marks
    else control.firstElementChild.style.transform = `rotate(${name === 'balance' ? value * 130 : -140 + value * 280}deg)`;
    const pct = Math.round(value * 100);
    control.setAttribute('aria-valuenow', pct);
    control.setAttribute('aria-valuetext', name === 'volume' ? `${pct}%` : pct ? `${Math.abs(pct)}% ${pct < 0 ? 'left' : 'right'}` : 'Center');
}

function setDeckControl(name, value) {
    if (name === 'volume') {
        const bar = $('#volumeBar');
        bar.value = Math.round(value * 100);
        bar.dispatchEvent(new Event('input')); // the player bar's handler saves it, applies it and updates its icon
        return;
    }
    setBalance(value);
}

// A pointer position in the deck's own pixels, undoing the scale and the portable's quarter turn
function toDeck(e) {
    const r = CS.deck.getBoundingClientRect(), d = DECKS[CS.kind];
    let x = (e.clientX - (r.left + r.width / 2)) / CS.scale, y = (e.clientY - (r.top + r.height / 2)) / CS.scale;
    if (CS.turn) [x, y] = CS.flip ? [-y, x] : [y, -x]; // undo rotate(∓90deg)
    return { x: x + d.w / 2, y: y + d.h / 2 };
}

// The value under the pointer: along the portable's slider, or the angle around a knob (null in its middle,
// where the angle means nothing). The volume knob's ends meet at the bottom: past them, it stays at the near end.
function deckValueAt(control, e) {
    const p = toDeck(e);
    if (control.matches('.cs-slider')) return clamp01((413 - p.y) / 236);
    const radius = control.offsetWidth / 2, dx = p.x - (control.offsetLeft + radius), dy = p.y - (control.offsetTop + radius);
    if (Math.hypot(dx, dy) < radius * 0.25) return null;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up, clockwise
    if (control.dataset.csControl === 'balance') return Math.max(-1, Math.min(1, angle / 130));
    if (Math.abs(angle) > 140) return P.userVolume > 0.5 ? 1 : 0;
    return (angle + 140) / 280;
}

function nudgeDeckControl(control, key) {
    const name = control.dataset.csControl, min = name === 'volume' ? 0 : -1;
    const value = name === 'volume' ? (P.audio.muted ? 0 : P.userVolume) : P.balance;
    const step = { ArrowUp: 0.05, ArrowRight: 0.05, PageUp: 0.2, ArrowDown: -0.05, ArrowLeft: -0.05, PageDown: -0.2 }[key] || 0;
    setDeckControl(name, key === 'Home' ? min : key === 'End' ? 1 : Math.max(min, Math.min(1, value + step)));
}

function deckButton(name) {
    if (name === 'rew') prev();
    else if (name === 'ff') next();
    else if (name === 'play') { if (P.audio.paused) togglePlay(); }
    else if (name === 'pause') { if (!P.audio.paused) P.audio.pause(); else if (P.audio.currentTime > 0.5) P.audio.play(); }
    else if (name === 'stop') { P.audio.pause(); P.audio.currentTime = 0; }
}

function startWind(dir) {
    if (!P.audio.duration) return;
    CS.wind = { dir, from: performance.now(), pos: P.audio.currentTime, resume: !P.audio.paused };
    P.audio.pause();
}

function endWind() {
    const w = CS.wind;
    CS.wind = null;
    if (!w) return;
    P.audio.currentTime = w.pos;
    if (w.resume) P.audio.play();
}

function deckUpNext(t) {
    return html`<button type="button" class="cs-upnext" data-action="queue-open" aria-label="Up next: ${t.title}. Open the queue">
        <span class="cs-upnext-label">Up next</span>
        ${t.has_cover ? html`<img src="${artUrl(t.id)}" alt="">` : html`<span class="cs-upnext-art">${icon('note', 20)}</span>`}
        <span class="cs-upnext-song">${t.title} • ${t.artists.join(', ')}</span>${icon('queue', 20)}
    </button>`;
}

// The song `offset` steps away in play order, or null. Wraps only when that's what next() would do.
function neighbour(offset) {
    if (!currentTrack()) return null;
    if (offset > 0 && P.upNext.length) return S.byId.get(P.upNext[0]) || null;
    let i = P.pos + offset + (P.queued && offset < 0 ? 1 : 0); // while a queued song plays, "previous" is the context song
    if ((i < 0 || i >= P.order.length) && P.repeat === 'all' && !P.shuffle) i = (i + P.order.length) % P.order.length;
    return i >= 0 && i < P.order.length ? S.byId.get(P.queue[P.order[i]]) || null : null;
}

function stepSong(offset) {
    if (offset > 0) return neighbour(1) && next();
    if (!neighbour(-1)) return;
    if (P.queued) { P.queued = null; loadAndPlay(); return; }
    P.pos = P.pos > 0 ? P.pos - 1 : P.order.length - 1; // previous song, even past the 3 s "restart" point
    loadAndPlay();
}

function nvCard(t, step) {
    if (!t) return html`<div class="nv-card empty" aria-hidden="true"></div>`;
    const art = t.has_cover ? html`<img src="${artUrl(t.id)}" alt="">` : icon('note', 64);
    if (!step) return html`<div class="nv-card current">${art}</div>`;
    return html`<button class="nv-card" data-nv-step="${step}" aria-label="${step > 0 ? 'Next' : 'Previous'}: ${t.title}" tabindex="-1">${art}</button>`;
}

function renderNowView() {
    const root = $('#nowRoot');
    const t = currentTrack();
    if (!NV.open || !t) { root.innerHTML = ''; return; }
    const prevT = neighbour(-1), nextT = neighbour(1);
    // Slide the feed the way the songs moved: the old "next" coming up from below, or the old "previous" from above
    const dir = t.id === NV.nextId ? 'up' : t.id === NV.prevId ? 'down' : '';
    NV.prevId = prevT && prevT.id;
    NV.nextId = nextT && nextT.id;
    const context = P.context || { label: 'All songs', href: '#/songs' };
    const year = t.year ? ` • ${t.year}` : '';
    const hadFocus = root.contains(document.activeElement) ? document.activeElement.dataset.nvFocus : null;

    // The backdrop and panel are built once per opening; re-renders (song change, lyrics on/off) only replace
    // what's inside. Rebuilding them replayed the backdrop's fade-in and reset the tint to grey: a visible flash.
    let section = $('.nv', root);
    if (!section) {
        root.innerHTML = `<div class="nv-backdrop" data-nv-close><section class="nv" role="dialog" aria-label="Now playing" tabindex="-1" data-nv-focus="panel"></section></div>`;
        section = $('.nv', root);
    }
    section.dataset.viz = V.mode;
    // Cassette: the deck has its own transport, so ♥, shuffle and repeat move up here; lyrics still swap it out
    const deck = V.mode === 'cassette' && !NV.lyrics;
    section.innerHTML = html`
                <header class="nv-head">
                    <a class="nv-context" href="${context.href}">${context.label}</a>
                    <div class="nv-head-actions">
                        ${deck ? html`<div class="cs-extras">${likeButton(t.id)}
                            <button type="button" class="toggle-btn ${P.shuffle ? 'on' : ''}" data-nv-ctl="shuffle" data-nv-focus="shuffle" aria-label="Shuffle" aria-pressed="${String(P.shuffle)}">${icon('shuffle', 18)}</button>
                            <button type="button" class="toggle-btn ${P.repeat !== 'off' ? 'on' : ''}" data-nv-ctl="repeat" data-nv-focus="repeat" aria-pressed="${String(P.repeat !== 'off')}" aria-label="${{ off: 'Repeat', all: 'Repeat all', one: 'Repeat one' }[P.repeat]}">${icon(P.repeat === 'one' ? 'repeatOne' : 'repeat', 18)}</button>
                        </div>` : ''}
                        <button class="nv-pill ${NV.lyrics ? 'on' : ''}" data-nv-lyrics data-nv-focus="lyrics" aria-pressed="${String(NV.lyrics)}" title="Lyrics (L)">${icon('mic', 16)}<span>Lyrics</span></button>
                        <div class="nv-viz-wrap">
                            <button class="nv-viz ${V.mode !== 'off' ? 'on' : ''}" data-nv-viz data-nv-focus="viz" aria-haspopup="menu" aria-expanded="false" title="Visualizer (V)"><span class="sr-only">Visualizer: </span>${vizButtonInner()}</button>
                            ${vizMenu()}
                        </div>
                        ${sleepButton('nv-sleep')}
                        <button class="icon-btn" data-nv-fullscreen data-nv-focus="fullscreen" aria-pressed="${String(isFullscreen())}" aria-label="${isFullscreen() ? 'Exit full screen' : 'Full screen'}" title="${isFullscreen() ? 'Exit full screen' : 'Full screen'} (F)">${icon(isFullscreen() ? 'shrink' : 'fullscreen', 20)}</button>
                        <button class="icon-btn" data-nv-close data-nv-focus="close" aria-label="Close">${icon('close', 20)}</button>
                    </div>
                </header>
                ${deck ? html`<div class="cs-slot"></div>${nextT && !CASSETTE_SMALL.matches ? deckUpNext(nextT) : ''}` : html`<div class="nv-body">
                    <div class="nv-info">
                        <h2 class="nv-title ${t.title.length > 40 ? 'long' : ''}">${t.title}</h2>
                        <p class="nv-artists">${t.artists.map((a, i) => html`${i ? ', ' : ''}<a href="${artistHref(a)}">${a}</a>`)}</p>
                        <p class="nv-album">${t.album}${year}</p>
                        <div class="nv-like">${likeButton(t.id, { big: true })}</div>
                        ${nowControls()}
                        ${t.genre ? html`<div class="nv-tags"><a class="chip small" href="${genreHref(t.genre)}">#${t.genre.toLowerCase()}</a></div>` : ''}
                        ${nextT ? html`<button type="button" class="nv-upnext" data-action="queue-open" aria-label="Up next: ${nextT.title}. Open the queue"><span>Up next${P.upNext.length ? ' · from your queue' : ''}</span>${nextT.title} • ${nextT.artists.join(', ')}</button>` : ''}
                    </div>
                    ${NV.lyrics
                        ? html`<div class="nv-lyrics" tabindex="0" aria-label="Lyrics">${lyricsBody(t.id)}</div>`
                        : html`<div class="nv-feed ${dir}" aria-live="polite">${nvCard(prevT, -1)}${nvCard(t, 0)}${nvCard(nextT, 1)}</div>`}
                    <div class="nv-nav">
                        <button class="icon-btn" data-nv-step="-1" data-nv-focus="up" aria-label="Previous song" ${prevT ? '' : 'disabled'}>${icon('up', 24)}</button>
                        <button class="icon-btn" data-nv-step="1" data-nv-focus="down" aria-label="Next song" ${nextT ? '' : 'disabled'}>${icon('down', 24)}</button>
                    </div>
                </div>`}`.toString();
    if (deck) {
        $('.cs-slot', section).replaceWith(cassetteStage());
        fitCassette();
        showCassetteSong(t);
    }
    // One canvas for the whole time the view is open, moved into each re-render, so drawing never restarts
    if (!V.canvas) { V.canvas = document.createElement('canvas'); V.canvas.className = 'nv-viz-canvas'; V.canvas.setAttribute('aria-hidden', 'true'); }
    section.prepend(V.canvas);
    if (t.has_cover && (!V.cover || V.cover.dataset.id !== t.id)) { V.cover = new Image(); V.cover.dataset.id = t.id; V.cover.src = artUrl(t.id); }
    else if (!t.has_cover) V.cover = null;
    const focusEl = hadFocus && $(`[data-nv-focus="${hadFocus}"]`, root);
    if (focusEl && !focusEl.disabled) focusEl.focus(); else if (hadFocus) section.focus();
    updateNowProgress();
    if (NV.lyrics) { fetchLyrics(t.id); L.index = -2; startLyrics(); }
    const coverUrl = t.has_cover ? artUrl(t.id) : null;
    const applyColor = (color) => { section.style.setProperty('--nv', color || '#535353'); setVizColor(color); };
    if (NV.colors.has(coverUrl)) applyColor(NV.colors.get(coverUrl)); // known: no grey frame in between
    else coverColor(coverUrl).then((color) => { NV.colors.set(coverUrl, color); if (currentTrack() === t) applyColor(color); });
}

// Now Playing covers the whole window, player bar included, so it carries its own controls: a seek bar and
// shuffle · previous · play · next · repeat (plus volume where pages can set it). Drawn with the current state;
// updateNowControls() keeps them in step, like updateControls() does for the player bar.
function nowControls() {
    const playing = playbackIsPlaying();
    const d = remoteActive() ? (+R.state?.duration || 0) : (P.audio.duration || 0);
    const at = remoteActive() ? (+R.state?.time || 0) : (P.audio.currentTime || 0);
    return html`<div class="nv-controls">
        <div class="nv-seek"><span data-nv-time>${fmtTime(at)}</span>
            <input type="range" class="bar" data-nv-seek min="0" max="1000" step="1" value="${d ? Math.round((at / d) * 1000) : 0}" aria-label="Seek">
            <span data-nv-dur>${fmtTime(d)}</span></div>
        <div class="nv-buttons">
            <button type="button" class="toggle-btn ${P.shuffle ? 'on' : ''}" data-nv-ctl="shuffle" aria-label="Shuffle" aria-pressed="${String(P.shuffle)}">${icon('shuffle', 20)}</button>
            <button type="button" class="icon-btn" data-nv-ctl="prev" aria-label="Previous">${icon('prev', 22)}</button>
            <button type="button" class="nv-play" data-nv-ctl="play" aria-label="${playing ? 'Pause' : 'Play'}">${icon(playing ? 'pause' : 'play', 24)}</button>
            <button type="button" class="icon-btn" data-nv-ctl="next" aria-label="Next">${icon('next', 22)}</button>
            <button type="button" class="toggle-btn ${P.repeat !== 'off' ? 'on' : ''}" data-nv-ctl="repeat" aria-pressed="${String(P.repeat !== 'off')}" aria-label="${{ off: 'Repeat', all: 'Repeat all', one: 'Repeat one' }[P.repeat]}">${icon(P.repeat === 'one' ? 'repeatOne' : 'repeat', 20)}</button>
            ${VOLUME_WORKS && !matchMedia('(hover: none)').matches ? html`<span class="nv-volume">${icon(P.audio.muted || !P.userVolume ? 'mute' : P.userVolume < 0.5 ? 'volumeLow' : 'volume', 18)}
                <input type="range" class="bar" data-nv-volume min="0" max="100" value="${P.audio.muted ? 0 : Math.round(P.userVolume * 100)}" aria-label="Volume"></span>` : ''}
        </div>
    </div>`;
}

function updateNowControls() {
    const root = NV.open && $('#nowRoot .nv-controls');
    if (!root) return;
    const playing = playbackIsPlaying();
    const play = $('[data-nv-ctl="play"]', root);
    if (play.dataset.state !== String(playing)) {
        play.dataset.state = String(playing);
        play.innerHTML = icon(playing ? 'pause' : 'play', 24).s;
        play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
    const shuffle = $('[data-nv-ctl="shuffle"]', root);
    shuffle.classList.toggle('on', P.shuffle);
    shuffle.setAttribute('aria-pressed', String(P.shuffle));
    const repeat = $('[data-nv-ctl="repeat"]', root);
    repeat.classList.toggle('on', P.repeat !== 'off');
    repeat.setAttribute('aria-pressed', String(P.repeat !== 'off'));
    repeat.setAttribute('aria-label', { off: 'Repeat', all: 'Repeat all', one: 'Repeat one' }[P.repeat]);
    repeat.innerHTML = icon(P.repeat === 'one' ? 'repeatOne' : 'repeat', 20).s;
    updateNowProgress();
}

function updateNowProgress() {
    const root = NV.open && $('#nowRoot .nv-controls');
    if (!root) return;
    const seek = $('[data-nv-seek]', root);
    const d = remoteActive() ? (+R.state?.duration || 0) : (P.audio.duration || 0);
    const at = remoteActive() ? (+R.state?.time || 0) : (P.audio.currentTime || 0);
    if (!NV.seeking) {
        seek.value = d ? Math.round((at / d) * 1000) : 0;
        $('[data-nv-time]', root).textContent = fmtTime(at);
    }
    setRangeFill(seek);
    $('[data-nv-dur]', root).textContent = fmtTime(d);
    const vol = $('[data-nv-volume]', root);
    if (vol) setRangeFill(vol);
}

function openNowView() {
    if (!currentTrack() || NV.open) return;
    NV.open = true;
    NV.opener = document.activeElement;
    NV.prevId = NV.nextId = null; // no slide on open
    renderNowView();
    $('#nowBtn').setAttribute('aria-pressed', 'true');
    $('#nowRoot .nv').focus();
    startViz();  // opening is a click, so the AudioContext may start here
}

// ---------- full screen ----------
// The Now Playing panel itself goes full screen (Fullscreen API; webkit- for Safari). The browser handles Esc
// (it leaves full screen, and the page never sees that key), so a second Esc closes Now Playing as usual.
// While full screen, the controls and cursor fade after 2.5 s without the mouse moving.

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const isFullscreen = () => !!fullscreenElement() && fullscreenElement() === $('#nowRoot .nv');

function toggleFullscreen() {
    const section = $('#nowRoot .nv');
    if (!section) return;
    if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
        const request = section.requestFullscreen || section.webkitRequestFullscreen;
        if (!request) { toast("Full screen isn't available in this browser", 'error'); return; }
        Promise.resolve(request.call(section)).catch(() => toast("Couldn't go full screen", 'error'));
    }
}

let idleTimer = 0;
function wakeControls() {
    const section = $('#nowRoot .nv');
    if (!section) return;
    section.classList.remove('idle');
    clearTimeout(idleTimer);
    if (!isFullscreen()) return;
    idleTimer = setTimeout(() => {
        // Stay visible while the menu is open or you're on the controls with the keyboard (:focus-visible);
        // a mouse click leaves focus on the button too, but that shouldn't keep them up forever
        const keyboardOnControls = document.activeElement?.closest?.('.nv-head, .nv-nav') && document.activeElement.matches(':focus-visible');
        if (isFullscreen() && !keyboardOnControls && !vizMenuOpen()) section.classList.add('idle');
    }, 2500);
}

function onFullscreenChange() {
    const section = $('#nowRoot .nv');
    const on = isFullscreen();
    if (section) section.classList.toggle('fullscreen', on);
    const btn = $('#nowRoot [data-nv-fullscreen]');
    if (btn) {
        btn.innerHTML = icon(on ? 'shrink' : 'fullscreen', 20).s;
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
        btn.title = `${on ? 'Exit full screen' : 'Full screen'} (F)`;
    }
    wakeControls();
    if (!on && section) section.classList.remove('idle');
}

function closeNowView() {
    if (!NV.open) return;
    if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    NV.open = false;
    stopViz();
    renderNowView();
    $('#nowBtn').setAttribute('aria-pressed', 'false');
    if (NV.opener && NV.opener.isConnected) NV.opener.focus();
}

function bindNowView() {
    $('#nowBtn').innerHTML = icon('expand', 16).s;
    $('#queueBtn').insertAdjacentHTML('beforebegin', sleepButton().s);
    $('#queueBtn').innerHTML = icon('queue', 16).s;
    $('#queueBtn').addEventListener('click', () => toggleQueue());
    $('#nowBtn').addEventListener('click', () => (NV.open ? closeNowView() : openNowView()));
    // The cover opens Now Playing. On a phone the ⤢ button is hidden with the volume, so (as in Spotify's app)
    // tapping anywhere on the song in the player bar opens it, except the ♥
    $('#player').addEventListener('click', (e) => {
        const phone = matchMedia('(max-width: 600px)').matches;
        if (e.target.closest('#npArt') || (phone && e.target.closest('.now-playing') && !e.target.closest('#npLike, .np-artist a') && currentTrack())) {
            e.preventDefault(); // the title is a link to the playlist; on a phone the tap opens Now Playing instead
            openNowView();
        }
    });
    const root = $('#nowRoot');
    root.addEventListener('click', (e) => {
        if (NV.swiped) { NV.swiped = false; e.preventDefault(); return; } // the end of a swipe, not a tap on a card
        const deckBtn = e.target.closest('[data-cs]');
        if (deckBtn) { if (!CS.held) deckButton(deckBtn.dataset.cs); return; } // after a hold, letting go isn't a tap
        const ctl = e.target.closest('[data-nv-ctl]');
        if (ctl) {
            ({ play: togglePlay, prev, next: () => next(), shuffle: toggleShuffle, repeat: cycleRepeat })[ctl.dataset.nvCtl]();
            updateNowControls();
            return;
        }
        const step = e.target.closest('[data-nv-step]');
        if (step) { stepSong(+step.dataset.nvStep); return; }
        const line = e.target.closest('.nv-line[data-t]');
        if (line) { P.audio.currentTime = +line.dataset.t; if (P.audio.paused) P.audio.play(); L.userScrollUntil = 0; return; }
        if (e.target.closest('[data-nv-lyrics]')) { toggleLyrics(); return; }
        if (e.target.closest('[data-nv-fullscreen]')) { toggleFullscreen(); return; }
        if (e.target.closest('[data-lyrics-retry]')) { const t = currentTrack(); if (t) { L.data.delete(t.id); fillLyrics(); fetchLyrics(t.id); } return; }
        const option = e.target.closest('[data-viz-option]');
        if (option) { setVizMode(option.dataset.vizOption); closeVizMenu(); return; }
        if (e.target.closest('[data-nv-viz]')) { vizMenuOpen() ? closeVizMenu() : openVizMenu(e.detail === 0); return; } // detail 0 = keyboard
        if (vizMenuOpen()) { closeVizMenu(false); if (!e.target.closest('a, button')) return; }
        // Close on the X, on the dimmed area around the panel, or when a link inside navigates away
        if (e.target.closest('button[data-nv-close]') || e.target.matches('.nv-backdrop') || e.target.closest('a')) closeNowView();
    });
    // On document, not the view: focus may be on the player bar (e.g. after pausing) while the view is open
    document.addEventListener('keydown', (e) => {
        if (!NV.open || $('#modalRoot').children.length) return;
        const el = e.target instanceof Element ? e.target : document.body;
        if (vizMenuOpen()) {
            const items = $$('#nowRoot [data-viz-option]'), i = items.indexOf(document.activeElement);
            if (e.key === 'Escape') { e.preventDefault(); closeVizMenu(); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
            } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); }
            else if (e.key === 'Tab') closeVizMenu(false);
            return;                                        // Enter/Space click the focused option natively
        }
        const control = el.closest('[data-cs-control]');
        if (control && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();                            // not the song arrows: this knob or slider
            if (control.getAttribute('aria-disabled') === 'true') toast(DECK_LOCKED[control.dataset.csControl]);
            else nudgeDeckControl(control, e.key);
            return;
        }
        if (e.key === 'Escape') { e.preventDefault(); closeNowView(); }
        else if (e.key === 'ArrowDown' && el.closest('[data-nv-viz]')) { e.preventDefault(); openVizMenu(); }
        else if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && !el.closest('input, textarea, select')) toggleLyrics();
        else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !el.closest('input, textarea, select')) toggleFullscreen();
        else if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey && !el.closest('input, textarea, select')) cycleVizMode();
        else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (root.contains(el) || el === document.body)) {
            e.preventDefault();
            stepSong(e.key === 'ArrowDown' ? 1 : -1);
        }
    });
    // Seek and volume inside Now Playing (the player bar is underneath it)
    root.addEventListener('input', (e) => {
        if (e.target.matches('[data-nv-seek]')) {
            NV.seeking = true;
            setRangeFill(e.target);
            const duration = remoteActive() ? (+R.state?.duration || 0) : (P.audio.duration || 0);
            const current = fmtTime((e.target.value / 1000) * duration);
            const time = $('#nowRoot [data-nv-time]');
            if (time) time.textContent = current;
            else if (CS.el.time) CS.el.time.textContent = `${current} / ${fmtTime(duration)}`;
        } else if (e.target.matches('[data-nv-volume]')) {
            if (remoteCommand('volume', e.target.value / 100)) { setRangeFill(e.target); return; }
            P.audio.muted = false;
            P.userVolume = e.target.value / 100;
            store.set('volume', P.userVolume);
            applyVolume();
            setRangeFill(e.target);
            $('#volumeBar').value = e.target.value; // the player bar's slider too
            setRangeFill($('#volumeBar'));
        }
    });
    root.addEventListener('change', (e) => {
        if (!e.target.matches('[data-nv-seek]')) return;
        const duration = remoteActive() ? (+R.state?.duration || 0) : (P.audio.duration || 0);
        if (duration) {
            const time = (e.target.value / 1000) * duration;
            if (!remoteCommand('seek', time)) P.audio.currentTime = time;
        }
        NV.seeking = false;
    });
    // One song per scroll gesture: a trackpad fires dozens of small wheel events, so add them up and then pause
    root.addEventListener('wheel', (e) => {
        const control = e.target.closest('[data-cs-control]:not([aria-disabled="true"])');
        if (control) { e.preventDefault(); nudgeDeckControl(control, e.deltaY < 0 ? 'ArrowUp' : 'ArrowDown'); return; }
        if (!e.target.closest('.nv-feed')) return;
        e.preventDefault();
        if (Date.now() < NV.wheelLock) return;
        NV.wheel += e.deltaY;
        if (Math.abs(NV.wheel) > 60) {
            stepSong(NV.wheel > 0 ? 1 : -1);
            NV.wheel = 0;
            NV.wheelLock = Date.now() + 700;
        }
    }, { passive: false });
    for (const type of ['wheel', 'touchmove', 'pointerdown']) {
        root.addEventListener(type, (e) => { if (e.target.closest('.nv-lyrics')) L.userScrollUntil = Date.now() + 3000; }, { passive: true });
    }
    // Cassette, phone upright: a double-tap on the deck itself (not a button, knob or slider) turns it round.
    // Two taps: each a press and release that hardly moved, within 350 ms and 40 px of each other.
    root.addEventListener('pointerup', (e) => {
        const down = CS.down, last = CS.lastTap;
        CS.down = null;
        if (!down || !CS.turn || !e.target.closest('.cs') || e.target.closest('[data-cs], [data-cs-control], [data-nv-seek]')
            || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { CS.lastTap = null; return; }
        CS.lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        if (last && e.timeStamp - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
            CS.lastTap = null;
            flipCassette();
        }
    });
    // Cassette: drag a knob or the slider; hold REW or FF to wind (a quick press is previous or next)
    root.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary || e.button !== 0) return;
        CS.down = { x: e.clientX, y: e.clientY };
        const until = (ev) => ev.pointerId === e.pointerId;
        const control = e.target.closest('[data-cs-control]');
        if (control) {
            const name = control.dataset.csControl;
            if (control.getAttribute('aria-disabled') === 'true') { toast(DECK_LOCKED[name]); return; }
            e.preventDefault();
            control.focus({ preventScroll: true });
            const set = (ev) => { const value = deckValueAt(control, ev); if (value !== null) setDeckControl(name, value); };
            const move = (ev) => until(ev) && set(ev);
            const end = (ev) => {
                if (!until(ev)) return;
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', end);
                window.removeEventListener('pointercancel', end);
            };
            set(e);
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', end);
            window.addEventListener('pointercancel', end);
            return;
        }
        const wind = e.target.closest('[data-cs="rew"], [data-cs="ff"]');
        if (!wind) return;
        clearTimeout(CS.holdTimer);
        CS.holdTimer = setTimeout(() => { CS.held = true; startWind(wind.dataset.cs === 'ff' ? 1 : -1); }, 350);
        const end = (ev) => {
            if (!until(ev)) return;
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            clearTimeout(CS.holdTimer);
            if (!CS.held) return;
            endWind();
            setTimeout(() => { CS.held = false; }, 400); // in case no click follows
        };
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    });
    CASSETTE_SMALL.addEventListener('change', () => { if (NV.open && V.mode === 'cassette') renderNowView(); });
    // The equalizer, reverb and balance live in Web Audio, which a page may only start on a click or key: when any
    // is on, start it on the first one of the visit
    const soundOnGesture = () => { if (soundInUse() && !V.analyser) ensureAudioGraph(); };
    document.addEventListener('pointerup', soundOnGesture, true);
    document.addEventListener('keydown', soundOnGesture, true);
    // Touch: swipe the covers up for the next song, down for the previous one, as in Spotify's app. The covers
    // follow the finger; let go past 70 px (or flick) to change song, otherwise they spring back.
    root.addEventListener('pointerdown', (e) => {
        const feed = e.target.closest('.nv-feed');
        if (!feed || e.pointerType === 'mouse' || !e.isPrimary) return;
        const start = { y: e.clientY, t: performance.now() };
        let dy = 0, dragging = false, recent = [{ y: e.clientY, t: start.t }]; // the last ~100 ms, for flick speed
        feed.style.setProperty('--drag-ease', '0s');
        const move = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            dy = ev.clientY - start.y;
            const t = performance.now();
            recent.push({ y: ev.clientY, t });
            while (recent.length > 2 && t - recent[0].t > 100) recent.shift();
            if (!dragging && Math.abs(dy) < 8) return; // still a tap
            dragging = true;
            const blocked = dy < 0 ? !neighbour(1) : !neighbour(-1);
            feed.style.setProperty('--drag', `${blocked ? dy * 0.25 : dy}px`); // resist where there's no song to go to
        };
        const end = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            feed.style.setProperty('--drag-ease', '.25s');
            feed.style.setProperty('--drag', '0px');
            if (!dragging) return;
            NV.swiped = true;
            setTimeout(() => { NV.swiped = false; }, 400); // in case no click follows
            const first = recent[0], last = recent[recent.length - 1];
            const speed = (last.y - first.y) / Math.max(1, last.t - first.t); // px per ms, over the end of the gesture
            const offset = dy < -70 || (dy < -24 && speed < -0.35) ? 1 : dy > 70 || (dy > 24 && speed > 0.35) ? -1 : 0;
            if (ev.type === 'pointerup' && offset && neighbour(offset)) stepSong(offset);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    });
    window.addEventListener('hashchange', closeNowView);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    root.addEventListener('pointermove', wakeControls);
    root.addEventListener('keydown', wakeControls);
    // rAF stops in a hidden window anyway; restart drawing when it comes back
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { startViz(); startLyrics(); } });
}

function setRangeFill(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
}

let refreshVolumeControls = () => {};

function bindPlayer() {
    $('#shuffleBtn').innerHTML = icon('shuffle', 16).s;
    $('#prevBtn').innerHTML = icon('prev', 16).s;
    $('#nextBtn').innerHTML = icon('next', 16).s;
    $('#playBtn').addEventListener('click', togglePlay);
    $('#nextBtn').addEventListener('click', () => next());
    $('#prevBtn').addEventListener('click', prev);
    $('#shuffleBtn').addEventListener('click', toggleShuffle);
    $('#repeatBtn').addEventListener('click', cycleRepeat);

    const seek = $('#seekBar');
    seek.addEventListener('input', () => {
        P.seeking = true;
        setRangeFill(seek);
        $('#timeCurrent').textContent = fmtTime((seek.value / 1000) * (remoteActive() ? (+R.state?.duration || 0) : (P.audio.duration || 0)));
    });
    seek.addEventListener('change', () => {
        const duration = remoteActive() ? (+R.state?.duration || 0) : (P.audio.duration || 0);
        if (duration) {
            const time = (seek.value / 1000) * duration;
            if (!remoteCommand('seek', time)) P.audio.currentTime = time;
        }
        P.seeking = false;
    });

    const volume = $('#volumeBar');
    const mute = $('#muteBtn');
    const mobileVolume = $('#mobileRemoteVolume');
    const mobileMute = $('#mobileRemoteMute');
    const showVolume = () => {
        const muted = remoteActive() ? !!R.state?.muted : P.audio.muted;
        const level = remoteActive() ? (+R.state?.volume || 0) : P.userVolume;
        volume.value = muted ? 0 : Math.round(level * 100);
        setRangeFill(volume);
        const v = muted ? 0 : level;
        const volumeIcon = v === 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume';
        mute.innerHTML = icon(volumeIcon, 16).s;
        mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        mobileVolume.value = muted ? 0 : Math.round(level * 100);
        setRangeFill(mobileVolume);
        mobileMute.innerHTML = icon(volumeIcon, 18).s;
        mobileMute.setAttribute('aria-label', muted ? 'Unmute computer' : 'Mute computer');
    };
    refreshVolumeControls = showVolume;
    const setVolume = (control) => {
        if (remoteActive()) {
            R.state = { ...R.state, volume: control.value / 100, muted: false };
            remoteCommand('volume', control.value / 100);
            showVolume();
            return;
        }
        P.audio.muted = false;
        P.userVolume = control.value / 100;
        store.set('volume', P.userVolume);
        applyVolume();
        showVolume();
    };
    volume.addEventListener('input', () => setVolume(volume));
    mobileVolume.addEventListener('input', () => setVolume(mobileVolume));
    const toggleMute = () => {
        if (remoteActive()) {
            R.state = { ...R.state, muted: !R.state?.muted };
            remoteCommand('mute');
            showVolume();
            return;
        }
        P.audio.muted = !P.audio.muted; applyVolume(); showVolume();
    };
    mute.addEventListener('click', toggleMute);
    mobileMute.addEventListener('click', toggleMute);
    showVolume();

    onPlayer('timeupdate', () => {
        notePlaybackProgress();
        if (!P.audio.paused && listen.id) {
            const now = P.audio.currentTime;
            if (listen.last !== null && now > listen.last && now - listen.last < 1.5) listen.seconds += now - listen.last;
            listen.last = now;
        }
        if (P.seeking) return;
        const d = P.audio.duration || 0;
        seek.value = d ? Math.round((P.audio.currentTime / d) * 1000) : 0;
        setRangeFill(seek);
        $('#timeCurrent').textContent = fmtTime(P.audio.currentTime);
        $('#timeTotal').textContent = fmtTime(d);
        updateNowProgress();
    });
    onPlayer('loadedmetadata', () => { $('#timeTotal').textContent = fmtTime(P.audio.duration); });
    onPlayer('play', updateControls);
    onPlayer('pause', () => {
        clearTimeout(playbackRecovery.timer);
        playbackRecovery.timer = null;
        updateControls();
    });
    onPlayer('waiting', armPlaybackRecovery);
    onPlayer('stalled', armPlaybackRecovery);
    onPlayer('ended', () => { // report before moving on (or stopping)
        flushListen();
        if (SL.endOfSong) { stopForSleep(); return; }
        next(true);
    });
    onPlayer('timeupdate', maybeCrossfade);
    onPlayer('timeupdate', readyNext);
    onPlayer('pause', () => { if (XF.active && !XF.switching) endFade(); });
    onPlayer('seeking', () => { listen.last = null; });  // a jump isn't listening
    window.addEventListener('pagehide', () => { flushListen(true); saveSession(); });
    onPlayer('pause', saveSession);
    let lastSave = 0;
    onPlayer('timeupdate', () => { if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveSession(); } });
    onPlayer('error', () => {
        const t = currentTrack();
        if (t && P.audio.src) { toast(`Couldn't load "${t.title}". Skipping.`, 'error'); setTimeout(() => next(true), 600); }
    });

    if ('mediaSession' in navigator) {
        const ms = navigator.mediaSession;
        ms.setActionHandler('play', () => P.audio.play());
        ms.setActionHandler('pause', () => P.audio.pause());
        ms.setActionHandler('previoustrack', prev);
        ms.setActionHandler('nexttrack', () => next());
        try { ms.setActionHandler('seekto', (e) => { P.audio.currentTime = e.seekTime; }); } catch { /* unsupported */ }
    }
    updateControls();
}

// ---------- downloads ----------

const ACTIVE = new Set(['queued', 'downloading']);
let pollTimer = null;
const celebratedJobs = new Set();

const jobFor = (url) => S.jobs.find((j) => j.query === url && ACTIVE.has(j.status));

async function startDownload({ url, type, title, image, total }) {
    try {
        const job = await api('/download', {
            method: 'POST',
            body: JSON.stringify({ query: url, type, title, image, total, format: S.settings.format, bitrate: S.settings.bitrate, includeLyrics: S.settings.lyrics }),
        });
        S.jobs.unshift(job);
        toast(`Added to downloads: ${job.title}`);
        updateDownloadButtons();
        schedulePoll(300);
    } catch (err) {
        toast(err.message, 'error');
    }
}

function schedulePoll(delay) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollJobs, delay);
}
let lastJobsSig = null;

async function pollJobs() {
    let data;
    try { data = await api('/jobs'); } catch { schedulePoll(5000); return; }
    const sig = data.jobs.map((j) => `${j.id}:${j.status}:${j.done}`).join('|');
    const busy = data.jobs.some((j) => ACTIVE.has(j.status));
    if (sig === lastJobsSig && !busy && route().name !== 'downloads') {
        schedulePoll(15000); // nothing moved since last poll: skip the DOM work entirely
        return;
    }
    lastJobsSig = sig;
    const before = new Map(S.jobs.map((j) => [j.id, j.status]));
    S.jobs = data.jobs;
    let finished = false;
    for (const job of S.jobs) {
        const was = before.get(job.id);
        if (was && ACTIVE.has(was) && !ACTIVE.has(job.status)) {
            finished = true;
            if (job.status === 'completed') {
                celebratedJobs.add(job.id);
                toast(`Downloaded: ${job.title} (${job.message}). Added to your library.`);
            }
            else if (job.status === 'failed') toast(`Download failed: ${job.title}`, 'error');
        }
    }
    const active = S.jobs.filter((j) => ACTIVE.has(j.status)).length;
    const badge = $('#downloadsBadge');
    badge.hidden = !active;
    badge.textContent = active;
    $('#downloadsBtn').classList.toggle('busy', !!active);
    $('#mobileMoreBtn')?.classList.toggle('has-activity', !!active);
    if (finished) { await loadLibrary(); rerender(); }
    else if (route().name === 'downloads') renderJobsList();
    else updateDownloadButtons();
    schedulePoll(active ? 1000 : 15000);
}

// Swap download buttons to spinners/checks without re-rendering the view
function updateDownloadButtons() {
    $$('[data-download-url]').forEach((btn) => {
        const job = jobFor(btn.dataset.downloadUrl);
        btn.classList.toggle('busy', !!job);
        btn.disabled = !!job;
        if (btn.classList.contains('status-btn')) {
            btn.innerHTML = icon(job ? 'loader' : 'download', 18, job ? 'spinning' : '').s;
        } else if (job) {
            btn.innerHTML = html`${icon('loader', 18, 'spinning')} ${job.status === 'queued' ? 'Queued' : 'Downloading…'}`.s;
        }
    });
}

// ---------- toasts & modal ----------

function toast(message, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

function connectionLine(c) {
    if (c && c.initialized) return html`<div class="conn-status ok">${icon('check', 16)} Connected${c.client_id_hint ? html` · Client ID ${c.client_id_hint}` : ''}</div>`;
    return html`<div class="conn-status bad">${icon('warn', 16)} <span>${c && c.configured ? 'Not working: ' : 'Not connected. '}${(c && c.message) || ''}</span></div>`;
}

// From source: how this copy relates to the release ("v2.0.1-3-gabc1234-dirty" = 3 commits after 2.0.1,
// plus uncommitted changes). Nothing for the installed app or an exact release checkout.
function buildLine(build, ver) {
    if (!build || build === `v${ver}`) return '';
    const m = /^v?([\d.]+)(?:-(\d+)-g([0-9a-f]+))?(-dirty)?$/.exec(build);
    if (!m) return html`<p class="about-build">Running from source (${build})</p>`;
    const parts = ['Running from source'];
    if (m[2]) parts.push(`${plural(+m[2], 'change')} after ${m[1]}`);
    if (m[4]) parts.push('with unsaved edits');
    return html`<p class="about-build" title="${build}">${parts.join(', ')}</p>`;
}

// Service worker updates: apply them instead of rotting on stale code. Reloads only when
// nothing is playing or downloading; otherwise the update waits for the next launch.
function watchForUpdates() {
    if (!('serviceWorker' in navigator)) return;
    const apply = (reg) => {
        reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
                if (sw.state !== 'installed' || !navigator.serviceWorker.controller) return;
                const busy = playbackIsPlaying() || (S.jobs || []).some((j) => j.status === 'queued' || j.status === 'downloading');
                if (busy) { toast('Update ready — restart the app to apply it.'); return; }
                toast('Updating to the latest version…');
                setTimeout(() => location.reload(), 1200);
            });
        });
    };
    navigator.serviceWorker.ready.then(apply).catch(() => {});
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) navigator.serviceWorker.ready.then((r) => r.update().catch(() => {})).catch(() => {});
    });
}

// Service workers require HTTPS. Tailscale/Funnel phone links qualify; plain home-Wi-Fi HTTP does not.
function registerPhoneCache() {
    // Any secure context: the worker is what makes offline boot possible, so don't gate it on
    // the init call having succeeded (it can't have, when the phone is offline).
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

let qrLoading = null;
const loadQr = () => qrLoading || (qrLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/static/vendor/qrcode.min.js';
    script.onload = resolve;
    script.onerror = () => { qrLoading = null; reject(); };
    document.head.append(script);
}));

function updateThemeScheduleStatus() {
    const panel = $('#themeSchedule');
    if (!panel) return;
    panel.hidden = !Theme.scheduled;
    $('#themeScheduleStatus').textContent = `Now: ${document.documentElement.dataset.mode === 'light' ? 'Light' : 'Dark'}. Uses this device's local time.`;
}

function openSettings(focus = 'appearance') {
    const s = S.settings;
    const colorChoices = () => html`<legend class="sr-only">Theme color</legend>${Theme.colors.map((theme) => html`<label class="theme-choice">
        <input class="sr-only" type="radio" name="themeColor" value="${theme.id}" ${theme.id === Theme.current ? new Safe('checked') : ''}>
        <span class="theme-dot" style="--swatch:${theme.color};--swatch-ink:${theme.ink || '#000000'}" aria-hidden="true">${icon('checkPlain', 16)}</span>
        <span>${theme.name}</span></label>`)}`;
    const currentTheme = Theme.colors.find((c) => c.id === Theme.current);
    const currentColor = currentTheme.color;
    const currentInk = currentTheme.ink || '#000000';
    const lossless = (f) => f === 'flac' || f === 'wav';
    const tabs = [['appearance', 'Appearance'], ['playback', 'Playback'], ['downloads', 'Downloads'],
        ['spotify', 'Spotify'], ...(!S.init.on_phone ? [['phone', 'Phone access']] : []), ['about', 'About']];
    const initialTab = tabs.some(([key]) => key === focus) ? focus : 'appearance';
    $('#modalRoot').innerHTML = html`
        <div class="modal-backdrop" data-close>
            <div class="modal wide settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
                <div class="modal-head"><h2 id="settingsTitle">Settings</h2>
                    <button type="button" class="icon-btn" data-close aria-label="Close settings">${icon('close', 18)}</button></div>
                <div class="settings-tabs" role="tablist" aria-label="Settings sections">
                    ${tabs.map(([key, label]) => html`<button type="button" role="tab" id="settings-tab-${key}" aria-controls="settings-panel-${key}" aria-selected="${String(key === initialTab)}" tabindex="${key === initialTab ? 0 : -1}" data-settings-tab="${key}">${label}</button>`)}
                </div>
                <div class="settings-panels">

                <section class="modal-section" role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance" ${initialTab === 'appearance' ? '' : new Safe('hidden')}>
                    <h3 id="appearanceTitle">Appearance</h3>
                    <div class="field">
                        <label for="setThemeMode">Theme</label>
                        <select id="setThemeMode">
                            ${[['dark', 'Dark'], ['light', 'Light'], ['system', 'System — follow device settings'],
                                ['daylight', 'Light by day, dark at night'], ['nightlight', 'Dark by day, light at night']].map(([value, label]) => html`<option value="${value}" ${value === Theme.mode ? new Safe('selected') : ''}>${label}</option>`)}
                        </select>
                    </div>
                    <div id="themeSchedule" ${Theme.scheduled ? '' : new Safe('hidden')}>
                        <div class="theme-schedule-times">
                            <label class="field"><span>Day starts</span><input class="field-input plain" id="themeDayStart" type="time" value="${Theme.schedule.day}" required></label>
                            <label class="field"><span>Night starts</span><input class="field-input plain" id="themeNightStart" type="time" value="${Theme.schedule.night}" required></label>
                        </div>
                        <p class="field-note" id="themeScheduleStatus" role="status"></p>
                        <p class="form-error" id="themeScheduleError" role="alert" hidden></p>
                    </div>
                    <fieldset class="theme-picker" id="themeChoices" aria-describedby="themeNote">${colorChoices()}</fieldset>
                    <p class="field-note" id="themeNote">Changes buttons, highlights and charts. Saved automatically on this device.</p>
                    <div class="appearance-effects">
                        <fieldset class="surface-style-picker">
                            <legend>Surface style</legend>
                            ${[['solid', 'Solid', 'Clean, flat surfaces'], ['glass', 'Glass', 'Transparent, blurred surfaces'],
                                ['liquid', 'Liquid Glass', 'Refractive highlights and fluid translucent surfaces'],
                                ['neumorphism', 'Neumorphism', 'Soft raised and inset surfaces'],
                                ['skeuomorphism', 'Skeuomorphism', 'Tactile, hardware-inspired controls'],
                                ['claymorphism', 'Claymorphism', 'Soft, rounded and dimensional surfaces'],
                                ['minimalism', 'Minimalism', 'Quiet, precise and distraction-free'],
                                ['neobrutalism', 'Neo-brutalism', 'Bold outlines, hard shadows and contrast']].map(([value, label, note]) => html`
                                <label class="surface-style-choice"><input class="sr-only" type="radio" name="surfaceStyle" value="${value}" ${Theme.surface === value ? new Safe('checked') : ''}>
                                    <span><strong>${label}</strong><small>${note}</small></span>${icon('checkPlain', 16)}</label>`)}</fieldset>
                        <div class="glass-transparency" id="glassTransparencyField" ${Theme.glass ? '' : new Safe('hidden')}>
                            <div class="glass-transparency-label"><label for="glassTransparency">Transparency</label><output id="glassTransparencyValue" for="glassTransparency">${Theme.transparency}%</output></div>
                            <input class="bar" id="glassTransparency" type="range" min="10" max="100" step="1" value="${Theme.transparency}" aria-describedby="glassTransparencyNote">
                            <p class="field-note" id="glassTransparencyNote">At 100%, the background is fully visible with a subtle contrast tint behind text.</p>
                        </div>
                    </div>
                    <details class="custom-theme">
                        <summary>Custom color</summary>
                        <form id="customColorForm">
                            <div class="custom-color-fields">
                                <div class="field"><label for="customColorHex">Color</label><div class="custom-color-entry">
                                    <input type="color" id="customColorPicker" value="${currentColor}" aria-label="Pick a custom color">
                                    <input class="field-input plain" id="customColorHex" aria-label="Hex color" value="${currentColor}" pattern="#[a-fA-F0-9]{6}" maxlength="7" spellcheck="false" autocapitalize="off" required>
                                </div></div>
                                <div class="field"><label for="customInkHex">Text and icon color</label><div class="custom-color-entry">
                                    <input type="color" id="customInkPicker" value="${currentInk}" aria-label="Pick text and icon color">
                                    <input class="field-input plain" id="customInkHex" aria-label="Text and icon hex color" value="${currentInk}" pattern="#[a-fA-F0-9]{6}" maxlength="7" spellcheck="false" autocapitalize="off" required>
                                </div></div>
                                <label class="field"><span>Color name</span><input class="field-input plain" id="customColorName" placeholder="e.g. Sunset" maxlength="32" required></label>
                            </div>
                            <p class="field-note">The first color fills selected controls. Pair it with dark or light text and icons for clear contrast.</p>
                            <p class="form-error" id="customColorError" role="alert" hidden></p>
                            <div class="custom-color-save"><span class="field-note" id="customColorStatus" role="status"></span><button class="pill-btn primary" type="submit">Save new color</button></div>
                        </form>
                    </details>
                </section>

                <section class="modal-section" role="tabpanel" id="settings-panel-spotify" aria-labelledby="settings-tab-spotify" ${initialTab === 'spotify' ? '' : new Safe('hidden')}>
                    <h3 id="credsTitle">Spotify connection</h3>
                    <div id="connStatus">${connectionLine(S.init)}</div>
                    <form id="credsForm" autocomplete="off">
                        <div class="field">
                            <label for="credId">Client ID</label>
                            <input class="field-input" id="credId" name="client_id" spellcheck="false" autocapitalize="off" maxlength="64" placeholder="32 letters and numbers">
                        </div>
                        <div class="field">
                            <label for="credSecret">Client Secret</label>
                            <div class="input-row">
                                <input class="field-input" id="credSecret" name="client_secret" type="password" autocomplete="new-password" spellcheck="false" maxlength="64" placeholder="32 letters and numbers">
                                <button type="button" class="pill-btn" id="credReveal" aria-pressed="false">Show</button>
                            </div>
                        </div>
                        <details class="how-to"><summary>Where do I get these?</summary>
                            <ol>
                                <li>Open the <a href="https://developer.spotify.com/dashboard/" target="_blank" rel="noopener">Spotify developer dashboard</a> → <strong>Create app</strong>.</li>
                                <li>Any name and description. Redirect URI: <code>http://127.0.0.1:8000/callback</code> (required, never used). Tick <strong>Web API</strong>.</li>
                                <li>Open the app → <strong>Settings</strong>, copy the Client ID, then <strong>View client secret</strong>.</li>
                            </ol>
                        </details>
                        <p class="form-error" id="credError" role="alert" hidden></p>
                        <div class="modal-actions">
                            <small class="field-note">Tested with Spotify before saving. Stored in <code>.env</code> on this computer only; the secret is never shown again.</small>
                            <button type="submit" class="pill-btn primary" id="credSave">Save & test</button>
                        </div>
                    </form>
                </section>

                ${S.init.on_phone ? '' : html`<section class="modal-section" role="tabpanel" id="settings-panel-phone" aria-labelledby="settings-tab-phone" ${initialTab === 'phone' ? '' : new Safe('hidden')}>
                    <h3 id="phoneTitle">Phone access</h3>
                    <div class="field">
                        <label class="check"><input type="checkbox" id="setPhone"> Open spotDLr on your phone</label>
                        <small>Scan a QR code with your phone's camera to use spotDLr in its browser: on the same Wi-Fi, or anywhere with Tailscale. Music plays on the phone, streamed from this computer, which has to stay on and awake. Only phones that scanned the code get in. Turning this off pauses it: phones get back in when you turn it on again.</small>
                    </div>
                    <div id="phonePanel" class="phone-panel" hidden></div>
                </section>`}

                <section class="modal-section" role="tabpanel" id="settings-panel-playback" aria-labelledby="settings-tab-playback" ${initialTab === 'playback' ? '' : new Safe('hidden')}>
                    <h3 id="pbTitle">Playback</h3>
                    ${S.init.on_phone ? html`<fieldset class="remote-device" id="remoteDevice">
                        <legend>Play on</legend>
                        <div class="remote-device-options three">
                            <label class="remote-device-card"><input class="sr-only" type="radio" name="playbackDevice" value="local" ${R.mode === 'local' ? new Safe('checked') : ''}>
                                <span class="remote-device-icon">${icon('phone', 22)}</span><span class="remote-device-copy"><strong>This phone</strong><small>${R.mode === 'local' ? 'Playing separately here' : 'Open this phone’s session'}</small></span><span class="remote-device-check">${icon('checkPlain', 16)}</span></label>
                            <label class="remote-device-card"><input class="sr-only" type="radio" name="playbackDevice" value="listen" ${R.mode === 'listen' ? new Safe('checked') : ''}>
                                <span class="remote-device-icon">${icon('speaker', 22)}</span><span class="remote-device-copy"><strong>Listen Here</strong><small>${R.mode === 'listen' ? 'Transferred to this phone' : 'Move current listening here'}</small></span><span class="remote-device-check">${icon('checkPlain', 16)}</span></label>
                            <label class="remote-device-card"><input class="sr-only" type="radio" name="playbackDevice" value="remote" ${R.mode === 'remote' ? new Safe('checked') : ''}>
                                <span class="remote-device-icon">${icon('computer', 22)}</span><span class="remote-device-copy"><strong>Remote · ${R.source?.name || 'Computer'}</strong><small>${R.mode === 'remote' ? 'Controlling this device' : 'Keep audio on this device'}</small></span><span class="remote-device-check">${icon('checkPlain', 16)}</span></label>
                        </div>
                        <small class="remote-device-status ${R.mode !== 'remote' || R.online ? 'connected' : ''}" id="remoteDeviceStatus" role="status"><i aria-hidden="true"></i><span>${R.mode === 'remote' ? (R.online ? `Connected to ${R.source?.name || 'the computer'}` : 'Looking for the computer player…') : R.mode === 'listen' ? 'Listening transferred to this phone' : 'This phone has its own session'}</span></small>
                    </fieldset>` : ''}
                    <div class="field">
                        ${VOLUME_WORKS ? '' : html`<p class="field-note">On iPhone and iPad, Safari doesn't let web pages change the volume, so these two only work on a computer or Android.</p>`}
                        <label class="check"><input type="checkbox" id="setNormalize" ${PB.normalize ? new Safe('checked') : ''} ${VOLUME_WORKS ? '' : new Safe('disabled')}> Even out volume</label>
                        <small>Plays every song at about the same loudness, like Spotify's “Normalize volume”: loud songs are turned down to match the rest, nothing is boosted. spotDLr measures each song once (about a second each, in the background).</small>
                        <small id="loudStatus" role="status"></small>
                    </div>
                    <div class="field">
                        <label class="check"><input type="checkbox" id="setDirectViz" ${V.analysis === 'clone' ? 'checked' : ''}> Direct sound while visualizing</label>
                        <small>The players keep a straight line to the speakers and the visualizer reads a silent twin of the same song instead — the analysis path can never change the volume. Use this if the default analysis quiets music on this phone.</small>
                    </div>
                    <div class="field">
                        <label for="setCrossfade">Crossfade <span class="field-value" id="crossfadeValue">${PB.crossfade ? `${PB.crossfade} s` : 'Off'}</span></label>
                        <input type="range" class="bar" id="setCrossfade" min="0" max="12" step="1" value="${PB.crossfade}" ${VOLUME_WORKS ? '' : new Safe('disabled')} aria-valuetext="${PB.crossfade ? `${PB.crossfade} seconds` : 'Off'}">
                        <small>The end of each song blends into the start of the next. Not on Repeat one, or when a song is shorter than twice this.</small>
                    </div>
                    ${soundSettings()}
                </section>

                <section class="modal-section" role="tabpanel" id="settings-panel-downloads" aria-labelledby="settings-tab-downloads" ${initialTab === 'downloads' ? '' : new Safe('hidden')}>
                    <h3 id="dlTitle">Downloads</h3>
                    <form id="dlForm">
                        <div class="field">
                            <label for="setFormat">Format</label>
                            <select id="setFormat">
                                ${[['m4a', 'M4A (AAC) — recommended'], ['mp3', 'MP3 — plays everywhere'], ['opus', 'Opus — smallest'], ['flac', 'FLAC — lossless container'], ['wav', 'WAV — uncompressed']]
                                    .map(([v, label]) => html`<option value="${v}" ${v === s.format ? new Safe('selected') : ''}>${label}</option>`)}
                            </select>
                        </div>
                        <div class="field">
                            <label for="setBitrate">Quality</label>
                            <select id="setBitrate" ${lossless(s.format) ? new Safe('disabled') : ''}>
                                ${[['auto', 'Auto — keep source quality (recommended)'], ['128', '128 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']]
                                    .map(([v, label]) => html`<option value="${v}" ${v === s.bitrate ? new Safe('selected') : ''}>${label}</option>`)}
                            </select>
                            <small>Songs come from YouTube Music at about 128–160 kbps. Higher settings re-encode to a bigger file but can't add detail that isn't there.</small>
                        </div>
                        <div class="field">
                            <label class="check"><input type="checkbox" id="setLyrics" ${s.lyrics ? new Safe('checked') : ''}> Save synced lyrics (.lrc files)</label>
                            <small>For new music downloads.</small>
                        </div>
                        <div class="modal-actions"><button type="submit" class="pill-btn primary">Save download settings</button></div>
                    </form>
                    <div class="field lyrics-save">
                        <span class="label">Lyrics for existing music</span>
                        <small>Save available synced lyrics from LRCLIB beside songs already in your library. Existing .lrc files are kept. You can close Settings while it runs; keep spotDLr running.</small>
                        <button type="button" class="pill-btn" id="saveLibraryLyrics" disabled>${icon('downloadPlain', 16)} Download library lyrics</button>
                        <small id="lyricsSaveStatus" role="status"></small>
                    </div>
                </section>

                <section class="modal-section about" role="tabpanel" id="settings-panel-about" aria-labelledby="settings-tab-about" ${initialTab === 'about' ? '' : new Safe('hidden')} tabindex="0">
                    <div class="about-name">${icon('spotDLr', 20)}<strong>spotDLr</strong><span class="about-version">${S.init.version ? `Version ${S.init.version}` : ''}</span></div>
                    ${buildLine(S.init.build, S.init.version)}
                    <p class="about-build" id="swStatus">Checking offline support…</p>
                    <p class="about-build" id="clientVer" title="The JavaScript this screen actually runs">App code: checking…</p>
                    <div class="field about-update">
                        <button type="button" class="pill-btn" id="checkForUpdates">Check for updates</button>
                        <button type="button" class="pill-btn" id="forceRefresh">Force refresh app files</button>
                        <small id="updateStatus" role="status"></small>
                    </div>
                    <a class="link about-link" href="https://github.com/HoldenGrant/spotDLr-web_ui/blob/main/CHANGELOG.md" target="_blank" rel="noopener">What's new</a>
                    <a class="link about-link" href="#/tidy" data-close>Tidy up your library</a>
                    <a class="link about-link" href="#/schedules" data-close>Scheduled plays</a>
                </section>
                </div>
            </div>
        </div>`.s;

    // Listeners go on the backdrop, which is thrown away on close, so they never pile up
    const backdrop = $('#modalRoot .modal-backdrop');
    const cv = $('#clientVer', backdrop);
    if (cv) {
        const tag = (document.querySelector('script[src*="app.js"]') || {}).src || '';
        const m = /app\.js\?v=([^&"']+)/.exec(tag);
        cv.textContent = 'App code: ' + (m ? m[1] : 'unknown (old build?)');
    }
    (async () => {
        const el = $('#swStatus', backdrop);
        if (!el) return;
        if (!('serviceWorker' in navigator)) { el.textContent = 'Offline: not supported by this browser.'; return; }
        let ver = '?';
        try {
            const text = await (await fetch('/sw.js', { cache: 'no-store' })).text();
            const m = /spotdlr-phone-v(\d+)/.exec(text);
            if (m) ver = `v${m[1]}`;
        } catch { /* offline: fall through to cache inspection */ }
        let songs = 0, controlled = !!(navigator.serviceWorker.controller);
        try {
            const keys = await caches.keys();
            const found = keys.find((k) => k === 'spotdlr-music' || /^spotdlr-phone-v\d+-music$/.test(k));
            if (found) songs = (await caches.open(found).then((c) => c.keys())).length;
        } catch { /* no cache access */ }
        let persisted = null;
        try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch { /* unsupported */ }
        const storageNote = persisted === null ? '' : persisted ? ', storage protected from eviction' : ', ⚠ storage evictable';
        el.textContent = controlled
            ? `Offline: worker ${ver} active, ${songs} song${songs === 1 ? '' : 's'} cached on this device${storageNote}.`
            : `Offline: worker not in control (served ${ver}, ${songs} songs cached${storageNote}). Reload once on this address, then retry.`;
    })();
    const opener = document.activeElement;
    const close = () => { $('#modalRoot').innerHTML = ''; if (opener && opener.focus) opener.focus(); };
    backdrop.addEventListener('click', (e) => { if (e.target.closest('[data-close]') && (e.target === backdrop || e.target.closest('button[data-close], a[data-close]'))) close(); });
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    const prepareRemoteTransfer = () => {
        if (!S.init.on_phone) return;
        api('/remote/status').then((status) => {
            R.online = !!status.online;
            R.source = status.source || null;
            R.state = status.state || null;
            prepareListenHere(R.state);
        }).catch(() => {});
    };
    if (initialTab === 'playback') prepareRemoteTransfer();

    $('#checkForUpdates', backdrop)?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const status = $('#updateStatus', backdrop);
        button.disabled = true;
        status.textContent = 'Checking…';
        try {
            const response = await fetch('https://api.github.com/repos/HoldenGrant/spotDLr-web_ui/releases/latest', {
                headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store',
            });
            if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
            const release = await response.json();
            const numbers = (value) => String(value || '').replace(/^v/i, '').split('.').map((part) => parseInt(part, 10) || 0);
            const compare = (left, right) => {
                const a = numbers(left), b = numbers(right);
                for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
                    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
                }
                return 0;
            };
            if (compare(release.tag_name, S.init.version) > 0) {
                status.innerHTML = html`<a class="link" href="${release.html_url}" target="_blank" rel="noopener">Version ${String(release.tag_name).replace(/^v/i, '')} is available. Download update</a>`.s;
            } else {
                status.textContent = `You have the latest release (${S.init.version}).`;
            }
        } catch (_) {
            status.textContent = 'Could not check right now. Try again when connected to the internet.';
        } finally {
            button.disabled = false;
        }
    });

    $('#forceRefresh', backdrop)?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const status = $('#updateStatus', backdrop);
        button.disabled = true;
        status.textContent = 'Clearing cached files…';
        try {
            if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
            if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
        } catch { /* reload anyway */ }
        location.reload();
    });

    const tabButtons = $$('[data-settings-tab]', backdrop);
    const selectTab = (key, focusTab = false) => {
        for (const button of tabButtons) {
            const selected = button.dataset.settingsTab === key;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && focusTab) button.focus();
        }
        $$('[role="tabpanel"]', backdrop).forEach((panel) => { panel.hidden = panel.id !== `settings-panel-${key}`; });
        $('.settings-panels', backdrop).scrollTop = 0;
        if (key === 'playback') prepareRemoteTransfer();
    };
    tabButtons.forEach((button, index) => {
        button.addEventListener('click', () => selectTab(button.dataset.settingsTab));
        button.addEventListener('keydown', (event) => {
            const next = { ArrowRight: (index + 1) % tabButtons.length, ArrowLeft: (index + tabButtons.length - 1) % tabButtons.length,
                Home: 0, End: tabButtons.length - 1 }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            selectTab(tabButtons[next].dataset.settingsTab, true);
        });
    });

    backdrop.addEventListener('change', (event) => {
        if (event.target.name === 'themeColor' && event.target.checked) Theme.set(event.target.value);
        if (event.target.name === 'playbackDevice' && event.target.checked) {
            setPlaybackDevice(event.target.value);
            const phoneCopy = $('input[value="local"]', backdrop)?.closest('.remote-device-card')?.querySelector('small');
            const listenCopy = $('input[value="listen"]', backdrop)?.closest('.remote-device-card')?.querySelector('small');
            const computerCopy = $('input[value="remote"]', backdrop)?.closest('.remote-device-card')?.querySelector('small');
            if (phoneCopy) phoneCopy.textContent = R.mode === 'local' ? 'Playing separately here' : 'Open this phone’s session';
            if (listenCopy) listenCopy.textContent = R.mode === 'listen' ? 'Transferred to this phone' : 'Move current listening here';
            if (computerCopy) computerCopy.textContent = R.mode === 'remote' ? 'Controlling this device' : 'Keep audio on this device';
            const messages = { local: 'This phone has its own session', listen: 'Transferring listening to this phone…', remote: 'Connecting to the computer player…' };
            setRemoteDeviceStatus(messages[event.target.value], event.target.value !== 'remote');
        }
    });
    $('#setThemeMode', backdrop).addEventListener('change', (event) => Theme.setMode(event.target.value));
    const glassField = $('#glassTransparencyField', backdrop);
    const glassRange = $('#glassTransparency', backdrop), glassValue = $('#glassTransparencyValue', backdrop);
    setRangeFill(glassRange);
    $$('input[name="surfaceStyle"]', backdrop).forEach((choice) => choice.addEventListener('change', () => {
        if (!choice.checked) return;
        Theme.setSurface(choice.value);
        glassField.hidden = !['glass', 'liquid'].includes(choice.value);
    }));
    glassRange.addEventListener('input', () => {
        Theme.setTransparency(glassRange.value);
        glassValue.textContent = `${Theme.transparency}%`;
        setRangeFill(glassRange);
    });
    updateThemeScheduleStatus();
    $('#themeSchedule', backdrop).addEventListener('change', () => {
        const err = $('#themeScheduleError', backdrop);
        try {
            Theme.setSchedule($('#themeDayStart', backdrop).value, $('#themeNightStart', backdrop).value);
            err.hidden = true;
        } catch (error) { err.textContent = error.message; err.hidden = false; }
    });
    const picker = $('#customColorPicker', backdrop), hex = $('#customColorHex', backdrop);
    const inkPicker = $('#customInkPicker', backdrop), inkHex = $('#customInkHex', backdrop);
    const suggestedInk = (color) => Theme.contrastInk(color);
    let inkWasEdited = false;
    const updateSuggestedInk = () => {
        if (inkWasEdited || !/^#[a-f\d]{6}$/i.test(hex.value)) return;
        inkHex.value = inkPicker.value = suggestedInk(hex.value);
    };
    picker.addEventListener('input', () => { hex.value = picker.value; updateSuggestedInk(); });
    hex.addEventListener('input', () => { if (/^#[a-f\d]{6}$/i.test(hex.value)) { picker.value = hex.value; updateSuggestedInk(); } });
    inkPicker.addEventListener('input', () => { inkWasEdited = true; inkHex.value = inkPicker.value; });
    inkHex.addEventListener('input', () => { inkWasEdited = true; if (/^#[a-f\d]{6}$/i.test(inkHex.value)) inkPicker.value = inkHex.value; });
    $('#customColorForm', backdrop).addEventListener('submit', (event) => {
        event.preventDefault();
        const err = $('#customColorError', backdrop), status = $('#customColorStatus', backdrop);
        status.textContent = '';
        try {
            const theme = Theme.saveCustom($('#customColorName', backdrop).value, hex.value, inkHex.value);
            $('#themeChoices', backdrop).innerHTML = colorChoices().s;
            err.hidden = true;
            status.textContent = `Saved ${theme.name}.`;
            $('#customColorName', backdrop).value = '';
            inkWasEdited = false;
            event.submitter?.scrollIntoView({ block: 'nearest' });
        } catch (error) { err.textContent = error.message; err.hidden = false; }
    });

    const lyricsButton = $('#saveLibraryLyrics');
    const lyricsStatus = $('#lyricsSaveStatus');
    let lyricsTimer = 0;
    const showLyricsSave = (st) => {
        if (!backdrop.isConnected) return;
        clearTimeout(lyricsTimer);
        lyricsButton.disabled = st.running || !S.tracks.length;
        lyricsButton.innerHTML = st.running
            ? html`${icon('loader', 16, 'spinning')} Downloading lyrics…`.s
            : html`${icon('downloadPlain', 16)} Download library lyrics`.s;
        lyricsStatus.textContent = !S.tracks.length && !st.total ? 'Your library has no songs yet.' : st.total || st.running
            ? `${st.running ? `Checked ${st.done} of ${st.total}` : 'Finished'}: ${st.saved} saved, ${st.existing} already had lyrics, ${st.unavailable} unavailable, ${st.failed} failed.${st.error ? ` Last error: ${st.error}` : ''}` : '';
        if (st.running) lyricsTimer = setTimeout(loadLyricsSave, 1500);
    };
    const lyricsSaveError = (error) => {
        if (!backdrop.isConnected) return;
        lyricsStatus.textContent = `Couldn't check lyrics downloads: ${error.message}. Try again.`;
        lyricsButton.disabled = !S.tracks.length;
        lyricsButton.innerHTML = html`${icon('downloadPlain', 16)} Download library lyrics`.s;
    };
    const loadLyricsSave = () => {
        if (backdrop.isConnected) api('/lyrics/save-status').then(showLyricsSave).catch(lyricsSaveError);
    };
    lyricsButton.addEventListener('click', () => {
        clearTimeout(lyricsTimer);
        lyricsButton.disabled = true;
        lyricsStatus.textContent = 'Starting lyrics download…';
        api('/lyrics/save-library', { method: 'POST' }).then(showLyricsSave).catch(lyricsSaveError);
    });
    loadLyricsSave();

    if (S.init.on_phone) { // Spotify keys are changed on the computer only (the server refuses it from a phone)
        $$('#credsForm input, #credsForm button').forEach((el) => { el.disabled = true; });
        $('#credsForm').insertAdjacentHTML('afterbegin', html`<p class="field-note">Change these on the computer running spotDLr.</p>`.s);
    }

    // Phone access: on/off, then the QR code (drawn here by the vendored qrcode-generator, no network)
    if (!S.init.on_phone) {
        let qrKind = null; // 'tailscale' | 'wifi': which code is shown
        const showPhone = (st) => {
            $('#setPhone').checked = st.enabled;
            const panel = $('#phonePanel');
            panel.hidden = !st.enabled;
            if (!st.enabled) { panel.innerHTML = ''; return; }
            const ts = st.tailscale || {}, tss = ts.status || {};
            if (!ts.url && qrKind === 'tailscale') qrKind = null;
            const kind = qrKind || (ts.url ? 'tailscale' : 'wifi');
            const url = kind === 'tailscale' ? ts.url : st.url;
            const address = kind === 'tailscale' ? ts.address : st.address;
            const tsBlock = !tss.installed
                ? html`<p class="phone-ts-note">Away from home too? Install <a class="link" href="https://tailscale.com/download" target="_blank" rel="noopener">Tailscale</a> (free) on this computer and your phone, then come back here.</p>`
                : html`<label class="check"><input type="checkbox" id="setTailscale" ${ts.enabled ? new Safe('checked') : ''} ${tss.running || ts.enabled ? '' : new Safe('disabled')}> Also away from home, with Tailscale</label>
                    <small>${tss.running ? html`Your phone needs the Tailscale app, signed in as <b>${tss.account || 'the same account'}</b>. Music then reaches it anywhere, privately (only your devices can connect), over HTTPS.` : 'Tailscale is off on this computer. Turn it on (menu bar → Tailscale → Connect) to use this.'}</small>
                    ${ts.enabled ? html`<label class="check phone-funnel"><input type="checkbox" id="setFunnel" ${ts.funnel ? new Safe('checked') : ''}> Also devices without Tailscale (Tailscale Funnel)</label>
                    <small>${ts.funnel
                        ? html`<b>On:</b> this address is on the public internet, so any phone or tablet can open it, at home or away, with no app. Only devices that scanned the code get in; everyone else sees “Scan the QR code”.`
                        : 'Puts this address on the public internet so phones and tablets without the Tailscale app can use it too, anywhere. Only devices that scanned the code get in, but anyone with the address can reach the sign-in page. Leave it off if every device has Tailscale.'}</small>` : ''}
                    ${ts.error ? html`<p class="dupe-warn">${icon('warn', 14)} ${ts.error}</p>` : ''}`;
            if (!url) {
                panel.innerHTML = html`<div class="phone-help"><p class="dupe-warn">${icon('warn', 14)} ${st.error || 'Starting…'}</p>${tsBlock}</div>`.s;
                if (!st.error) setTimeout(() => api('/phone').then(showPhone), 1000);
                bindTs();
                return;
            }
            loadQr().then(() => {
                const qr = qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                panel.innerHTML = html`
                    ${ts.url && st.url ? html`<div class="filter-row phone-kind" role="group" aria-label="Which code">${[['tailscale', ts.funnel ? 'Anywhere' : 'Anywhere (Tailscale)'], ['wifi', 'Home Wi-Fi only']].map(([k, label]) =>
                        html`<button type="button" class="chip ${k === kind ? 'active' : ''}" data-qr-kind="${k}" aria-pressed="${String(k === kind)}">${label}</button>`)}</div>` : ''}
                    <div class="phone-row">
                        <div class="phone-qr" role="img" aria-label="QR code for ${address}">${new Safe(qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true }))}</div>
                        <div class="phone-help">
                            <ol>${kind === 'tailscale' && ts.funnel
                                ? html`<li>Point any phone or tablet's camera at the code and tap the link: no Tailscale app needed.</li><li>Add it to your home screen: it opens like an app, at home or away.</li>`
                                : kind === 'tailscale'
                                ? html`<li>On your phone, open the Tailscale app and make sure it's connected.</li><li>Point the camera at the code and tap the link.</li><li>Add it to your home screen: it opens like an app, at home or away. Keep Tailscale connected, at home too: this link always goes through it.</li>`
                                : html`<li>Connect your phone to the same Wi-Fi as this computer.</li><li>Open the camera and point it at the code.</li><li>Tap the link. Bookmark it to come back without scanning.</li>`}</ol>
                            <p class="phone-address">${address}</p>
                            <button type="button" class="pill-btn small" id="phoneNewKey">New QR code</button>
                            <small>Signs out every phone that used the old one.</small>
                            ${kind === 'wifi' && st.ip_url ? html`<small>Uses this computer's name on your network, which stays the same when your router changes its number address. If the link doesn't open on your phone, use <a class="link" href="${st.ip_url}">${st.ip_url.split('/?')[0]}</a> instead (it changes when the router gives this computer a new address).</small>` : ''}
                            ${kind === 'wifi' ? html`<small>If the phone can't connect: check it's on the same Wi-Fi, and if this computer asked whether to allow incoming connections (for Python or spotDLr), allow them.</small>` : ''}
                        </div>
                    </div>
                    <div class="phone-ts">${tsBlock}</div>`.s;
                $('#phoneNewKey').addEventListener('click', () => api('/phone/new-key', { method: 'POST' }).then((x) => { showPhone(x); toast('New QR code. Phones that used the old one are signed out.'); }).catch((err) => toast(err.message, 'error')));
                $$('[data-qr-kind]', panel).forEach((b) => b.addEventListener('click', () => { qrKind = b.dataset.qrKind; showPhone(st); }));
                bindTs();
            }).catch(() => { panel.textContent = `Open ${url} on your phone.`; });
        };
        const bindTs = () => {
            const funnel = $('#setFunnel');
            if (funnel) funnel.addEventListener('change', () => {
                funnel.disabled = true;
                api('/phone', { method: 'POST', body: JSON.stringify({ funnel: funnel.checked }) }).then((x) => {
                    showPhone(x);
                    if (x.tailscale.error) toast(x.tailscale.error, 'error');
                    else toast(x.tailscale.funnel ? 'Funnel on: any device with the code can connect, no Tailscale needed' : 'Funnel off: only your Tailscale devices can reach this address');
                }).catch((err) => { toast(err.message, 'error'); funnel.checked = !funnel.checked; funnel.disabled = false; });
            });
            const box = $('#setTailscale');
            if (!box) return;
            box.addEventListener('change', () => {
                box.disabled = true;
                api('/phone', { method: 'POST', body: JSON.stringify({ tailscale: box.checked }) }).then((x) => {
                    qrKind = null;
                    showPhone(x);
                    if (x.tailscale.error) toast(x.tailscale.error, 'error');
                    else if (x.tailscale.enabled) toast('Tailscale on: the QR code now works anywhere');
                }).catch((err) => { toast(err.message, 'error'); box.checked = !box.checked; box.disabled = false; });
            });
        };
        api('/phone').then(showPhone).catch(() => {});
        $('#setPhone').addEventListener('change', (e) => {
            api('/phone', { method: 'POST', body: JSON.stringify({ enabled: e.target.checked }) }).then((st) => {
                showPhone(st);
                if (!st.enabled) toast('Phone access paused. Phones get back in when you turn it on again.');
            }).catch((err) => { toast(err.message, 'error'); e.target.checked = !e.target.checked; });
        });
    }

    // Playback settings save as you change them (no Save button: you hear the difference right away)
    const loudStatus = () => api('/loudness').then((r) => {
        const el = $('#loudStatus');
        if (!el) return;
        el.textContent = !PB.normalize ? '' : r.running ? `Measuring songs…${r.total ? ` ${r.done} of ${r.total}` : ''}` : `${plural(r.measured, 'song')} measured`;
        if (r.running && PB.normalize) setTimeout(loudStatus, 2000);
    }).catch(() => {});
    $('#setDirectViz').addEventListener('change', (e) => setAnalysis(e.target.checked ? 'clone' : 'tap'));
    $('#setNormalize').addEventListener('change', (e) => {
        PB.normalize = e.target.checked;
        store.set('normalize', PB.normalize);
        if (PB.normalize) api('/loudness/scan', { method: 'POST' }).then(loudStatus).catch(() => {});
        else $('#loudStatus').textContent = '';
        if (currentTrack()) setTrackGain(currentTrack().id);
    });
    loudStatus();
    const xf = $('#setCrossfade');
    setRangeFill(xf);
    xf.addEventListener('input', () => {
        PB.crossfade = +xf.value;
        store.set('crossfade', PB.crossfade);
        $('#crossfadeValue').textContent = PB.crossfade ? `${PB.crossfade} s` : 'Off';
        xf.setAttribute('aria-valuetext', PB.crossfade ? `${PB.crossfade} seconds` : 'Off');
        setRangeFill(xf);
        if (!PB.crossfade) endFade();
    });
    bindSoundSettings();

    // Current status from the server (the cached S.init may be stale)
    api('/credentials').then((c) => {
        $('#connStatus').innerHTML = connectionLine(c).s;
        if (c.client_id_hint) $('#credId').placeholder = `Saved: ${c.client_id_hint} (enter a new one to replace it)`;
    }).catch(() => {});

    $('#credReveal').addEventListener('click', (e) => {
        const input = $('#credSecret');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        e.currentTarget.textContent = show ? 'Hide' : 'Show';
        e.currentTarget.setAttribute('aria-pressed', show);
    });

    $('#credsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#credId').value.trim();
        const secret = $('#credSecret').value.trim();
        const err = $('#credError');
        const showError = (msg) => { err.textContent = msg; err.hidden = false; };
        err.hidden = true;
        if (!/^[A-Za-z0-9]{32}$/.test(id)) return showError('The Client ID should be 32 letters and numbers. Copy it again from the dashboard.');
        if (!/^[A-Za-z0-9]{32}$/.test(secret)) return showError('The Client Secret should be 32 letters and numbers. Click "View client secret" in the dashboard and copy it.');
        const btn = $('#credSave');
        btn.disabled = true;
        btn.innerHTML = html`${icon('loader', 16, 'spinning')} Testing…`.s;
        try {
            const c = await api('/credentials', { method: 'POST', body: JSON.stringify({ client_id: id, client_secret: secret }) });
            S.init = { ...S.init, initialized: c.initialized, message: c.message }; // keep version, on_phone, …
            S.spotifyCache.clear();
            $('#connStatus').innerHTML = connectionLine(c).s;
            $('#credId').value = '';
            $('#credSecret').value = '';
            $('#credId').placeholder = `Saved: ${c.client_id_hint}`;
            toast(c.initialized ? 'Spotify connected' : 'Keys saved. Spotify isn\'t allowing requests yet (see the message above).', c.initialized ? '' : 'error');
            rerender();
        } catch (error) {
            showError(error.message);
            $('#credSecret').focus();
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save & test';
        }
    });

    $('#setFormat').addEventListener('change', (e) => { $('#setBitrate').disabled = lossless(e.target.value); });
    $('#dlForm').addEventListener('submit', (e) => {
        e.preventDefault();
        S.settings = { format: $('#setFormat').value, bitrate: $('#setBitrate').value, lyrics: $('#setLyrics').checked };
        store.set('settings', S.settings);
        close();
        toast('Download settings saved');
        if (route().name === 'downloads') rerender();
    });
    (initialTab === 'spotify' && !S.init.on_phone ? $('#credId') : initialTab === 'downloads' ? $('#setFormat') : $(`#settings-tab-${initialTab}`)).focus();
}

// ---------- sidebar ----------

function setSidebarCollapsed(collapsed) {
    $('.app').classList.toggle('sidebar-collapsed', collapsed);
    const button = $('#sidebarToggle');
    button.innerHTML = icon(collapsed ? 'sidebarExpand' : 'sidebarCollapse', 20).s;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    button.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    store.set('sidebarCollapsed', collapsed);
}

// Your Library: drawn into the sidebar, and into the Library page (#/library, the phone's "Your Library" tab)
// when it's open. Same filter, search and sort state for both.
function renderSidebar() {
    const prefixes = matchMedia('(max-width: 600px)').matches ? ['pageLibrary'] : ['library', 'pageLibrary'];
    for (const prefix of prefixes) if ($(`#${prefix}List`)) renderLibraryInto(prefix);
    highlightSidebar();
    markPlaying();
}

function renderLibraryInto(prefix) {
    $(`#${prefix}Chips`).innerHTML = html`${[['all', 'All'], ['playlist', 'Playlists'], ['album', 'Albums'], ['artist', 'Artists']].map(([key, label]) =>
        html`<button class="chip ${S.libFilter === key ? 'active' : ''}" data-lib-filter="${key}">${label}</button>`)}`.s;

    const sortLabel = LIB_SORTS.find(([key]) => key === S.libSort)?.[1] || LIB_SORTS[0][1];
    $(`#${prefix}Sort`).innerHTML = html`<span>${sortLabel}</span>${icon('down', 14)}`.s;
    $(`#${prefix}Sort`).setAttribute('aria-label', `Sort Your Library: ${sortLabel}`);

    const q = S.libQuery.trim().toLowerCase();
    const match = (text) => !q || text.toLowerCase().includes(q);
    const pinned = []; // Liked Songs and All songs stay on top, as Spotify keeps Liked Songs
    const entries = []; // { key, name, creator, added, html }: sorted below
    if ((S.libFilter === 'all' || S.libFilter === 'playlist') && match('Liked Songs')) {
        pinned.push(html`<li class="lib-item" title="Liked Songs" data-href="#/liked" data-key="liked">${likedArt()}
            <div class="lib-item-text"><div class="lib-item-name">Liked Songs</div><div class="lib-item-sub">Playlist • ${plural(S.liked.size, 'song')}</div></div></li>`);
    }
    if (S.libFilter === 'all' && match('All songs')) {
        pinned.push(html`<li class="lib-item" title="All songs" data-href="#/songs" data-key="songs">${allSongsArt()}
            <div class="lib-item-text"><div class="lib-item-name">All songs</div><div class="lib-item-sub">Playlist • ${plural(S.tracks.length, 'song')}</div></div></li>`);
    }
    if (S.libFilter !== 'artist') {
        for (const c of S.collections) {
            if (S.libFilter !== 'all' && c.kind !== S.libFilter) continue;
            if (!match(c.name)) continue;
            const sub = c.kind === 'album' ? `Album • ${c.artist}` : `Playlist • ${plural(c.track_ids.length, 'song')}`;
            entries.push({ key: `collection:${c.key}`, name: c.name, creator: c.artist || '', added: c.added,
                html: html`<li class="lib-item" title="${c.name} — ${sub}" data-href="#/collection/${encodeURIComponent(c.key)}" data-key="collection:${c.key}">${collectionArt(c)}
                    <div class="lib-item-text"><div class="lib-item-name">${c.name}</div><div class="lib-item-sub">${sub}</div></div></li>` });
        }
    }
    if (S.libFilter === 'artist' || S.libFilter === 'all') {
        const artists = S.libFilter === 'all' ? S.artists.filter((a) => a.trackIds.length >= 3).slice(0, 12) : S.artists;
        for (const a of artists) {
            if (!match(a.name)) continue;
            entries.push({ key: `artist:${a.name}`, name: a.name, creator: a.name,
                added: Math.max(0, ...a.trackIds.map((id) => S.byId.get(id)?.added || 0)),
                html: html`<li class="lib-item" title="${a.name} — Artist" data-href="${artistHref(a.name)}" data-key="artist:${a.name}">${artistArt(a)}
                    <div class="lib-item-text"><div class="lib-item-name">${a.name}</div><div class="lib-item-sub">Artist</div></div></li>` });
        }
    }
    sortLibrary(entries, S.libSort);
    const items = [...pinned, ...entries.map((e) => e.html)];
    $(`#${prefix}List`).innerHTML = items.length ? html`${items}`.s : html`<li class="empty" style="padding:24px 8px">Nothing here yet</li>`.s;
}

function viewLibrary() {
    return html`<div class="view-pad library-page">
        <div class="library-page-head"><h1 class="greeting">Your Library</h1>
            <button class="icon-btn big" data-action="create-menu" aria-label="Create playlist or add music files" aria-haspopup="menu">${icon('plus', 22)}</button></div>
        <div class="chips" id="pageLibraryChips" role="group" aria-label="Filter library"></div>
        <div class="lib-tools">
            <label class="lib-filter">${icon('search', 14)}<span class="sr-only">Search in Your Library</span>
                <input id="pageLibraryFilterInput" type="search" placeholder="Search in Your Library" autocomplete="off" value="${S.libQuery}"></label>
            <button class="lib-sort" id="pageLibrarySort" data-action="lib-sort-menu" aria-haspopup="menu"></button>
        </div>
        <ul class="lib-list" id="pageLibraryList"></ul>
    </div>`;
}

const LIB_SORTS = [['recents', 'Recents'], ['added', 'Recently added'], ['alpha', 'Alphabetical'], ['creator', 'Creator']];

function sortLibrary(entries, sort) {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    const byAdded = (a, b) => b.added - a.added;
    const compare = {
        // Played most recently first; never played after those, newest added first
        recents: (a, b) => (S.recent[b.key] || 0) - (S.recent[a.key] || 0) || byAdded(a, b),
        added: byAdded,
        alpha: byName,
        // By artist (an album's artist, or the artist itself); playlists have none, so they go last
        creator: (a, b) => (!a.creator - !b.creator) || a.creator.localeCompare(b.creator, undefined, { sensitivity: 'base' }) || byName(a, b),
    }[sort] || byAdded;
    return entries.sort(compare);
}

function librarySortMenu(anchor) {
    showMenu([{ heading: 'Sort by' }, ...LIB_SORTS.map(([key, label]) => ({
        label, checked: S.libSort === key,
        run: () => { S.libSort = key; store.set('libSort', key); renderSidebar(); },
    }))], { anchor, label: 'Sort Your Library' });
}

function highlightSidebar() {
    const hash = location.hash || '#/';
    $$('.lib-item').forEach((item) => item.classList.toggle('active', item.dataset.href === hash));
}

// ---------- shared view pieces ----------

const contexts = new Map(); // id -> { ids, context } for play buttons in the current view
let ctxSeq = 0;
function registerContext(ids, context) {
    const id = `ctx${++ctxSeq}`;
    contexts.set(id, { ids, context });
    return id;
}

// Track table for local tracks
function localTable(tracks, context, { showAlbum = true, numbered = true, sort = null, sortable = false } = {}) {
    const ctx = registerContext(tracks.map((t) => t.id), context);
    if (S.trackView === 'grid') return trackGrid(tracks, context, ctx);
    // sortable (a playlist you made, list view): each row gets a drag handle; see makeSortable
    // With `sort` ({ key, dir }), the column titles are buttons that sort by that column
    const head = (key, label, cls = '') => {
        if (!sort) return html`<span class="${cls}">${label}</span>`;
        const on = sort.key === key;
        return html`<span class="${cls}" role="columnheader" aria-sort="${on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button class="sort-head ${on ? 'on' : ''}" data-action="songs-sort" data-sort="${key}" title="Sort by ${typeof label === 'string' ? label : 'duration'}" aria-label="Sort by ${SONG_SORTS.find(([k]) => k === key)[1]}">${label}${on ? icon(sort.dir === 'asc' ? 'up' : 'down', 14) : ''}</button></span>`;
    };
    return html`
    <div class="tracks ${showAlbum ? '' : 'no-album'}" role="grid" aria-label="${context.label}" ${sortable ? new Safe('id="sortTracks"') : ''}>
        <div class="track-head" role="row">
            <span>#</span>${head('title', 'Title')}${showAlbum ? head('album', 'Album', 'album-cell') : ''}${head('added', 'Date added', 'date-cell')}
            ${head('duration', icon('clock', 16), 'right')}
        </div>
        ${tracks.map((t, i) => html`
        <div class="track" role="row" data-id="${t.id}" data-ctx="${ctx}" data-index="${i}" ${sortable ? html`data-sort-index="${i}"` : ''}>
            <span class="num"><span class="n">${numbered ? i + 1 : ''}</span>${eq()}<button class="row-play" data-action="play-row" aria-label="Play ${t.title}">${icon('play', 14)}</button></span>
            <div class="title-cell">${trackArt(t)}<span class="mobile-playing-overlay">${eq()}</span><div class="title-text">
                <div class="title-name">${t.title}</div>
                <div class="title-sub"><span>${t.artists.map((a, j) => html`${j ? ', ' : ''}<a href="${artistHref(a)}">${a}</a>`)}</span></div>
            </div></div>
            ${showAlbum ? html`<span class="album-cell">${t.album}</span>` : ''}
            <span class="date-cell">${fmtAdded(t.added)}</span>
            <span class="duration right">${sortable ? html`<button class="row-more drag-handle" aria-label="Move ${t.title}: drag, or use the up and down arrow keys" title="Drag to reorder">${icon('grip', 16)}</button>` : ''}${likeButton(t.id)}<span class="dur">${fmtTime(t.duration)}</span><button class="row-more" data-action="row-menu" aria-label="More options for ${t.title}" aria-haspopup="menu">${icon('more', 16)}</button></span>
        </div>`)}
    </div>`;
}

// The same songs as covers. Each tile is still a .track with data-id/ctx/index, so playing, the
// playing highlight, double-click, right-click and ⋯ all work exactly as in the list.
function trackGrid(tracks, context, ctx) {
    return html`
    <div class="track-grid" role="list" aria-label="${context.label}">
        ${tracks.map((t, i) => html`
        <div class="track tile-track" role="listitem" data-id="${t.id}" data-ctx="${ctx}" data-index="${i}">
            <div class="tt-art">${trackArt(t)}${eq()}<button class="fab" data-action="play-row" aria-label="Play ${t.title}">${icon('play', 20)}</button></div>
            <div class="tt-title" title="${t.title}">${t.title}</div>
            <div class="tt-sub">${t.artists.map((a, j) => html`${j ? ', ' : ''}<a href="${artistHref(a)}">${a}</a>`)}</div>
            <div class="tt-foot"><span class="dur">${fmtTime(t.duration)}</span>${likeButton(t.id)}<button class="row-more" data-action="row-menu" aria-label="More options for ${t.title}" aria-haspopup="menu">${icon('more', 16)}</button></div>
        </div>`)}
    </div>`;
}

const viewToggle = () => html`<div class="view-toggle" role="group" aria-label="View as">${[['list', 'viewList', 'List'], ['grid', 'viewGrid', 'Grid']].map(([key, ic, label]) =>
    html`<button class="icon-btn ${S.trackView === key ? 'on' : ''}" data-action="track-view" data-view="${key}" aria-pressed="${String(S.trackView === key)}" aria-label="View as ${label.toLowerCase()}" title="${label}">${icon(ic, 18)}</button>`)}</div>`;

const likeButton = (id, { big = false } = {}) => html`<button class="like-btn ${big ? 'big' : ''} ${S.liked.has(id) ? 'on' : ''}" data-action="like" data-like-id="${id}" aria-pressed="${String(S.liked.has(id))}" aria-label="${S.liked.has(id) ? 'Remove from Liked Songs' : 'Save to Liked Songs'}">${icon(S.liked.has(id) ? 'heartFilled' : 'heart', big ? 22 : 16)}</button>`;

// Status button for a Spotify track: play if owned, else download
function trackStatus(t) {
    const localId = owned(t);
    if (localId) return html`<button class="status-btn owned" data-action="play-local" data-local-id="${localId}" title="In your library — play" aria-label="Play ${t.name} from your library">${icon('check', 18)}</button>`;
    const job = jobFor(t.url);
    return html`<button class="status-btn download ${job ? 'busy' : ''}" data-download-url="${t.url}" data-action="download" data-type="track" data-title="${t.artists.map((a) => a.name).join(', ')} - ${t.name}" data-image="${t.album.image || ''}" title="Download" aria-label="Download ${t.name}" ${job ? new Safe('disabled') : ''}>${icon(job ? 'loader' : 'download', 18, job ? 'spinning' : '')}</button>`;
}

function spotifyArtistLinks(artists, source) {
    return html`${artists.map((a, j) => html`${j ? ', ' : ''}${a.id ? html`<a href="${remoteHref({ source, id: a.id }, 'artist')}">${a.name}</a>` : a.name}`)}`;
}

// Track table for Spotify tracks (album / playlist / artist top tracks)
function spotifyTable(tracks, { showAlbum = true, showArt = true, context } = {}) {
    const localIds = tracks.map(owned).filter(Boolean);
    const ctx = registerContext(localIds, context);
    return html`
    <div class="tracks ${showAlbum ? '' : 'no-album'}" role="grid">
        <div class="track-head" role="row">
            <span>#</span><span>Title</span>${showAlbum ? html`<span class="album-cell">Album</span>` : ''}<span class="date-cell"></span>
            <span class="right">${icon('clock', 16)}</span>
        </div>
        ${tracks.map((t, i) => {
            const localId = owned(t);
            return html`
        <div class="track" role="row" ${localId ? html`data-id="${localId}" data-ctx="${ctx}" data-index="${localIds.indexOf(localId)}"` : ''}>
            <span class="num"><span class="n">${i + 1}</span>${eq()}${localId ? html`<button class="row-play" data-action="play-row" aria-label="Play ${t.name}">${icon('play', 14)}</button>` : ''}</span>
            <div class="title-cell">${showArt ? imageArt(t.album.image) : ''}<div class="title-text">
                <div class="title-name">${t.name}</div>
                <div class="title-sub">${t.explicit ? html`<span class="explicit" title="Explicit">E</span>` : ''}<span>${spotifyArtistLinks(t.artists, t.source)}</span></div>
            </div></div>
            ${showAlbum ? html`<span class="album-cell">${t.album.id ? html`<a href="${remoteHref({ source: t.source, id: t.album.id }, 'album')}">${t.album.name}</a>` : t.album.name || ''}</span>` : ''}
            <span class="date-cell"></span>
            <span class="duration right">${trackStatus(t)}<span>${fmtTime(t.duration_ms / 1000)}</span></span>
        </div>`;
        })}
    </div>`;
}

function card({ href, art, title, sub, playCtx, download }) {
    return html`
    <a class="card" href="${href}">
        <div class="card-art">${art}
            ${playCtx ? html`<button class="fab" data-action="play-ctx" data-ctx="${playCtx}" aria-label="Play ${title}">${icon('play', 20)}</button>` : ''}
            ${download ? html`<button class="fab secondary" data-action="download" data-download-url="${download.url}" data-type="${download.type}" data-title="${title}" data-image="${download.image || ''}" data-total="${download.total || ''}" aria-label="Download ${title}" title="Download">${icon('downloadPlain', 20)}</button>` : ''}
        </div>
        <div class="card-title">${title}</div>
        <div class="card-sub">${sub}</div>
    </a>`;
}

const collectionCard = (c) => card({
    href: `#/collection/${encodeURIComponent(c.key)}`,
    art: collectionArt(c),
    title: c.name,
    sub: c.kind === 'album' ? `${c.year || ''}${c.year ? ' • ' : ''}${c.artist}` : `${plural(c.track_ids.length, 'song')}`,
    playCtx: registerContext(c.track_ids, { key: `collection:${c.key}`, label: c.name, href: `#/collection/${encodeURIComponent(c.key)}` }),
});
const localArtistCard = (a) => card({
    href: artistHref(a.name), art: artistArt(a), title: a.name, sub: 'Artist',
    playCtx: registerContext(a.trackIds, { key: `artist:${a.name}`, label: a.name, href: artistHref(a.name) }),
});
const albumCard = (a) => card({
    href: remoteHref(a, 'album'), art: imageArt(a.image), title: a.name,
    sub: `${a.year || ''}${a.year ? ' • ' : ''}${a.album_type === 'single' ? 'Single' : a.artists.map((x) => x.name).join(', ')}`,
    download: { url: a.url, type: 'album', image: a.image, total: a.total_tracks },
});
const artistCard = (a) => card({ href: remoteHref(a, 'artist'), art: imageArt(a.image, 'round', 'user'), title: a.name, sub: 'Artist' });
const playlistCard = (p) => card({
    href: remoteHref(p, 'playlist'), art: imageArt(p.image), title: p.name, sub: `By ${p.owner || (p.source === 'ytm' ? 'YouTube Music' : 'Spotify')}`,
    download: { url: p.url, type: 'playlist', image: p.image, total: p.total_tracks },
});

function bigPlay(ctxKey, ids, context) {
    const ctx = registerContext(ids, context);
    return html`<button class="play-big" data-action="play-ctx" data-ctx="${ctx}" data-play-context="${ctxKey}" aria-label="Play">${icon('play', 24)}</button>`;
}
const shuffleToggle = () => html`<button class="toggle-btn ${P.shuffle ? 'on' : ''}" data-action="toggle-shuffle" aria-label="Shuffle" aria-pressed="${String(P.shuffle)}">${icon('shuffle', 28)}</button>`;

const titleSize = (name) => name.length > 30 ? 'small' : name.length > 14 ? 'medium' : '';

const loadingView = () => html`<div class="view-pad">${[1, 2, 3, 4, 5, 6].map(() => html`<div class="skeleton" style="height:56px;margin-bottom:8px"></div>`)}</div>`;
const errorView = (message) => html`<div class="view-pad"><div class="error-box">${message}</div></div>`;

// ---------- genres ----------

// One distinct colour per genre (Spotify's Browse cards are each a different saturated colour).
// Assigned by the genre's rank, not a hash of its name, so no two of the top 16 ever share a colour.
const GENRE_COLORS = ['#e13300', '#1e3264', '#148a08', '#8400e7', '#e8115b', '#0d73ec', '#bc5900', '#27856a',
    '#af2896', '#477d95', '#503750', '#7358ff', '#a56752', '#006450', '#e91429', '#8d67ab'];
const genreColor = (name) => {
    const rank = S.genres.findIndex((g) => g.name === name);
    return GENRE_COLORS[(rank < 0 ? 0 : rank) % GENRE_COLORS.length];
};
const genreHref = (name) => `#/genre/${encodeURIComponent(name)}`;

function genreCard(g) {
    const cover = S.byId.get(g.coverIds[0]);
    return html`<a class="genre-card" href="${genreHref(g.name)}" style="--c:${genreColor(g.name)}">
        <h3>${g.name}</h3><span class="genre-count">${plural(g.trackIds.length, 'song')}</span>
        ${cover && cover.has_cover ? html`<img src="${artUrl(cover.id)}" alt="" loading="lazy">` : ''}</a>`;
}

function genreProgress() {
    if (!S.genrePending) return '';
    return html`<p class="genre-progress">${icon('loader', 14, 'spinning')} Finding genres… ${S.genrePending} songs left</p>`;
}

function viewGenres() {
    return html`<div class="view-pad">
        <h1 class="greeting" style="margin-top:8px">Browse by genre</h1>${genreProgress()}
        ${S.genres.length ? html`<div class="genre-grid">${S.genres.map(genreCard)}</div>`
            : html`<div class="empty"><h2>No genres yet</h2><p>They're looked up in the background and appear here as they're found.</p></div>`}
    </div>`;
}

function viewGenre(name) {
    const g = S.genres.find((x) => x.name === name);
    if (!g) return html`<div class="empty"><h2>No ${name} songs yet</h2><p><a class="pill-btn" href="#/genres">All genres</a></p></div>`;
    const tracks = g.trackIds.map((id) => S.byId.get(id));
    const context = { key: `genre:${name}`, label: name, href: genreHref(name) };
    const total = tracks.reduce((sum, t) => sum + t.duration, 0);
    const color = genreColor(name);
    const art = g.coverIds.length >= 4
        ? html`<div class="art mosaic">${g.coverIds.map((id) => html`<img src="${artUrl(id)}" alt="">`)}</div>`
        : trackArt(S.byId.get(g.coverIds[0]));
    return html`
    <header class="hero" style="--hero:${color}">
        ${art}
        <div class="hero-text">
            <div class="hero-kind">Genre</div>
            <h1 class="hero-title ${titleSize(name)}">${name}</h1>
            <div class="hero-meta"><strong>Your library</strong><span class="dot">${plural(tracks.length, 'song')}, ${fmtLong(total)}</span></div>
        </div>
    </header>
    <div class="below-hero" style="--hero:${color}">
        <div class="action-bar">${bigPlay(context.key, g.trackIds, context)}${shuffleToggle()}${viewToggle()}
            <a class="pill-btn" href="#/genres">All genres</a></div>
        ${localTable(tracks, context)}
    </div>`;
}

// ---------- views ----------

function viewHome() {
    if (!S.tracks.length) {
        return html`<div class="empty">${icon('note', 48)}<h2>Your library is empty</h2>
            <p>Search for a song, album or playlist and download it. It'll show up here.</p>
            <a class="pill-btn primary" href="#/search">Search Spotify</a></div>`;
    }
    const recent = S.tracks.slice(0, 20);
    const recentCtx = registerContext(recent.map((t) => t.id), { key: 'recent', label: 'Recently added', href: '#/songs' });
    const tiles = [
        html`<a class="tile" href="#/songs">${allSongsArt()}<span class="tile-name">All songs</span>
            <button class="fab" data-action="play-ctx" data-ctx="${registerContext(S.tracks.map((t) => t.id), { key: 'songs', label: 'All songs', href: '#/songs' })}" aria-label="Play all songs">${icon('play', 16)}</button></a>`,
        ...S.collections.slice(0, 7).map((c) => html`<a class="tile" href="#/collection/${encodeURIComponent(c.key)}">${collectionArt(c)}<span class="tile-name">${c.name}</span>
            <button class="fab" data-action="play-ctx" data-ctx="${registerContext(c.track_ids, { key: `collection:${c.key}`, label: c.name, href: `#/collection/${encodeURIComponent(c.key)}` })}" aria-label="Play ${c.name}">${icon('play', 16)}</button></a>`),
    ];
    return html`
    
    <div class="greeting-wrap">
        <h1 class="greeting">${greeting()}</h1>
        <div class="tiles">${tiles}</div>
    </div>
    <div class="view-pad">
        <section class="section">
            <div class="section-head"><h2 class="section-title"><a href="#/songs">Recently added</a></h2><a class="section-more" href="#/songs">Show all</a></div>
            <div class="shelf">${recent.slice(0, 10).map((t, i) => html`
                <a class="card" href="${artistHref(t.artists[0])}">
                    <div class="card-art">${trackArt(t)}<button class="fab" data-action="play-ctx" data-ctx="${recentCtx}" data-index="${i}" aria-label="Play ${t.title}">${icon('play', 20)}</button></div>
                    <div class="card-title">${t.title}</div><div class="card-sub">${t.artists.join(', ')}</div>
                </a>`)}</div>
        </section>
        ${S.genres.length || S.genrePending ? html`<section class="section">
            <div class="section-head"><h2 class="section-title"><a href="#/genres">Browse by genre</a></h2>${S.genres.length ? html`<a class="section-more" href="#/genres">Show all</a>` : ''}</div>
            ${genreProgress()}
            <div class="genre-shelf">${S.genres.slice(0, 12).map(genreCard)}</div>
        </section>` : ''}
        <section class="section">
            <div class="section-head"><h2 class="section-title">Your playlists & albums</h2></div>
            <div class="shelf">${S.collections.map(collectionCard)}</div>
        </section>
        <section class="section">
            <div class="section-head"><h2 class="section-title">Artists in your library</h2></div>
            <div class="shelf">${S.artists.slice(0, 12).map(localArtistCard)}</div>
        </section>
    </div>`;
}

function viewSongs() {
    const context = { key: 'songs', label: 'All songs', href: '#/songs' };
    const total = S.tracks.reduce((sum, t) => sum + t.duration, 0);
    return html`
    <header class="hero" style="--hero:#5038a0">
        ${allSongsArt()}
        <div class="hero-text">
            <div class="hero-kind">Playlist</div>
            <h1 class="hero-title">All songs</h1>
            <div class="hero-meta"><strong>Downloaded</strong><span class="dot">${plural(S.tracks.length, 'song')}, ${fmtLong(total)}</span></div>
        </div>
    </header>
    <div class="below-hero" style="--hero:#5038a0">
        ${S.tracks.length ? html`<div id="songsBody">${songsBody()}</div>` : html`<div class="empty"><h2>No songs yet</h2><p>Downloads show up here.</p></div>`}
    </div>`;
}

// ---------- All songs: search, filter by genre, sort ----------
// Only #songsBody is redrawn as you type or pick, so the search box keeps focus.

const SONG_SORTS = [['added', 'Date added', 'desc'], ['title', 'Title', 'asc'], ['artist', 'Artist', 'asc'], ['album', 'Album', 'asc'], ['duration', 'Duration', 'asc']];

function songsFiltered() {
    const v = S.songsView;
    const g = v.genre && S.genres.find((x) => x.name === v.genre);
    const inGenre = g ? new Set(g.trackIds) : null;
    const words = v.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Every word must appear in the title, an artist or the album: "linkin numb" finds Numb by Linkin Park
    const tracks = S.tracks.filter((t) => (!inGenre || inGenre.has(t.id)) &&
        (!words.length || ((hay) => words.every((w) => hay.includes(w)))(`${t.title} ${t.artists.join(' ')} ${t.album}`.toLowerCase())));
    const text = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    const compare = {
        added: (a, b) => a.added - b.added,
        title: (a, b) => text(a.title, b.title),
        artist: (a, b) => text(a.artists[0] || '', b.artists[0] || '') || text(a.album, b.album) || text(a.title, b.title),
        album: (a, b) => text(a.album, b.album) || text(a.title, b.title),
        duration: (a, b) => a.duration - b.duration,
    }[v.sort] || ((a, b) => a.added - b.added);
    const sign = v.dir === 'asc' ? 1 : -1;
    return tracks.sort((a, b) => sign * compare(a, b));
}

function songsBody() {
    const v = S.songsView;
    if (v.genre && !S.genres.some((g) => g.name === v.genre)) v.genre = null; // that genre's songs are gone
    const tracks = songsFiltered();
    const filtered = v.genre || v.q.trim();
    // A filtered list is its own queue; `variant` tells the big Play button it isn't the one playing
    const context = { key: 'songs', label: 'All songs', href: '#/songs', variant: `${v.genre || ''}|${v.q.trim()}|${v.sort}|${v.dir}` };
    const sortLabel = SONG_SORTS.find(([k]) => k === v.sort)?.[1] || 'Date added';
    return html`
    <div class="action-bar songs-action-bar">${bigPlay('songs', tracks.map((t) => t.id), context)}${shuffleToggle()}
        <div class="songs-tools">
            <label class="songs-search">${icon('search', 16)}<span class="sr-only">Search in All songs</span>
                <input id="songsSearch" type="search" placeholder="Search in All songs" autocomplete="off" value="${v.q}"></label>
            <button class="lib-sort" id="songsSort" data-action="songs-sort-menu" aria-haspopup="menu" aria-label="Sort: ${sortLabel}, ${v.dir === 'asc' ? 'ascending' : 'descending'}">
                <span>${sortLabel}</span>${icon(v.dir === 'asc' ? 'up' : 'down', 14)}</button>
            ${viewToggle()}
        </div>
    </div>
    ${S.genres.length ? html`<div class="genre-chips" role="group" aria-label="Filter by genre">${S.genres.map((g) => html`<button class="chip ${v.genre === g.name ? 'active' : ''}" data-action="songs-genre" data-genre="${g.name}" aria-pressed="${String(v.genre === g.name)}">${g.name} <span class="chip-count">${g.trackIds.length}</span></button>`)}</div>` : ''}
    ${filtered ? html`<p class="songs-count" role="status">${tracks.length ? `${plural(tracks.length, 'song')} of ${S.tracks.length}` : ''}${v.genre ? html` · <a href="${genreHref(v.genre)}">${v.genre} page</a>` : ''} · <button class="link-btn" data-action="songs-clear">Clear</button></p>` : ''}
    ${tracks.length ? localTable(tracks, context, { sort: { key: v.sort, dir: v.dir } })
        : html`<div class="empty"><h2>No songs found</h2><p>Nothing in ${v.genre || 'your library'} matches “${v.q.trim()}”.</p></div>`}`;
}

function refreshSongs() {
    const body = $('#songsBody');
    if (!body) return;
    const input = $('#songsSearch');
    const typing = document.activeElement === input;
    const caret = typing ? [input.selectionStart, input.selectionEnd] : null;
    body.innerHTML = songsBody().s;
    if (typing) { const i = $('#songsSearch'); i.focus(); i.setSelectionRange(...caret); }
    markPlaying();
}

function setSongsSort(key, dir) {
    const v = S.songsView;
    v.sort = key;
    v.dir = dir || SONG_SORTS.find(([k]) => k === key)[2];
    store.set('songsSort', v.sort);
    store.set('songsDir', v.dir);
    refreshSongs();
}

function songsSortMenu(anchor) {
    const v = S.songsView;
    showMenu([{ heading: 'Sort by' },
        ...SONG_SORTS.map(([key, label]) => ({ label, checked: v.sort === key, run: () => setSongsSort(key, v.sort === key ? v.dir : null) })),
        '-',
        { label: 'Ascending', checked: v.dir === 'asc', run: () => setSongsSort(v.sort, 'asc') },
        { label: 'Descending', checked: v.dir === 'desc', run: () => setSongsSort(v.sort, 'desc') },
    ], { anchor, label: 'Sort All songs' });
}

function viewCollection(key) {
    const c = S.collections.find((x) => x.key === key);
    if (!c) return html`<div class="empty"><h2>Not found</h2><p>This folder isn't in your library anymore.</p></div>`;
    const tracks = c.track_ids.map((id) => S.byId.get(id)).filter(Boolean);
    const context = { key: `collection:${c.key}`, label: c.name, href: `#/collection/${encodeURIComponent(c.key)}` };
    const meta = c.kind === 'album'
        ? html`<a class="link" href="${artistHref(c.artist)}"><strong>${c.artist}</strong></a>${c.year ? html`<span class="dot">${c.year}</span>` : ''}<span class="dot">${plural(tracks.length, 'song')}, ${fmtLong(c.duration)}</span>`
        : html`<strong>${c.editable ? 'Your playlist' : 'Downloaded'}</strong><span class="dot">${plural(tracks.length, 'song')}, ${fmtLong(c.duration)}</span>`;
    return html`
    <header class="hero">
        ${collectionArt(c)}
        <div class="hero-text">
            <div class="hero-kind">${c.kind === 'album' ? 'Album' : 'Playlist'}</div>
            <h1 class="hero-title ${titleSize(c.name)}">${c.name}</h1>
            <div class="hero-meta">${meta}</div>
        </div>
    </header>
    <div class="below-hero">
        <div class="action-bar">${tracks.length ? html`${bigPlay(context.key, c.track_ids, context)}${shuffleToggle()}${('serviceWorker' in navigator && 'caches' in window) ? html`<button class="toggle-btn" data-action="collection-cache" aria-label="Save ${c.name} offline on this device" title="Save offline on this device">${icon('download', 22)}</button>` : ''}` : ''}${collectionMoreButton(c.name)}${tracks.length ? viewToggle() : ''}</div>
        ${tracks.length ? localTable(tracks, context, { showAlbum: c.kind !== 'album', sortable: c.editable && tracks.length > 1 })
            : html`<div class="empty"><h2>Let's find something for your playlist</h2><p>On any song, click ${icon('more', 14)} and choose <strong>Add to playlist</strong>.</p></div>`}
    </div>`;
}

const collectionMoreButton = (label) => html`<button class="toggle-btn big-more" data-action="collection-menu" aria-label="More options for ${label}" aria-haspopup="menu">${icon('more', 28)}</button>`;

function viewLiked() {
    const context = { key: 'liked', label: 'Liked Songs', href: '#/liked' };
    const tracks = S.likedOrder.map((id) => S.byId.get(id)).filter(Boolean);
    const total = tracks.reduce((sum, t) => sum + t.duration, 0);
    return html`
    <header class="hero" style="--hero:#4f3b9c">
        ${likedArt()}
        <div class="hero-text">
            <div class="hero-kind">Playlist</div>
            <h1 class="hero-title">Liked Songs</h1>
            <div class="hero-meta"><strong>Your likes</strong><span class="dot">${plural(tracks.length, 'song')}${tracks.length ? `, ${fmtLong(total)}` : ''}</span></div>
        </div>
    </header>
    <div class="below-hero" style="--hero:#4f3b9c">
        <div class="action-bar">${tracks.length ? html`${bigPlay('liked', tracks.map((t) => t.id), context)}${shuffleToggle()}${collectionMoreButton('Liked Songs')}${viewToggle()}` : ''}</div>
        ${tracks.length ? localTable(tracks, context, { numbered: true })
            : html`<div class="empty"><h2>Songs you like will appear here</h2><p>Save songs by tapping the ${icon('heart', 14)} next to them.</p></div>`}
    </div>`;
}

function viewLocalArtist(name) {
    const a = S.artists.find((x) => x.name === name);
    if (!a) return html`<div class="empty"><h2>No songs by ${name}</h2><p><a class="pill-btn primary" href="#/search/${encodeURIComponent(name)}">Search Spotify</a></p></div>`;
    const tracks = a.trackIds.map((id) => S.byId.get(id));
    const context = { key: `artist:${name}`, label: name, href: artistHref(name) };
    const total = tracks.reduce((sum, t) => sum + t.duration, 0);
    return html`
    <header class="hero">
        ${artistArt(a)}
        <div class="hero-text">
            <div class="hero-kind">Artist</div>
            <h1 class="hero-title ${titleSize(name)}">${name}</h1>
            <div class="hero-meta">${plural(tracks.length, 'song')} in your library<span class="dot">${fmtLong(total)}</span></div>
        </div>
    </header>
    <div class="below-hero">
        <div class="action-bar">${bigPlay(context.key, a.trackIds, context)}${shuffleToggle()}${viewToggle()}
            <a class="pill-btn artist-more" href="#/search/${encodeURIComponent(name)}" aria-label="More on Spotify" title="More on Spotify">
                <span class="artist-more-label">${icon('search', 14)} More on Spotify</span>
                <span class="artist-more-icon" aria-hidden="true">${icon('spotify', 26)}${icon('plus', 12, 'artist-more-plus')}</span>
            </a></div>
        ${localTable(tracks, context)}
    </div>`;
}

async function cachedSpotify(key, path) {
    const hit = S.spotifyCache.get(key);
    if (hit && Date.now() - hit.time < 5 * 60 * 1000) return hit.data;
    const data = await api(path);
    S.spotifyCache.set(key, { time: Date.now(), data });
    return data;
}

const SEARCH_FILTERS = [['all', 'All'], ['songs', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['playlists', 'Playlists'], ['library', 'In your library']];

function localMatches(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return S.tracks.filter((t) => {
        const hay = `${t.title} ${t.artists.join(' ')} ${t.album}`.toLowerCase();
        return terms.every((term) => hay.includes(term));
    });
}

function parseYouTubeLink(text) {
    text = (text || '').trim();
    let url;
    try { url = new URL(text.includes('://') ? text : `https://${text}`); }
    catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || ![
        'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
        'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
    ].includes(url.hostname)) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    let videoId = null;
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) videoId = parts.length === 1 ? parts[0] : '';
    else if (parts.length === 1 && parts[0] === 'watch') videoId = url.searchParams.get('v') || '';
    else if (parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0])) videoId = parts[1];
    if (videoId !== null) {
        if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) return { source: 'ytm', kind: 'track', id: videoId };
        throw new Error('Invalid YouTube video link. Paste the full video URL.');
    }
    if (parts.length === 2 && parts[0] === 'browse' && /^MPRE[\w-]+$/.test(parts[1])) return { source: 'ytm', kind: 'album', id: parts[1] };
    if (parts.length === 2 && parts[0] === 'channel' && /^UC[\w-]+$/.test(parts[1])) return { source: 'ytm', kind: 'artist', id: parts[1] };
    const listId = url.searchParams.get('list') || '';
    if (parts.length === 1 && parts[0] === 'playlist' && /^[A-Za-z0-9_-]+$/.test(listId)) return { source: 'ytm', kind: 'playlist', id: listId };
    throw new Error('Unsupported YouTube link. Paste a video or playlist URL.');
}

async function viewSearch(q, filter) {
    if (!q) {
        const recent = store.get('recentSearches', []);
        return html`<div class="view-pad">
            ${recent.length ? html`<section class="section"><div class="section-head"><h2 class="section-title">Recent searches</h2></div>
                <div class="recent-searches">${recent.map((r) => html`<a class="chip" href="#/search/${encodeURIComponent(r)}">${r}</a>`)}</div></section>` : ''}
            <section class="section"><div class="section-head"><h2 class="section-title">Search Spotify</h2></div>
                <p style="color:var(--sub)">Find songs, artists, albums and playlists. Anything you don't have yet can be downloaded straight into your library. You can also paste a Spotify or YouTube link.</p></section>
            ${S.collections.length ? html`<section class="section"><div class="section-head"><h2 class="section-title">Your library</h2></div>
                <div class="grid">${S.collections.map(collectionCard)}</div></section>` : ''}
        </div>`;
    }

    // Pasted link: album/playlist/artist open their page; a track gets a download card
    const spotifyLink = q.match(/(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?|spotify:)(track|album|playlist|artist)[/:]([A-Za-z0-9]{22})/);
    let link;
    try { link = spotifyLink ? { source: 'spotify', kind: spotifyLink[1], id: spotifyLink[2] } : parseYouTubeLink(q); }
    catch (err) { return errorView(err.message); }
    if (link && link.source === 'ytm' && link.kind === 'playlist' && link.id.startsWith('OLAK5uy_')) link.kind = 'download-only'; // album audio playlist: just download
    if (link) {
        if (link.kind !== 'track' && link.kind !== 'download-only') { location.replace(remoteHref(link, link.kind)); return html``; }
        const url = link.source === 'spotify' ? `https://open.spotify.com/track/${link.id}` : q.trim();
        const localId = link.kind === 'track' ? (link.source === 'ytm' ? S.byVideoId.get(link.id) : S.bySpotifyId.get(link.id)) : null;
        return html`<div class="view-pad"><div class="link-card">${icon('link', 24)}<div style="flex:1">${link.source === 'ytm' ? 'YouTube' : 'Spotify'} ${link.kind === 'track' ? 'song' : 'album'} link</div>
            ${localId ? html`<button class="pill-btn primary" data-action="play-local" data-local-id="${localId}">${icon('play', 14)} In your library — play</button>`
                      : html`<button class="pill-btn primary" data-action="download" data-download-url="${url}" data-type="${link.kind === 'track' ? 'track' : 'album'}">${icon('downloadPlain', 14)} Download</button>`}</div></div>`;
    }

    const recent = store.get('recentSearches', []).filter((r) => r.toLowerCase() !== q.toLowerCase());
    store.set('recentSearches', [q, ...recent].slice(0, 8));

    const local = localMatches(q);
    let results = null, error = null;
    if (filter !== 'library') {
        try { results = await cachedSpotify(`search/${q.toLowerCase()}`, `/search?q=${encodeURIComponent(q)}`); }
        catch (err) { error = err.message; }
    }
    const chips = html`<div class="filter-chips">${SEARCH_FILTERS.map(([key, label]) =>
        html`<a class="chip ${filter === key ? 'active' : ''}" href="#/search/${encodeURIComponent(q)}${key === 'all' ? '' : '/' + key}">${label}</a>`)}</div>`;
    const localContext = { key: `search:${q}`, label: `"${q}" in your library`, href: `#/search/${encodeURIComponent(q)}/library` };
    const localSection = (limit) => local.length ? html`<section class="section">
        <div class="section-head"><h2 class="section-title">In your library</h2>${limit && local.length > limit ? html`<a class="section-more" href="#/search/${encodeURIComponent(q)}/library">Show all ${local.length}</a>` : ''}</div>
        ${localTable(limit ? local.slice(0, limit) : local, localContext)}</section>` : '';
    const sourceName = results && results.source === 'ytm' ? 'YouTube Music' : S.init.initialized ? 'Spotify' : 'YouTube Music';
    const errorBox = error ? html`<div class="error-box" style="margin-bottom:24px">${sourceName} search failed: ${error}</div>` : '';

    if (filter === 'library') {
        return html`${chips}<div class="view-pad">${local.length ? localSection(0) : html`<div class="empty"><h2>Nothing in your library matches "${q}"</h2></div>`}</div>`;
    }
    if (!results) return html`${chips}<div class="view-pad">${errorBox}${localSection(0)}</div>`;

    const { tracks, artists, albums, playlists } = results;
    const nothing = !tracks.length && !artists.length && !albums.length && !playlists.length;
    if (nothing && !local.length) return html`${chips}<div class="empty"><h2>No results found for "${q}"</h2><p>Check the spelling, or try fewer words.</p></div>`;

    if (filter === 'songs') return html`${chips}<div class="view-pad">${spotifyTable(tracks, { context: { key: `search-songs:${q}`, label: q, href: location.hash } })}</div>`;
    if (filter === 'artists') return html`${chips}<div class="view-pad"><div class="grid">${artists.map(artistCard)}</div></div>`;
    if (filter === 'albums') return html`${chips}<div class="view-pad"><div class="grid">${albums.map(albumCard)}</div></div>`;
    if (filter === 'playlists') return html`${chips}<div class="view-pad"><div class="grid">${playlists.map(playlistCard)}</div></div>`;

    // "All": top result + songs, then the rest
    const qLower = q.toLowerCase();
    const topArtist = artists.find((a) => a.name.toLowerCase() === qLower);
    let top = '';
    if (topArtist || (!tracks.length && artists.length)) {
        const a = topArtist || artists[0];
        top = html`<a class="top-result" href="${remoteHref(a, 'artist')}">${imageArt(a.image, 'round', 'user')}
            <div class="top-result-name">${a.name}</div><div class="top-result-sub"><span class="type-tag">Artist</span></div></a>`;
    } else if (tracks.length) {
        const t = tracks[0];
        const localId = owned(t);
        top = html`<a class="top-result" href="${t.album.id ? remoteHref({ source: t.source, id: t.album.id }, 'album') : '#'}">${imageArt(t.album.image)}
            <div class="top-result-name">${t.name}</div>
            <div class="top-result-sub"><span class="type-tag">Song</span><span>${spotifyArtistLinks(t.artists, t.source)}</span></div>
            ${localId ? html`<button class="fab" data-action="play-local" data-local-id="${localId}" aria-label="Play ${t.name}">${icon('play', 20)}</button>`
                      : html`<button class="fab" data-action="download" data-download-url="${t.url}" data-type="track" data-title="${t.artists.map((a) => a.name).join(', ')} - ${t.name}" data-image="${t.album.image || ''}" aria-label="Download ${t.name}">${icon('downloadPlain', 20)}</button>`}</a>`;
    }
    return html`
    
    ${chips}
    <div class="view-pad">
        ${errorBox}
        ${tracks.length || top ? html`<div class="search-top">
            <section><div class="section-head"><h2 class="section-title">Top result</h2></div>${top}</section>
            <section><div class="section-head"><h2 class="section-title">Songs</h2><a class="section-more" href="#/search/${encodeURIComponent(q)}/songs">Show all</a></div>
                <div class="rows">${spotifyRows(tracks.slice(0, 4), q)}</div></section>
        </div>` : ''}
        ${localSection(5)}
        ${artists.length ? html`<section class="section"><div class="section-head"><h2 class="section-title">Artists</h2><a class="section-more" href="#/search/${encodeURIComponent(q)}/artists">Show all</a></div><div class="shelf">${artists.map(artistCard)}</div></section>` : ''}
        ${albums.length ? html`<section class="section"><div class="section-head"><h2 class="section-title">Albums</h2><a class="section-more" href="#/search/${encodeURIComponent(q)}/albums">Show all</a></div><div class="shelf">${albums.map(albumCard)}</div></section>` : ''}
        ${playlists.length ? html`<section class="section"><div class="section-head"><h2 class="section-title">Playlists</h2><a class="section-more" href="#/search/${encodeURIComponent(q)}/playlists">Show all</a></div><div class="shelf">${playlists.map(playlistCard)}</div></section>` : ''}
    </div>`;
}

// Compact song rows for the search "All" tab
function spotifyRows(tracks, q) {
    const localIds = tracks.map(owned).filter(Boolean);
    const ctx = registerContext(localIds, { key: `search-top:${q}`, label: q, href: location.hash });
    return html`${tracks.map((t) => {
        const localId = owned(t);
        return html`<div class="track" ${localId ? html`data-id="${localId}" data-ctx="${ctx}" data-index="${localIds.indexOf(localId)}"` : ''}>
            <div class="title-cell">${imageArt(t.album.image)}<div class="title-text">
                <div class="title-name">${t.name}</div>
                <div class="title-sub">${t.explicit ? html`<span class="explicit">E</span>` : ''}<span>${spotifyArtistLinks(t.artists, t.source)}</span></div></div></div>
            ${trackStatus(t)}
            <span class="duration right">${fmtTime(t.duration_ms / 1000)}</span>
        </div>`;
    })}`;
}

async function viewRemote(source, kind, id) {
    let data;
    try { data = await cachedSpotify(`${source}/${kind}/${id}`, `/${source}/${kind}/${encodeURIComponent(id)}`); }
    catch (err) { return html`${errorView(err.message)}`; }

    if (kind === 'artist') {
        const top = data.top_tracks || [];
        const ownedCount = top.filter(owned).length;
        return html`
        <header class="hero">
            ${imageArt(data.image, 'round', 'user')}
            <div class="hero-text">
                <div class="hero-kind">Artist</div>
                <h1 class="hero-title ${titleSize(data.name)}">${data.name}</h1>
                <div class="hero-meta">${data.followers !== null && data.followers !== undefined ? `${data.followers.toLocaleString()} followers` : data.subscribers ? `${data.subscribers} subscribers` : ''}
                    ${S.artists.some((a) => a.name === data.name) ? html`<span class="dot"><a class="link" href="${artistHref(data.name)}">In your library</a></span>` : ''}</div>
            </div>
        </header>
        <div class="below-hero">
            ${top.length ? html`<section class="section"><div class="section-head"><h2 class="section-title">Popular</h2>
                ${ownedCount ? html`<span class="section-more">${ownedCount} of ${top.length} in your library</span>` : ''}</div>
                ${spotifyTable(top, { showAlbum: true, context: { key: `${source}-artist:${id}`, label: data.name, href: location.hash } })}</section>` : ''}
            ${data.albums && data.albums.length ? html`<section class="section"><div class="section-head"><h2 class="section-title">Discography</h2></div>
                <div class="grid">${data.albums.map(albumCard)}</div></section>` : ''}
        </div>`;
    }

    const tracks = data.tracks || [];
    const ownedIds = tracks.map(owned).filter(Boolean);
    const allOwned = tracks.length && ownedIds.length === tracks.length;
    const duration = tracks.reduce((sum, t) => sum + t.duration_ms, 0) / 1000;
    const context = { key: `${source}-${kind}:${id}`, label: data.name, href: location.hash };
    const job = jobFor(data.url);
    const downloadLabel = job ? (job.status === 'queued' ? 'Queued' : 'Downloading…')
        : ownedIds.length ? `Download ${tracks.length - ownedIds.length} missing` : `Download ${kind}`;
    const downloadBtn = allOwned
        ? html`<span class="text-btn" style="color:var(--green)">${icon('check', 24)} In your library</span>`
        : html`<button class="pill-btn primary remote-download" aria-label="${downloadLabel} — ${data.name}" title="${downloadLabel}" data-action="download" data-download-url="${data.url}" data-type="${kind}" data-title="${data.name}" data-image="${data.image || ''}" data-total="${data.total_tracks || ''}" ${job ? new Safe('disabled') : ''}>
            ${job ? icon('loader', 18, 'spinning') : icon('downloadPlain', 18)}<span class="remote-download-label">${downloadLabel}</span></button>`;
    const meta = kind === 'album'
        ? html`<strong>${spotifyArtistLinks(data.artists, source)}</strong>${data.year ? html`<span class="dot">${data.year}</span>` : ''}<span class="dot">${plural(data.total_tracks || tracks.length, 'song')}, ${fmtLong(duration)}</span>`
        : html`<strong>${data.owner || 'Spotify'}</strong><span class="dot">${plural(data.total_tracks || tracks.length, 'song')}${tracks.length < (data.total_tracks || 0) ? ` (first ${tracks.length} shown)` : ''}</span>
            ${data.via_embed && tracks.length >= 100 ? html`<span class="dot" title="Without Spotify's API, its public player lists at most 100 songs">first 100 songs only</span>` : ''}`;
    return html`
    
    <header class="hero">
        ${imageArt(data.image)}
        <div class="hero-text">
            <div class="hero-kind">${kind === 'album' ? (data.album_type === 'single' ? 'Single' : 'Album') : 'Playlist'}</div>
            <h1 class="hero-title ${titleSize(data.name)}">${data.name}</h1>
            ${data.description ? html`<p class="hero-desc">${data.description}</p>` : ''}
            <div class="hero-meta">${meta}</div>
        </div>
    </header>
    <div class="below-hero">
        <div class="action-bar">
            ${ownedIds.length ? bigPlay(context.key, ownedIds, context) : ''}
            ${downloadBtn}
            ${ownedIds.length && !allOwned ? html`<span style="color:var(--sub)">${ownedIds.length} of ${tracks.length} in your library</span>` : ''}
        </div>
        ${data.tracks_hidden
            ? html`<div class="empty">${icon('disc', 40)}<h2>Spotify doesn't share this playlist's songs</h2>
                <p>Since February 2026, Spotify only lets apps see the songs in playlists you own. You can still try downloading it.</p></div>`
            // Embed playlists carry no per-song cover or album, so don't show empty columns
            : spotifyTable(tracks, { showAlbum: kind === 'playlist' && !data.via_embed, showArt: kind === 'playlist' && !data.via_embed, context })}
    </div>`;
}

function jobRow(job) {
    const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
    const active = ACTIVE.has(job.status);
    const collection = downloadCollectionForJob(job);
    return html`
    <li class="job ${celebratedJobs.has(job.id) ? 'premium-complete' : ''}" data-job-id="${job.id}">
        ${job.image ? imageArt(job.image) : html`<div class="art">${icon(job.kind === 'track' ? 'note' : 'disc', 24)}</div>`}
        <div class="job-body">
            <div class="job-title">${job.title}</div>
            <div class="job-meta"><span class="state ${job.status}">${job.status}</span>
                <span>${job.kind[0].toUpperCase() + job.kind.slice(1)}</span>
                ${job.total ? html`<span>${job.done} / ${job.total}</span>` : ''}
                <span>${job.message}</span></div>
            ${active ? html`<div class="job-bar ${job.status === 'queued' || !job.total ? 'indeterminate' : ''}"><i style="--progress:${pct / 100}"></i></div>` : ''}
            ${job.note ? html`<div class="job-meta">${job.note}</div>` : ''}
            ${job.error ? html`<div class="job-error">${job.error}</div>` : ''}
        </div>
        <div class="job-actions">${active ? html`<button class="pill-btn job-cancel" data-action="cancel-job" data-job-id="${job.id}" aria-label="Cancel download" title="Cancel download">${icon('close', 18)}<span>Cancel</span></button>`
            : (job.status === 'failed' || (job.error && job.status === 'completed'))
                ? html`<button class="pill-btn" data-action="download" data-download-url="${job.query}" data-type="${job.kind}" data-title="${job.title}" data-image="${job.image || ''}" title="Songs you already have are skipped">Retry</button>`
                : collection ? html`<button class="play-big job-play" data-action="play-download" data-collection-key="${collection.key}" aria-label="Play ${collection.name}" title="Play ${collection.name}">${icon('play', 20)}</button>` : ''}</div>
        ${job.log && job.log.length && job.status !== 'queued' ? html`<details class="job-details"><summary>${job.source === 'spotify' ? 'spotDL output' : 'Details'}</summary><pre>${job.log.join('\n')}</pre></details>` : ''}
    </li>`;
}

function downloadCollectionForJob(job, collections = S.collections) {
    if (job.status !== 'completed' || !['album', 'playlist'].includes(job.kind)) return null;
    const title = String(job.title || '').trim().toLocaleLowerCase();
    const matches = collections.filter((c) => c.track_ids?.length && c.name.trim().toLocaleLowerCase() === title);
    return matches.find((c) => c.kind === job.kind) || matches[0] || null;
}

function renderJobsList() {
    const list = $('#jobsList');
    if (!list) return;
    const open = new Set($$('details[open]', list).map((d) => d.closest('.job') && [...list.children].indexOf(d.closest('.job'))));
    list.innerHTML = S.jobs.length ? html`${S.jobs.map(jobRow)}`.s : html`<li class="empty" style="padding:32px">No downloads yet. Search for something, or paste a link above.</li>`.s;
    [...list.children].forEach((li, i) => { if (open.has(i)) { const d = $('details', li); if (d) d.open = true; } });
    celebratedJobs.forEach((id) => {
        const row = [...list.children].find((item) => item.dataset.jobId === String(id));
        if (!row) return;
        setTimeout(() => { row.classList.remove('premium-complete'); celebratedJobs.delete(id); }, 900);
    });
}

function viewDownloads() {
    const s = S.settings;
    const label = { m4a: 'M4A', mp3: 'MP3', opus: 'Opus', flac: 'FLAC', wav: 'WAV' }[s.format];
    const quality = s.format === 'flac' || s.format === 'wav' ? '' : s.bitrate === 'auto' ? ', source quality' : `, ${s.bitrate} kbps`;
    return html`
    
    <div class="view-pad">
        <h1 class="greeting" style="margin-top:8px">Downloads</h1>
        <form class="paste-row" id="pasteForm">
            <input class="text-input" id="pasteInput" placeholder="Paste a Spotify or YouTube link" autocomplete="off" aria-label="Spotify or YouTube link">
            <button class="pill-btn primary paste-submit" type="submit" aria-label="Download" title="Download">${icon('downloadPlain', 16)}<span>Download</span></button>
        </form>
        <p class="settings-line"><span>Saving as ${label}${quality}${s.lyrics ? ', with lyrics' : ''}.</span><span class="download-quick-actions">
            <button type="button" data-action="settings" aria-label="Change download settings" title="Change download settings">${icon('settings', 16)}<span>Change</span></button>
            ${S.init.on_phone ? '' : html`<button type="button" data-action="open-music-folder" aria-label="Open music folder" title="Open music folder">${icon('folder', 16)}<span>Open music folder</span></button>`}
        </span></p>
        <ul class="jobs" id="jobsList"></ul>
    </div>`;
}

// ---------- stats page ----------

// Time ranges for Listening. Chips for the common ones; the rest are under "More"
const STATS_RANGES = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['last-month', 'Last month'], ['year', 'This year'], ['all', 'All time']];
const STATS_MORE = [['yesterday', 'Yesterday'], ['last-week', 'Last week'], ['last-year', 'Last year'], '-',
    ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['365d', 'Last 12 months']];
const statsRangeLabel = (key) => [...STATS_RANGES, ...STATS_MORE].find((r) => r[0] === key)?.[1] || 'This month';
function statsRange() {
    const saved = store.get('statsRange', null);
    if (saved) return saved;
    const days = store.get('statsDays', null); // before Oct 2026 the range was a number of days
    return days === null ? 'month' : days ? `${days}d` : 'all';
}
// "Mon, Oct 19" · "Oct 12 – 18" · "Sep 1 – 30, 2026" · "Jan – Dec 2025": the dates a range covers
function periodText(lis) {
    const a = new Date(lis.start * 1000), b = new Date(Math.min(lis.end * 1000, Date.now()) - 1);
    const day = (d, o = {}) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...o });
    if (lis.bucket === 'hour') return a.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const year = b.getFullYear() !== new Date().getFullYear() || a.getFullYear() !== b.getFullYear();
    if (lis.bucket === 'month' && lis.range !== '365d' && lis.range !== 'all') return `${MONTHS[a.getMonth()]} – ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
    if (a.toDateString() === b.toDateString()) return day(a, { year: year ? 'numeric' : undefined });
    const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
    return `${day(a, { year: a.getFullYear() !== b.getFullYear() ? 'numeric' : undefined })} – ${sameMonth ? b.getDate() : day(b)}${year ? `, ${b.getFullYear()}` : ''}`;
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtListen = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? `${h.toLocaleString()} hr ${m} min` : `${m} min`;
};
const fmtCompact = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : Math.round(n).toLocaleString();
const fmtBytes = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`;
const fmtMinutes = (sec) => sec >= 3600 ? `${(sec / 3600).toFixed(1).replace(/\.0$/, '')} hr` : `${Math.round(sec / 60)} min`;
// "Dec '25", not "Dec 25" (which reads as the 25th of December)
const monthAxis = (key, i) => { const [y, m] = key.split('-').map(Number); return m === 1 || i === 0 ? `${MONTHS[m - 1]} '${String(y).slice(2)}` : MONTHS[m - 1]; };
const monthLong = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const dayAxis = (key) => { const d = new Date(`${key}T12:00`); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const dayLong = (key) => new Date(`${key}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const hourName = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
const hourAxis = (key) => hourName(+key.slice(11, 13));

// Axis top: the next "clean" number (1, 2, 4, 5, 10 × 10^n) at or above the max
function niceMax(value) {
    if (value <= 0) return 1;
    const exp = 10 ** Math.floor(Math.log10(value));
    return [1, 2, 4, 5, 10].map((m) => m * exp).find((v) => v >= value);
}

// Time axes must be clean in the unit shown (whole hours, or minutes), not in seconds: 5040 s = "1.4 hr"
const niceTime = (seconds) => {
    if (seconds > 3600) return niceMax(seconds / 3600) * 3600;
    let minutes = niceMax(Math.max(seconds, 60) / 60);
    if (minutes % 2) minutes = niceMax(minutes + 0.001);  // a 5-min top would put the middle tick at 2.5 min
    return minutes * 60;
};

function chartCard({ title, sub, body, table, wide = false }) {
    return html`<section class="chart-card ${wide ? 'wide' : ''}">
        <header class="chart-head">
            <div><h3>${title}</h3>${sub ? html`<p>${sub}</p>` : ''}</div>
            <button class="chip small" data-action="toggle-table" aria-pressed="false">Table</button>
        </header>
        <div class="chart-body">${body}</div>
        <div class="chart-table">${table}</div>
    </section>`;
}

function dataTable(headers, rows) {
    return html`<table><thead><tr>${headers.map((h, i) => html`<th class="${i ? 'num' : ''}">${h}</th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr>${r.map((c, i) => html`<td class="${i ? 'num' : ''}">${c}</td>`)}</tr>`)}</tbody></table>`;
}

// Columns: one series, values from a single baseline, ≤24px wide, 4px rounded tops. Only the peak gets a label.
function columnChart(data, { fmt, axisLabel, tipLabel }) {
    const values = data.map((d) => d.value);
    const peak = Math.max(0, ...values);
    const top = fmt === fmtMinutes ? niceTime(peak) : niceMax(peak);
    const integer = values.every(Number.isInteger) && fmt === fmtCompact;
    const ticks = [0, top / 2, top].filter((t) => !integer || Number.isInteger(t));
    const every = Math.ceil(data.length / 8);
    const peakIndex = values.indexOf(peak);
    return html`<div class="cols-chart" style="--n:${data.length}">
        <div class="y-axis">${ticks.map((t) => html`<span style="bottom:${(t / top) * 100}%">${fmt(t)}</span>`)}</div>
        <div class="plot">
            ${ticks.map((t) => html`<i class="gridline" style="bottom:${(t / top) * 100}%"></i>`)}
            ${data.map((d, i) => html`<div class="col" tabindex="0" role="img" aria-label="${tipLabel(d.key)}: ${fmt(d.value)}"
                    data-tip-label="${tipLabel(d.key)}" data-tip-value="${fmt(d.value)}">
                <span class="col-bar" style="height:${d.value > 0 ? `max(2px, ${(d.value / top) * 100}%)` : '0'}">${i === peakIndex && peak > 0 ? html`<em class="col-value">${fmt(d.value)}</em>` : ''}</span>
            </div>`)}
        </div>
        <div class="x-axis">${data.map((d, i) => {
            // Every nth label plus the last one, skipping a regular label that would sit on top of the last
            const last = data.length - 1;
            const show = i === last || (i % every === 0 && last - i >= every);
            return html`<span>${show ? axisLabel(d.key, i) : ''}</span>`;
        })}</div>
    </div>`;
}

// Horizontal bars: label · bar · value at the tip
function barList(items, { fmt, labelOf = (d) => d.key, hrefOf }) {
    const top = Math.max(1, ...items.map((d) => d.value));
    return html`<ol class="hbars">${items.map((d) => {
        const href = hrefOf && hrefOf(d);  // "Other" has nowhere to go: plain text, not a link to this page
        return html`
        <li class="hbar-row" tabindex="0" data-tip-label="${labelOf(d)}" data-tip-value="${fmt(d.value)}">
            <span class="hbar-label">${href ? html`<a href="${href}">${labelOf(d)}</a>` : labelOf(d)}</span>
            <span class="hbar-track"><span class="hbar" style="width:${(d.value / top) * 100}%"></span></span>
            <span class="hbar-value">${fmt(d.value)}</span>
        </li>`;
    })}</ol>`;
}

// Weekday × hour grid, 5 validated steps of one green (dark → bright); empty cells are a neutral tile
function heatmap(rows) {
    const peak = Math.max(0, ...rows.flat());
    const level = (v) => (v <= 0 || !peak ? 0 : Math.min(5, Math.ceil((v / peak) * 5)));
    return html`<div class="heat">
        <div class="heat-grid">
            ${rows.map((row, day) => html`<span class="heat-day">${WEEKDAYS[day]}</span>${row.map((v, hour) => html`<span class="heat-cell l${level(v)}" tabindex="0"
                    role="img" aria-label="${WEEKDAYS[day]} ${hourName(hour)}: ${fmtMinutes(v)}" data-tip-label="${WEEKDAYS[day]}, ${hourName(hour)}" data-tip-value="${fmtMinutes(v)}"></span>`)}`)}
            <span></span>${Array.from({ length: 24 }, (_, h) => html`<span class="heat-hour">${h % 6 === 0 ? hourName(h) : ''}</span>`)}
        </div>
        <div class="heat-legend" aria-hidden="true">Less ${[0, 1, 2, 3, 4, 5].map((l) => html`<span class="heat-cell l${l}"></span>`)} More</div>
    </div>`;
}

function statTile(label, value, delta) {
    return html`<div class="stat-tile"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${delta || ''}</div>`;
}

function deltaText(current, previous, compare) {
    if (previous === null || previous === undefined) return '';
    if (!previous) return current ? html`<div class="stat-delta" title="Nothing played ${compare}">New this period</div>` : '';
    const pct = Math.round(((current - previous) / previous) * 100);
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
    return html`<div class="stat-delta">${arrow} ${Math.abs(pct)}% vs ${compare}</div>`;
}

let statsCache = null;

function setStatsRange(key) {
    store.set('statsRange', key);
    $('#view').classList.add('refreshing');  // keep the old charts, dimmed, while the new range loads
    rerender().then(() => $('#view').classList.remove('refreshing'));
}

function statsMoreMenu(anchor) {
    const range = statsRange();
    showMenu([{ heading: 'Time range' }, ...STATS_MORE.map((r) => r === '-' ? '-'
        : { label: r[1], checked: r[0] === range, run: () => setStatsRange(r[0]) })], { anchor, label: 'More time ranges' });
}
async function viewStats() {
    const range = statsRange();
    let data;
    try { data = await api(`/stats?range=${encodeURIComponent(range)}`); statsCache = data; }
    catch (err) { if (!statsCache) return errorView(err.message); data = statsCache; }
    const lib = data.library;
    const lis = data.listening;

    // Library: genres as top 10 + Other (bars, not a donut: there are more than 7 classes)
    const knownGenres = lib.genres.filter((g) => g.key !== 'Unknown');
    const genreBars = knownGenres.slice(0, 10);
    const otherGenres = knownGenres.slice(10).reduce((sum, g) => sum + g.value, 0);
    if (otherGenres) genreBars.push({ key: 'Other', value: otherGenres });

    const librarySection = html`
    <section class="stats-section">
        <div class="section-head"><h2 class="section-title">Your library</h2><a class="pill-btn small" href="#/tidy">Tidy up</a></div>
        <div class="stat-row">
            ${statTile('Songs', lib.songs.toLocaleString())}
            ${statTile('Artists', lib.artists.toLocaleString())}
            ${statTile('Albums', lib.albums.toLocaleString())}
            ${statTile('Music', fmtListen(lib.seconds))}
            ${statTile('On disk', fmtBytes(lib.bytes))}
        </div>
        <div class="chart-grid">
            ${chartCard({ title: 'Songs added', sub: 'Per month', wide: true,
                body: columnChart(lib.added_by_month, { fmt: fmtCompact, axisLabel: monthAxis, tipLabel: monthLong }),
                table: dataTable(['Month', 'Songs'], lib.added_by_month.map((d) => [monthLong(d.key), d.value])) })}
            ${chartCard({ title: 'Genres', sub: `${lib.genres_known.toLocaleString()} of ${lib.songs.toLocaleString()} songs have a genre`,
                body: barList(genreBars, { fmt: fmtCompact, hrefOf: (d) => d.key === 'Other' ? null : genreHref(d.key) }),
                table: dataTable(['Genre', 'Songs'], knownGenres.map((g) => [g.key, g.value])) })}
            ${chartCard({ title: 'Top artists', sub: 'By number of songs',
                body: barList(lib.top_artists, { fmt: fmtCompact, hrefOf: (d) => artistHref(d.key) }),
                table: dataTable(['Artist', 'Songs'], lib.top_artists.map((a) => [a.key, a.value])) })}
            ${lib.decades.length ? chartCard({ title: 'Release decades', sub: `${lib.years_known.toLocaleString()} of ${lib.songs.toLocaleString()} songs have a release year`, wide: true,
                body: columnChart(lib.decades, { fmt: fmtCompact, axisLabel: (k) => k, tipLabel: (k) => k }),
                table: dataTable(['Decade', 'Songs'], lib.decades.map((d) => [d.key, d.value])) }) : ''}
        </div>
    </section>`;

    const bucketAxis = { hour: hourAxis, day: dayAxis, month: monthAxis }[lis.bucket];
    const bucketLong = { hour: (k) => `${dayLong(k.slice(0, 10))}, ${hourAxis(k)}`, day: dayLong, month: monthLong }[lis.bucket];
    const bucketName = { hour: 'Hour', day: 'Day', month: 'Month' }[lis.bucket];
    const listeningBody = !lis.plays
        ? html`<div class="empty stats-empty">${icon('chart', 40)}<h2>No listening ${range === 'all' ? 'yet' : 'in this period'}</h2>
            <p>Songs count once they've played for 30 seconds. Play some music and your stats appear here.</p></div>`
        : html`
        <div class="stat-row">
            <div class="stat-tile hero-tile"><div class="stat-label">Listening time</div><div class="hero-value">${fmtListen(lis.seconds)}</div>${deltaText(lis.seconds, lis.previous_seconds, lis.compare)}</div>
            ${statTile('Plays', lis.plays.toLocaleString(), deltaText(lis.plays, lis.previous_plays, lis.compare))}
            ${statTile('Different songs', lis.songs.toLocaleString())}
            ${statTile('Artists', lis.artists.toLocaleString())}
        </div>
        <div class="chart-grid">
            ${chartCard({ title: 'Listening time', sub: `Per ${bucketName.toLowerCase()}`, wide: true,
                body: columnChart(lis.per_bucket, { fmt: fmtMinutes, axisLabel: bucketAxis, tipLabel: bucketLong }),
                table: dataTable([bucketName, 'Listening'], lis.per_bucket.map((d) => [bucketLong(d.key), fmtMinutes(d.value)])) })}
            ${chartCard({ title: 'Top songs', sub: 'Most played',
                body: html`<ol class="top-songs">${lis.top_songs.map((t, i) => {
                    const local = t.in_library ? S.byId.get(t.id) : null;
                    return html`<li class="top-song" ${local ? html`data-action="play-local" data-local-id="${t.id}" tabindex="0"` : ''}>
                        <span class="rank">${i + 1}</span>${trackArt(local)}
                        <span class="top-song-text"><span class="title-name">${t.title}</span><span class="title-sub">${t.artists.join(', ')}</span></span>
                        <span class="top-song-plays">${plural(t.plays, 'play')}</span></li>`;
                })}</ol>`,
                table: dataTable(['Song', 'Artist', 'Plays', 'Listening'], lis.top_songs.map((t) => [t.title, t.artists.join(', '), t.plays, fmtMinutes(t.seconds)])) })}
            ${chartCard({ title: 'Top artists', sub: 'By listening time',
                body: barList(lis.top_artists, { fmt: fmtMinutes, hrefOf: (d) => artistHref(d.key) }),
                table: dataTable(['Artist', 'Listening'], lis.top_artists.map((a) => [a.key, fmtMinutes(a.value)])) })}
            ${chartCard({ title: 'When you listen', sub: 'By weekday and hour', wide: true,
                body: heatmap(lis.heatmap),
                table: dataTable(['Day', ...Array.from({ length: 24 }, (_, h) => hourName(h))], lis.heatmap.map((row, d) => [WEEKDAYS[d], ...row.map((v) => (v ? fmtMinutes(v) : '–'))])) })}
            ${chartCard({ title: 'Genres you play', sub: 'By listening time', wide: true,
                body: barList(lis.genres.slice(0, 10), { fmt: fmtMinutes }),
                table: dataTable(['Genre', 'Listening'], lis.genres.map((g) => [g.key, fmtMinutes(g.value)])) })}
        </div>`;

    return html`<div class="view-pad stats-page">
        <h1 class="greeting" style="margin-top:8px">Your stats</h1>
        ${librarySection}
        <section class="stats-section">
            <h2 class="section-title">Listening</h2>
            <div class="filter-row" role="group" aria-label="Time range">${STATS_RANGES.map(([key, label]) =>
                html`<button class="chip ${key === range ? 'active' : ''}" data-stats-range="${key}" aria-pressed="${String(key === range)}">${label}</button>`)}${(() => {
                    const inMore = STATS_MORE.some((r) => r[0] === range); // a "More" range shows its name on the chip
                    return html`<button class="chip ${inMore ? 'active' : ''}" data-action="stats-more" aria-haspopup="menu" aria-pressed="${String(inMore)}">${inMore ? statsRangeLabel(range) : 'More'} ${icon('down', 14)}</button>`;
                })()}</div>
            <p class="stats-period">${periodText(lis)}</p>
            <div class="stats-listening">${listeningBody}</div>
        </section>
    </div>`;
}

// ---------- Tidy up: duplicate songs and album info ----------
// Duplicates come from /api/duplicates (grouped and ranked on the server, see cleanup.py); you pick the
// copy to keep in each group. Album info: songs whose album is a playlist's name get looked up on
// YouTube Music in the background; you tick the fixes to write, and the last batch can be undone.

const TD = { tab: 'duplicates', pick: {}, fixOff: new Set(), polling: null };
// A "432 Hz" or "sped up" copy can be the same length but sound different: never merged without a look
const RETUNED = /432|528\s*hz|sped\s*up|slowed|nightcore|8d audio|reverb/i;
const isRetuned = (g) => g.copies.some((c) => RETUNED.test(`${c.path} ${c.album} ${c.playlists.join(' ')}`));

async function viewTidy() {
    let dupes, fix;
    try { [dupes, fix] = await Promise.all([api('/duplicates'), api('/album-fix')]); }
    catch (err) { return errorView(err.message); }
    TD.groups = dupes.groups;
    TD.fixJob = fix.job;
    TD.canUndo = fix.can_undo;
    if (fix.job?.status === 'working') pollAlbumFix();
    const tabs = [['duplicates', `Duplicates${dupes.groups.length ? ` ${dupes.groups.length}` : ''}`], ['albums', 'Album info']];
    return html`<div class="view-pad tidy-page">
        <h1 class="greeting" style="margin-top:8px">Tidy up your library</h1>
        <div class="filter-row" role="tablist" aria-label="Tidy up">${tabs.map(([key, label]) =>
            html`<button class="chip ${TD.tab === key ? 'active' : ''}" role="tab" aria-selected="${String(TD.tab === key)}" data-action="tidy-tab" data-tab="${key}">${label}</button>`)}</div>
        ${TD.tab === 'duplicates' ? duplicatesBody(dupes) : albumFixBody()}
    </div>`;
}

function duplicatesBody(dupes) {
    const groups = dupes.groups;
    if (!groups.length) return html`<div class="empty stats-empty">${icon('checkPlain', 40)}<h2>No duplicate songs</h2><p>Every song in your library is there once.</p></div>`;
    const safe = groups.filter((g) => !isRetuned(g));
    return html`
    <p class="tidy-intro"><strong>${plural(groups.length, 'song')}</strong> ${groups.length === 1 ? 'has' : 'have'} more than one copy. Removing the extras frees <strong>${fmtBytes(dupes.extra_bytes)}</strong>.
        Playlists keep the song (they switch to the copy you keep), likes and play counts move over, and removed files go to the ${navigator.platform.startsWith('Win') ? 'Recycle Bin' : 'Trash'}.</p>
    ${safe.length ? html`<div class="tidy-actions"><button class="pill-btn primary" data-action="tidy-merge-all">Keep the suggested copy of ${plural(safe.length, 'song')}</button>
        ${safe.length < groups.length ? html`<span class="tidy-note">${plural(groups.length - safe.length, 'song')} with a 432 Hz or sped-up copy ${groups.length - safe.length === 1 ? 'is' : 'are'} left for you to check.</span>` : ''}</div>` : ''}
    <div class="dupe-list">${groups.map((g) => {
        const keep = TD.pick[g.key] || g.copies[0].id;
        return html`<section class="dupe-group" data-group="${g.key}">
            <h3 class="dupe-title">${g.title} <span>· ${g.artist}</span></h3>
            ${isRetuned(g) ? html`<p class="dupe-warn">${icon('warn', 14)} One copy may be a retuned version (432 Hz, sped up…). It can have the same length but sound different, so listen before removing it.</p>` : ''}
            <div class="dupe-copies" role="radiogroup" aria-label="Copy of ${g.title} to keep">${g.copies.map((c) => html`
                <label class="dupe-copy ${c.id === keep ? 'keep' : ''}">
                    <input type="radio" name="keep-${g.key}" value="${c.id}" data-tidy-keep="${g.key}" ${c.id === keep ? new Safe('checked') : ''}>
                    <button type="button" class="icon-btn" data-action="play-local" data-local-id="${c.id}" aria-label="Play this copy">${icon('play', 14)}</button>
                    <span class="dupe-info">
                        <span class="dupe-where">${c.folder ? html`${c.folder} / ` : ''}<b>${c.path.split('/').pop()}</b></span>
                        <span class="dupe-meta">${c.format}${c.lossless ? ' · lossless' : c.bitrate ? ` · ${c.bitrate} kbps` : ''} · ${fmtBytes(c.size)} · ${fmtTime(c.duration)} · album “${c.album}”${c.has_cover ? '' : ' · no cover'}${c.liked ? ' · ♥' : ''}${c.playlists.length ? ` · in ${c.playlists.join(', ')}` : ''}</span>
                        ${c.best ? html`<span class="dupe-best">Suggested${c.reasons.length ? `: ${c.reasons.join(', ')}` : ''}</span>` : ''}
                    </span>
                    <span class="dupe-tag">${c.id === keep ? 'Keep' : 'Remove'}</span>
                </label>`)}</div>
            <button class="pill-btn" data-action="tidy-merge" data-group="${g.key}">Keep this one, remove ${plural(g.copies.length - 1, 'other')}</button>
        </section>`;
    })}</div>`;
}

async function mergeGroup(g, keep) {
    return api('/duplicates/merge', { method: 'POST', body: JSON.stringify({ keep, remove: g.copies.map((c) => c.id).filter((id) => id !== keep) }) });
}

async function tidyMerge(key) {
    const g = TD.groups.find((x) => x.key === key);
    if (!g) return;
    try {
        const r = await mergeGroup(g, TD.pick[key] || g.copies[0].id);
        toast(`Removed ${plural(r.removed, 'copy', 'copies')} of ${g.title} (${fmtBytes(r.freed)}). ${r.trash.startsWith('the ') ? `They're in ${r.trash}.` : `Moved to ${r.trash}.`}`);
        delete TD.pick[key];
        await refreshLibrary();
    } catch (err) { toast(err.message, 'error'); }
}

function tidyMergeAll() {
    const groups = TD.groups.filter((g) => !isRetuned(g));
    const extra = groups.reduce((n, g) => n + g.copies.length - 1, 0);
    openModal({
        title: `Remove ${plural(extra, 'extra copy', 'extra copies')}?`,
        body: html`<p class="dialog-note">For ${plural(groups.length, 'song')}, spotDLr keeps the copy you picked (or the suggested one) and moves the others to the ${navigator.platform.startsWith('Win') ? 'Recycle Bin' : 'Trash'}. Playlists, likes and play counts switch to the kept copy.</p>
            <div class="progress-bar" hidden><i></i></div>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close autofocus>Cancel</button><button type="button" class="pill-btn danger" id="confirmMerge">Remove ${plural(extra, 'copy', 'copies')}</button></div>`,
        onOpen: (modal, close) => {
            $('#confirmMerge', modal).addEventListener('click', async (e) => {
                e.currentTarget.disabled = true;
                const bar = $('.progress-bar', modal);
                bar.hidden = false;
                let removed = 0, freed = 0;
                const failed = [];
                for (const [i, g] of groups.entries()) {
                    try { const r = await mergeGroup(g, TD.pick[g.key] || g.copies[0].id); removed += r.removed; freed += r.freed; }
                    catch (err) { failed.push(`${g.title}: ${err.message}`); }
                    setProgress($('i', bar), (i + 1) / groups.length);
                }
                close();
                toast(`Removed ${plural(removed, 'copy', 'copies')} and freed ${fmtBytes(freed)}${failed.length ? `. ${plural(failed.length, 'song')} couldn't be merged: ${failed[0]}` : ''}`, failed.length ? 'error' : undefined);
                TD.pick = {};
                await refreshLibrary();
            });
        },
    });
}

function albumFixBody() {
    const job = TD.fixJob;
    const undo = TD.canUndo ? html`<button class="pill-btn" data-action="tidy-undo">Undo the last change</button>` : '';
    if (!job || job.status === 'failed') {
        return html`
        <p class="tidy-intro">Some songs have a <strong>playlist's name as their album</strong> (for example “Green Day Radio”), which happens when a song was saved by another app. spotDLr can look each one up on YouTube Music and suggest the real album, its artist, year and cover. You see every change before anything is written, and you can undo it.</p>
        ${job?.status === 'failed' ? html`<p class="dupe-warn">${icon('warn', 14)} The last lookup failed: ${job.error}</p>` : ''}
        <div class="tidy-actions"><button class="pill-btn primary" data-action="tidy-scan">Find songs to fix</button>${undo}</div>`;
    }
    if (job.status === 'working') {
        return html`<p class="tidy-intro" role="status">Looking up ${plural(job.total, 'song')} on YouTube Music… ${job.done} of ${job.total}</p>
            <div class="progress-bar"><i style="--p:${job.total ? job.done / job.total : 0}"></i></div>`;
    }
    const found = job.results.filter((r) => r.proposed && r.proposed.album !== r.current.album);
    const missed = job.results.filter((r) => !r.proposed);
    if (!job.results.length) return html`<div class="empty stats-empty">${icon('checkPlain', 40)}<h2>Album info looks right</h2><p>No song has a playlist's name as its album.</p></div><div class="tidy-actions">${undo}</div>`;
    const on = found.filter((r) => !TD.fixOff.has(r.id));
    return html`
    <p class="tidy-intro">Found the real album for <strong>${found.length} of ${plural(job.results.length, 'song')}</strong>. Untick any that look wrong, then apply. The album name, album artist, year and cover are written into the files; titles and artists stay as they are.</p>
    <div class="tidy-actions"><button class="pill-btn primary" data-action="tidy-apply" ${on.length ? '' : new Safe('disabled')}>Fix ${plural(on.length, 'song')}</button>
        <button class="pill-btn" data-action="tidy-scan">Look up again</button>${undo}</div>
    <ul class="fix-list">${found.map((r) => html`
        <li><label class="fix-row">
            <input type="checkbox" data-tidy-fix="${r.id}" ${TD.fixOff.has(r.id) ? '' : new Safe('checked')}>
            ${r.proposed.cover_url ? html`<img class="fix-cover" src="${proxied(r.proposed.cover_url.replace(/=w\d+-h\d+/, '=w120-h120'))}" alt="" loading="lazy">` : html`<span class="fix-cover"></span>`}
            <span class="fix-text"><span class="title-name">${r.title}</span><span class="title-sub">${r.artists.join(', ')}</span></span>
            <span class="fix-change"><s>${r.current.album}</s> → <b>${r.proposed.album}</b><small>${[r.proposed.album_artist, r.proposed.year].filter(Boolean).join(' · ')}</small></span>
        </label></li>`)}</ul>
    ${missed.length ? html`<details class="fix-missed"><summary>${plural(missed.length, 'song')} not found</summary><ul>${missed.map((r) => html`<li>${r.title} · ${r.artists.join(', ')}</li>`)}</ul></details>` : ''}`;
}

function pollAlbumFix() {
    if (TD.polling) return;
    TD.polling = setInterval(async () => {
        try {
            const { job } = await api('/album-fix');
            if (route().name !== 'tidy') { clearInterval(TD.polling); TD.polling = null; return; }
            TD.fixJob = job;
            if (job?.status !== 'working') { clearInterval(TD.polling); TD.polling = null; TD.fixOff.clear(); rerender(); return; }
            const bar = $('.tidy-page .progress-bar i'), text = $('.tidy-page .tidy-intro');
            if (bar) setProgress(bar, job.done / job.total);
            if (text) text.textContent = `Looking up ${plural(job.total, 'song')} on YouTube Music… ${job.done} of ${job.total}`;
        } catch { /* try again next tick */ }
    }, 1000);
}

async function tidyScan() {
    try { TD.fixJob = await api('/album-fix/scan', { method: 'POST' }); TD.fixOff.clear(); await rerender(); pollAlbumFix(); }
    catch (err) { toast(err.message, 'error'); }
}

async function tidyApply(button) {
    const items = TD.fixJob.results.filter((r) => r.proposed && r.proposed.album !== r.current.album && !TD.fixOff.has(r.id))
        .map((r) => ({ id: r.id, album: r.proposed.album, album_artist: r.proposed.album_artist, artist: r.artists[0], year: r.proposed.year, cover_url: r.proposed.cover_url }));
    button.disabled = true;
    button.textContent = 'Writing…';
    try {
        const r = await api('/album-fix/apply', { method: 'POST', body: JSON.stringify({ items }) });
        toast(`Fixed the album info of ${plural(r.written, 'song')}${r.failed.length ? `; ${r.failed.length} couldn't be changed (${r.failed[0]})` : ''}`, r.failed.length ? 'error' : undefined);
        TD.fixJob = null;
        await refreshLibrary();
    } catch (err) { toast(err.message, 'error'); button.disabled = false; }
}

async function tidyUndo() {
    try {
        const r = await api('/album-fix/undo', { method: 'POST' });
        toast(`Put back the old album info of ${plural(r.restored, 'song')}`);
        TD.fixJob = null;
        await refreshLibrary();
    } catch (err) { toast(err.message, 'error'); }
}

// One shared tooltip for every chart mark (hover or keyboard focus); text only, never innerHTML
function bindChartTooltip() {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    const value = document.createElement('strong');
    const label = document.createElement('span');
    tip.append(value, label);
    document.body.appendChild(tip);
    const show = (e) => {
        const mark = e.target.closest && e.target.closest('[data-tip-value]');
        if (!mark) return;
        value.textContent = mark.dataset.tipValue;
        label.textContent = mark.dataset.tipLabel;
        tip.hidden = false;
        const box = mark.getBoundingClientRect();
        const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2));
        tip.style.left = `${left}px`;
        tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 8)}px`;
    };
    const hide = (e) => { if (e.target.closest && e.target.closest('[data-tip-value]')) tip.hidden = true; };
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('pointerout', hide);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', () => { tip.hidden = true; }, true);
}

// ---------- router ----------

function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = hash.split('/');
    const parts = rest.map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    switch (name) {
        case '': return { name: 'home' };
        case 'songs': return { name: 'songs' };
        case 'liked': return { name: 'liked' };
        case 'abx': return { name: 'abx', id: parts[0] || '' };
        case 'collection': return { name: 'collection', key: parts.join('/') };
        case 'artist': return { name: 'artist', artist: parts.join('/') };
        case 'search': return { name: 'search', q: parts[0] || '', filter: parts[1] || 'all' };
        case 'spotify': case 'ytm': return { name: 'remote', source: name, kind: parts[0], id: parts.slice(1).join('/') };
        case 'downloads': return { name: 'downloads' };
        case 'genres': return { name: 'genres' };
        case 'stats': return { name: 'stats' };
        case 'tidy': return { name: 'tidy' };
        case 'library': return { name: 'library' };
        case 'settings': return { name: 'settings' };
        case 'schedules': return { name: 'schedules' };
        case 'genre': return { name: 'genre', genre: parts.join('/') };
        default: return { name: 'home' };
    }
}

let renderSeq = 0;
async function render({ keepScroll = false } = {}) {
    const seq = ++renderSeq;
    const r = route();
    document.body.classList.toggle('has-back-button', r.name !== 'home');
    // A background refresh (a download finishing, genres arriving) must not wipe a listening test in progress
    if (keepScroll && r.name === 'abx' && $('#abxRoot')?.dataset.track === r.id) return;
    const main = $('#main');
    const view = $('#view');
    const scroll = main.scrollTop;
    contexts.clear();
    view.style.removeProperty('--hero');
    delete view.dataset.heroSrc;

    // Keep the search box in sync with the URL
    const input = $('#searchInput');
    if (r.name === 'search' && document.activeElement !== input) input.value = r.q;
    if (r.name !== 'search' && document.activeElement !== input) input.value = '';
    $('#searchBox').classList.toggle('has-value', !!input.value);
    $('#homeBtn').classList.toggle('active', r.name === 'home');

    let content;
    const isAsync = r.name === 'search' && r.q || r.name === 'remote';
    if (isAsync && !keepScroll) view.innerHTML = loadingView().s;
    switch (r.name) {
        case 'songs':
            if (!keepScroll) { S.songsView.q = ''; S.songsView.genre = null; } // a fresh visit starts unfiltered; the sort is kept
            content = viewSongs(); break;
        case 'liked': content = viewLiked(); break;
        case 'abx': content = viewAbx(r.id); break;
        case 'collection': content = viewCollection(r.key); break;
        case 'artist': content = viewLocalArtist(r.artist); break;
        case 'search': content = await viewSearch(r.q, r.filter); break;
        case 'remote': content = await viewRemote(r.source, r.kind, r.id); break;
        case 'downloads': content = viewDownloads(); break;
        case 'genres': content = viewGenres(); break;
        case 'stats': content = await viewStats(); break;
        case 'tidy': content = await viewTidy(); break;
        case 'library': content = viewLibrary(); break;
        case 'schedules': content = await viewSchedules(); break;
        case 'genre': content = viewGenre(r.genre); break;
        case 'settings': content = viewHome(); break; // modal opens below; type #/settings in the address bar if menus are unreachable
        default: content = viewHome();
    }
    if (seq !== renderSeq) return; // a newer navigation won
    if (r.name !== 'abx' || (AB.session && $('#abxRoot')?.dataset.track !== r.id)) stopAbx(); // leaving the test stops its sound
    // A background refresh mustn't steal focus from a box being typed in (the All songs search)
    const typingIn = view.contains(document.activeElement) && document.activeElement.matches('input[id]') ? document.activeElement : null;
    const caret = typingIn && [typingIn.selectionStart, typingIn.selectionEnd];
    view.innerHTML = content.s;
    view.classList.remove('route-enter');
    if (!keepScroll && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        void view.offsetWidth;
        view.classList.add('route-enter');
    }
    if (typingIn && keepScroll) { const again = document.getElementById(typingIn.id); again?.focus(); again?.setSelectionRange(...caret); }
    if (r.name === 'abx') mountAbx(r.id);
    if (r.name === 'library') renderSidebar();
    // Phone tab bar: Home, Search, or Your Library for everything you own
    const tab = r.name === 'home' ? 'home' : r.name === 'search' ? 'search'
        : ['library', 'songs', 'liked', 'collection', 'artist', 'genre', 'genres'].includes(r.name) ? 'library' : null;
    $$('#tabbar [data-tab]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === tab));
    if (r.name === 'collection') makeSortable('#sortTracks', (from, to) => movePlaylistSong(r.key, from, to));
    main.scrollTop = keepScroll ? scroll : 0;

    // Hero colour from the first cover in the header
    const heroImg = $('.hero .art img', view);
    if (heroImg) applyHeroColor(heroImg.src);
    else if (r.name === 'home') view.style.setProperty('--hero', '#3a3a6a');

    if (r.name === 'downloads') {
        renderJobsList();
        $('#pasteForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const url = $('#pasteInput').value.trim();
            if (!url) return;
            startDownload({ url });
            $('#pasteInput').value = '';
        });
    }
    highlightSidebar();
    markPlaying();
    updateControls();
    if (r.name === 'settings') { history.replaceState(null, '#/'); openSettings(); } // direct link; replaceState avoids re-open loops
}
const rerender = () => render({ keepScroll: true });

// ---------- events ----------

function playFromRow(row) {
    const c = contexts.get(row.dataset.ctx);
    if (!c) return;
    const t = currentTrack();
    if (t && t.id === row.dataset.id && P.context && P.context.key === c.context.key) { togglePlay(); return; }
    playContext(c.ids, +row.dataset.index, c.context);
}

function bindEvents() {
    // Delegated clicks for everything rendered into the view, sidebar and player
    document.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
            const action = actionEl.dataset.action;
            e.preventDefault();
            e.stopPropagation();
            if (action === 'play-row') playFromRow(actionEl.closest('.track'));
            else if (action === 'play-ctx') {
                const c = contexts.get(actionEl.dataset.ctx);
                if (!c) return;
                if (actionEl.dataset.playContext && P.context && P.context.key === c.context.key && P.context.variant === c.context.variant && currentTrack()) togglePlay();
                else playContext(c.ids, actionEl.dataset.index !== undefined ? +actionEl.dataset.index : null, c.context);
            } else if (action === 'play-local') {
                const id = actionEl.dataset.localId;
                playContext([id], 0, { key: `track:${id}`, label: S.byId.get(id)?.title || '', href: location.hash });
            } else if (action === 'download') {
                startDownload({
                    url: actionEl.dataset.downloadUrl, type: actionEl.dataset.type,
                    title: actionEl.dataset.title || undefined, image: actionEl.dataset.image || undefined,
                    total: actionEl.dataset.total ? +actionEl.dataset.total : undefined,
                });
            } else if (action === 'toggle-shuffle') {
                toggleShuffle();
                actionEl.classList.toggle('on', P.shuffle);
                actionEl.setAttribute('aria-pressed', P.shuffle);
            } else if (action === 'cancel-job') {
                api(`/jobs/${encodeURIComponent(actionEl.dataset.jobId)}`, { method: 'DELETE' }).then(() => schedulePoll(200)).catch((err) => toast(err.message, 'error'));
            } else if (action === 'play-download') {
                const c = S.collections.find((item) => item.key === actionEl.dataset.collectionKey);
                if (!c?.track_ids.length) { toast('This download is no longer in your library.', 'error'); return; }
                playContext(c.track_ids, null, { key: `collection:${c.key}`, label: c.name, href: `#/collection/${encodeURIComponent(c.key)}` });
            } else if (action === 'toggle-table') {
                const card = actionEl.closest('.chart-card');
                const on = card.classList.toggle('show-table');
                actionEl.textContent = on ? 'Chart' : 'Table';
                actionEl.setAttribute('aria-pressed', on);
            } else if (action === 'like') toggleLike(actionEl.dataset.likeId);
            else if (action === 'row-menu') rowMenu(actionEl.closest('.track'), { anchor: actionEl });
            else if (action === 'collection-menu') collectionMenu(actionEl);
            else if (action === 'collection-cache') {
                const r = route();
                const c = r.name === 'collection' && S.collections.find((x) => x.key === r.key);
                if (c && c.track_ids.length) cacheForOffline(c.track_ids, c.name);
                else toast('Nothing to save here yet.', 'error');
            }
            else if (action === 'track-view') {
                S.trackView = actionEl.dataset.view;
                store.set('trackView', S.trackView);
                if (route().name === 'songs') refreshSongs(); else rerender();
            }
            else if (action === 'songs-sort-menu') songsSortMenu(actionEl);
            else if (action === 'stats-more') statsMoreMenu(actionEl);
            else if (action === 'sleep-menu') sleepMenu(actionEl);
            else if (action === 'lib-sort-menu') librarySortMenu(actionEl);
            else if (action === 'create-menu') createMenu(actionEl);
            else if (action === 'queue-open') toggleQueue(true);
            else if (action === 'queue-close') toggleQueue(false);
            else if (action === 'queue-play') playFromQueue(actionEl.closest('[data-queue-kind]'));
            else if (action === 'queue-remove') {
                const index = +actionEl.closest('[data-sort-index]').dataset.sortIndex;
                if (!remoteCommand('queue_remove', index)) { P.upNext.splice(index, 1); queueChanged(); }
            }
            else if (action === 'queue-clear') {
                if (!remoteCommand('queue_clear')) { P.upNext = []; queueChanged(); }
            }
            else if (action === 'tidy-tab') { TD.tab = actionEl.dataset.tab; rerender(); }
            else if (action === 'tidy-merge') tidyMerge(actionEl.dataset.group);
            else if (action === 'tidy-merge-all') tidyMergeAll();
            else if (action === 'tidy-scan') tidyScan();
            else if (action === 'tidy-apply') tidyApply(actionEl);
            else if (action === 'tidy-undo') tidyUndo();
            else if (action === 'songs-sort') { // a column title: again flips the order
                const key = actionEl.dataset.sort, v = S.songsView;
                setSongsSort(key, v.sort === key ? (v.dir === 'asc' ? 'desc' : 'asc') : null);
            } else if (action === 'songs-genre') {
                S.songsView.genre = S.songsView.genre === actionEl.dataset.genre ? null : actionEl.dataset.genre;
                refreshSongs();
            } else if (action === 'songs-clear') {
                S.songsView.genre = null; S.songsView.q = '';
                refreshSongs();
            }
            else if (action === 'settings') openSettings('downloads');
            else if (action === 'open-music-folder') openLibraryLocation();
            else if (action === 'connect-spotify') openSettings('spotify');
            return;
        }
        const row = e.target.closest('.track[data-id]');
        if (row && !e.target.closest('a')) {
            $$('.track.selected').forEach((r) => r.classList.remove('selected'));
            row.classList.add('selected');
            // Touch screens: one tap plays, as in Spotify's app (no hover to reveal ▶, and double-tap is unreliable)
            if (matchMedia('(hover: none)').matches && row.dataset.ctx && !e.target.closest('button')) playFromRow(row);
        }
        const libItem = e.target.closest('.lib-item[data-href]');
        if (libItem) location.hash = libItem.dataset.href;
        const range = e.target.closest('[data-stats-range]');
        if (range) {
            setStatsRange(range.dataset.statsRange);
            return;
        }
        const chip = e.target.closest('[data-lib-filter]');
        if (chip) { S.libFilter = chip.dataset.libFilter; store.set('libFilter', S.libFilter); renderSidebar(); }
    });
    document.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('.track[data-id]');
        if (!row || !S.byId.has(row.dataset.id) || e.target.closest('a')) return;
        e.preventDefault();
        rowMenu(row, { x: e.clientX, y: e.clientY });
    });
    document.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.track[data-id]');
        if (row && !e.target.closest('a, button')) playFromRow(row);
    });

    // Scheduled plays list: on/off switches and ⋯ to edit
    document.addEventListener('change', async (e) => {
        const box = e.target.closest('[data-sch-toggle]');
        if (!box) return;
        const s = SCH.list.find((x) => x.id === box.dataset.schToggle);
        if (!s) return;
        try { await api('/schedules', { method: 'POST', body: JSON.stringify({ ...s, enabled: box.checked }) }); await loadSchedules(); rerender(); }
        catch (err) { toast(err.message, 'error'); box.checked = !box.checked; }
    });
    document.addEventListener('click', (e) => {
        const edit = e.target.closest('[data-sch-edit]');
        if (!edit) return;
        const s = SCH.list.find((x) => x.id === edit.dataset.schEdit);
        if (s) scheduleDialog(s.what, s);
    });

    // Tidy up: which copy to keep, which album fixes to write (no redraw: the radios and boxes are the state)
    document.addEventListener('change', (e) => {
        const keep = e.target.closest('[data-tidy-keep]');
        if (keep) {
            TD.pick[keep.dataset.tidyKeep] = keep.value;
            const group = keep.closest('.dupe-group');
            $$('.dupe-copy', group).forEach((row) => {
                const on = $('input', row).checked;
                row.classList.toggle('keep', on);
                $('.dupe-tag', row).textContent = on ? 'Keep' : 'Remove';
            });
        }
        const fix = e.target.closest('[data-tidy-fix]');
        if (fix) {
            if (fix.checked) TD.fixOff.delete(fix.dataset.tidyFix); else TD.fixOff.add(fix.dataset.tidyFix);
            const n = $$('[data-tidy-fix]').filter((x) => x.checked).length;
            const button = $('[data-action="tidy-apply"]');
            button.textContent = `Fix ${plural(n, 'song')}`;
            button.disabled = !n;
        }
    });

    document.addEventListener('input', (e) => {
        if (e.target.id === 'pageLibraryFilterInput') { S.libQuery = e.target.value; $('#libraryFilterInput').value = S.libQuery; renderSidebar(); return; }
        if (e.target.id !== 'songsSearch') return;
        S.songsView.q = e.target.value;
        clearTimeout(S.songsTimer);
        S.songsTimer = setTimeout(refreshSongs, 120); // 855 rows: redraw after a short pause, not on every key
    });

    // Search box → #/search/<q>, debounced; replaceState so typing doesn't flood history
    const input = $('#searchInput');
    let searchTimer = null;
    input.addEventListener('input', () => {
        $('#searchBox').classList.toggle('has-value', !!input.value);
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const q = input.value.trim();
            const target = q ? `#/search/${encodeURIComponent(q)}` : '#/search';
            if (route().name === 'search') history.replaceState(null, '', target);
            else history.pushState(null, '', target);
            render();
        }, 350);
    });
    input.addEventListener('focus', () => { if (route().name !== 'search' && !input.value) { history.pushState(null, '', '#/search'); render(); } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
    $('#searchClear').addEventListener('click', (e) => { e.preventDefault(); input.value = ''; input.focus(); history.replaceState(null, '', '#/search'); render(); });

    $('#libraryFilterInput').addEventListener('input', (e) => { S.libQuery = e.target.value; renderSidebar(); });
    $('#navBack').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.hash = route().name === 'remote' ? '#/search' : '#/';
    });
    $('#navForward').addEventListener('click', () => history.forward());
    $('#settingsBtn').addEventListener('click', () => openSettings());
    $('#mobileMoreBtn').addEventListener('click', (e) => showMenu([
        { label: 'Downloads', icon: 'downloadPlain', run: () => { location.hash = '#/downloads'; } },
        { label: 'Listening stats', icon: 'chart', run: () => { location.hash = '#/stats'; } },
        '-',
        { label: 'Settings', icon: 'settings', run: () => openSettings() },
    ], { anchor: e.currentTarget, label: 'More destinations' }));
    window.addEventListener('hashchange', () => render());
    window.addEventListener('popstate', () => render());

    // Keyboard: space = play/pause, / or ⌘K = search
    document.addEventListener('keydown', (e) => {
        const el = e.target instanceof Element ? e.target : document.body;
        const typing = el.closest('input, select, textarea, [contenteditable]');
        if (e.key === ' ' && !typing && !el.closest('button, a')) { e.preventDefault(); togglePlay(); }
        else if (e.key.toLowerCase() === 'q' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); toggleQueue(); }
        else if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); input.focus(); input.select(); }
    });
}

function bindImageFallback() {
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement) || !img.closest('.art')) return;
        const art = img.closest('.art');
        img.remove();
        if (!art.querySelector('img, svg')) art.innerHTML = icon(art.classList.contains('round') ? 'user' : 'note', 24).s;
    }, true); // error events don't bubble, so listen in the capture phase
}

function paintChrome() {
    document.addEventListener('themechange', updateThemeScheduleStatus);
    $('#brandMark').innerHTML = icon('spotDLr', 32).s;
    $('#navBack').innerHTML = icon('back', 18).s;
    $('#navForward').innerHTML = icon('forward', 18).s;
    $('#homeBtn').innerHTML = icon('home', 22).s;
    $('#searchIcon').innerHTML = icon('search', 22).s;
    $('#searchClear').innerHTML = icon('close', 18).s;
    $('#downloadsBtn').insertAdjacentHTML('afterbegin', icon('downloadPlain', 20).s);
    $('#settingsBtn').innerHTML = icon('settings', 20).s;
    $('#statsBtn').innerHTML = icon('chart', 20).s;
    $('#mobileMoreBtn').innerHTML = icon('more', 22).s;
    $$('#tabbar [data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, 22).s; });
    $('#createBtn').innerHTML = icon('plus', 20).s;
    $('#createBtn').addEventListener('click', (e) => createMenu(e.currentTarget));
    $('#librarySort').addEventListener('click', (e) => librarySortMenu(e.currentTarget));
    $('#libraryTitle').innerHTML = html`${icon('library', 22)}<span>Your Library</span>`.s;
    setSidebarCollapsed(store.get('sidebarCollapsed', false) === true);
    $('#sidebarToggle').addEventListener('click', () => setSidebarCollapsed(!$('.app').classList.contains('sidebar-collapsed')));
    $('#libraryFilter').insertAdjacentHTML('afterbegin', icon('search', 14).s);
}

// ---------- menus (⋯ buttons and right-click) ----------
// One menu at a time, in #menuRoot. Keyboard: ↑/↓/Home/End move, Enter/Space pick, Esc closes and returns
// focus to the button that opened it; any click outside, Tab, scrolling or resizing closes it.

const M = { opener: null, cleanup: null, log: [] };
const menuEvent = (what) => { M.log.push(`${new Date().toLocaleTimeString()}: ${what}`); M.log = M.log.slice(-8); };

function showMenu(items, { anchor = null, x = 0, y = 0, label = 'Options' } = {}) {
    menuEvent(`open ${label}`);
    if (M.cleanup && anchor && M.opener === anchor) { closeMenu(); menuEvent('toggle-shut'); return; } // toggle: re-tapping never falls through
    closeMenu(false);
    const root = $('#menuRoot');
    root.innerHTML = html`<div class="menu" role="menu" aria-label="${label}">${items.map((item, i) => item === '-'
        ? html`<div class="menu-sep" role="separator"></div>`
        : item.heading ? html`<div class="menu-heading" role="presentation">${item.heading}</div>`
        : 'checked' in item // one of a set of choices: ✓ on the chosen one, no icon
        ? html`<button class="menu-item menu-choice ${item.checked ? 'checked' : ''}" role="menuitemradio" aria-checked="${String(!!item.checked)}" data-menu-index="${i}" tabindex="-1"><span>${item.label}</span>${item.checked ? icon('checkPlain', 16) : ''}</button>`
        : html`<button class="menu-item ${item.danger ? 'danger' : ''}" role="menuitem" data-menu-index="${i}" tabindex="-1" ${item.disabled ? 'disabled' : ''}>${icon(item.icon || 'note', 16)}<span>${item.label}</span></button>`)}</div>`.s;
    const menu = $('.menu', root);
    // Under the button (right-aligned), or at the cursor; then kept inside the window
    const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, bottom: y, top: y };
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const left = anchor ? r.right - w : x;
    let top = r.bottom + 4;
    if (top + h > innerHeight - 8) top = Math.max(8, (anchor ? r.top - 4 : y) - h);
    menu.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
    menu.style.top = `${top}px`;
    M.opener = anchor || document.activeElement;
    M.anchor = anchor; // non-null only for button-anchored menus (the re-tap exemption in `outside`)
    M.prevOverflow = document.documentElement.style.overflow; // lock page scroll: a scroll between touch-down and touch-up moves content under a fixed menu and misroutes the tap
    document.documentElement.style.overflow = 'hidden';
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    const buttons = $$('.menu-item:not([disabled])', menu);
    ($('.menu-item.checked', menu) || buttons[0])?.focus({ preventScroll: true });

    const pick = (e) => {
        const btn = e.target.closest('.menu-item');
        if (!btn || btn.disabled) return;
        const item = items[+btn.dataset.menuIndex];
        menuEvent(`pick:${item.label || btn.dataset.menuIndex}`);
        closeMenu(false);
        try { item.run(); } catch (err) { toast(`Couldn't open: ${err && err.message || err}`, 'error'); }
    };
    const onKey = (e) => {
        const i = buttons.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
        else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); buttons[e.key === 'Home' ? 0 : buttons.length - 1].focus(); }
        else if (e.key === 'Tab') closeMenu(false);
    };
    const outside = (e) => {
        if (!menu.isConnected) return; // stale listener from a dead menu: never act on a detached box
        if (menu.contains(e.target)) return;
        if (M.anchor && (e.target === M.anchor || M.anchor.contains(e.target))) return; // re-tapping ⋯ belongs to the toggle, not to dismissal
        menuEvent(`close:outside ${String(e.target.className || e.target.tagName).slice(0, 30)}`);
        closeMenu(false);
    };
    let openedAt = Date.now();
    const away = () => { if (Date.now() - openedAt > 500) { menuEvent('close:scroll/resize'); closeMenu(false); } }; // grace for open-time layout shifts on mobile
    // A tap's own micro-scroll must not dismiss the menu before the tap lands: any press
    // starting inside the menu renews immunity, so selecting an item always works on touch.
    menu.addEventListener('pointerdown', () => { openedAt = Date.now(); }, true);
    menu.addEventListener('click', pick);
    menu.addEventListener('keydown', onKey);
    // Registered synchronously: the opening tap's pointerdown has already finished by now, and a
    // deferred registration was a leak vector (a menu closed in the same tick left a listener
    // behind that killed every menu opened afterwards).
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', away);
    document.addEventListener('scroll', away, true);
    M.cleanup = () => {
        document.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('resize', away);
        document.removeEventListener('scroll', away, true);
        document.documentElement.style.overflow = M.prevOverflow || '';
    };
}

function closeMenu(returnFocus = true) {
    if (!M.cleanup) return;
    M.cleanup();
    M.cleanup = null;
    M.anchor = null;
    $('#menuRoot').innerHTML = '';
    if (M.opener) {
        M.opener.removeAttribute?.('aria-expanded');
        if (returnFocus && M.opener.isConnected) M.opener.focus();
    }
}

// The playlist you made that a row belongs to (for "Remove from …"), from the row's play context
function rowPlaylist(row) {
    const ctx = contexts.get(row.dataset.ctx);
    const key = ctx && ctx.context.key.startsWith('collection:') ? ctx.context.key.slice(11) : null;
    const c = key && S.collections.find((x) => x.key === key);
    return c && c.editable ? c : null;
}

async function openLibraryLocation(target = {}) {
    try {
        await api('/reveal', { method: 'POST', body: JSON.stringify(target) });
    } catch (error) { toast(error.message, 'error'); }
}

function rowMenu(row, position) {
    const t = row && S.byId.get(row.dataset.id);
    if (!t) return;
    const playlist = rowPlaylist(row);
    showMenu([
        { label: 'Play next', icon: 'playNext', run: () => addToQueue([t.id], { next: true }) },
        { label: 'Add to queue', icon: 'queue', run: () => addToQueue([t.id]) },
        { label: 'Schedule play', icon: 'clock', run: () => scheduleDialog(whatForTrack(t)) },
        '-',
        { label: S.liked.has(t.id) ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: S.liked.has(t.id) ? 'heartFilled' : 'heart', run: () => toggleLike(t.id) },
        { label: 'Add to playlist', icon: 'listAdd', run: () => addToPlaylistDialog([t.id], t.title) },
        { label: 'Add to album', icon: 'disc', run: () => addToAlbumDialog([t.id], t.title) },
        ...(playlist ? [{ label: `Remove from ${playlist.name}`, icon: 'trash', run: () => removeFromPlaylist(playlist, [t.id], t.title) }] : []),
        { label: 'Send to device', icon: 'usb', run: () => sendToDeviceDialog([t.id], t.title, null) },
        ...(('serviceWorker' in navigator && 'caches' in window) ? [{ label: 'Make available offline', icon: 'download', run: () => cacheForOffline([t.id], t.title) }] : []),
        { label: savingLyrics.has(t.id) ? 'Downloading lyrics…' : 'Download lyrics', icon: 'downloadPlain', disabled: savingLyrics.has(t.id), run: () => saveTrackLyrics(t) },
        ...(S.init.apple_music ? [{ label: 'Add to Apple Music', icon: 'apple', run: () => appleMusicDialog([t.id], t.title, null, false) }] : []),
        { label: 'Blind listening test', icon: 'ear', run: () => { location.hash = `#/abx/${encodeURIComponent(t.id)}`; } },
        '-',
        { label: `Go to ${t.artists[0]}`, icon: 'user', run: () => { location.hash = artistHref(t.artists[0]); } },
        ...(S.init.on_phone ? [] : [{ label: /Mac/.test(navigator.platform) ? 'Show in Finder' : 'Open containing folder', icon: 'folder', run: () => openLibraryLocation({ track_id: t.id }) }]),
        '-',
        { label: 'Delete song', icon: 'trash', danger: true, run: () => deleteTrackDialog(t) },
    ], { ...position, label: `Options for ${t.title}` });
}

function collectionMenu(anchor) {
    const r = route();
    const c = r.name === 'collection' && S.collections.find((x) => x.key === r.key);
    const ids = c ? c.track_ids : r.name === 'liked' ? S.likedOrder : [];
    const name = c ? c.name : 'Liked Songs';
    showMenu([
        { label: 'Add to queue', icon: 'queue', disabled: !ids.length, run: () => addToQueue(ids) },
        { label: 'Schedule play', icon: 'clock', disabled: !ids.length, run: () => scheduleDialog(c ? whatForCollection(c) : whatForLiked()) },
        { label: 'Add to another playlist', icon: 'listAdd', disabled: !ids.length, run: () => addToPlaylistDialog(ids, name) },
        { label: 'Send to device', icon: 'usb', disabled: !ids.length, run: () => sendToDeviceDialog(ids, name, name) },
        { label: 'Download as ZIP', icon: 'download', disabled: !ids.length, run: () => downloadZip(ids, name) },
        ...(window.showDirectoryPicker ? [{ label: 'Save to USB / folder…', icon: 'usb', disabled: !ids.length, run: () => saveToFolder(ids, name) }] : []),
        ...(c && !S.init.on_phone ? [{ label: 'Open folder', icon: 'folder', run: () => openLibraryLocation({ collection_key: c.key }) }] : []),
        ...(S.init.apple_music ? [{ label: 'Add to Apple Music', icon: 'apple', disabled: !ids.length, run: () => appleMusicDialog(ids, name, name, !(c && c.kind === 'album')) }] : []),
        ...(c && c.editable ? ['-', { label: 'Rename', icon: 'listAdd', run: () => renamePlaylistDialog(c) },
            { label: 'Delete playlist', icon: 'trash', danger: true, run: () => deletePlaylistDialog(c) }] : []),
    ], { anchor, label: `Options for ${name}` });
}

function createMenu(anchor) {
    showMenu([
        { label: 'New playlist', icon: 'listAdd', run: () => newPlaylistDialog([]) },
        { label: 'Add music files', icon: 'upload', run: () => addFilesDialog([]) },
        { label: 'Import playlist CSV', icon: 'upload', run: () => importCsvDialog() },
    ], { anchor, label: 'Create' });
}

function importCsvDialog() {
    const existing = S.collections.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    openModal({
        title: 'Import playlist CSV',
        body: html`<form id="csvForm" class="dialog-form">
            <p class="dialog-note">From Exportify (or any CSV with track and artist columns). Songs are matched on YouTube Music — no Spotify keys needed. Merging into an existing playlist downloads into its folder; new names start a new folder.</p>
            <div class="field"><span>Playlist</span><select id="csvTarget" class="field-input">${existing.map((n) => `<option>${n}</option>`).join('')}<option value="">New playlist…</option></select></div>
            <div class="field" id="csvNewWrap" hidden><span>New playlist name</span><input id="csvNew" class="field-input plain" maxlength="80" placeholder="My playlist"></div>
            <div class="field"><span>CSV file</span><input type="file" id="csvFile" accept=".csv,text/csv"></div>
            <p class="form-error" id="csvError" hidden></p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close>Cancel</button><button type="submit" class="pill-btn primary" id="csvSubmit">Import</button></div>
        </form>`,
        onOpen: (modal) => {
            const target = $('#csvTarget', modal), wrap = $('#csvNewWrap', modal), err = $('#csvError', modal);
            target.addEventListener('change', () => { wrap.hidden = target.value !== ''; });
            wrap.hidden = target.value !== '';
            $('#csvForm', modal).addEventListener('submit', async (e) => {
                e.preventDefault();
                err.hidden = true;
                const name = target.value || $('#csvNew', modal).value.trim();
                const file = $('#csvFile', modal).files[0];
                if (!name) { err.textContent = 'Pick or name a playlist.'; err.hidden = false; return; }
                if (!file) { err.textContent = 'Choose a CSV file.'; err.hidden = false; return; }
                const submit = $('#csvSubmit', modal);
                submit.disabled = true;
                try {
                    const csvText = await file.text();
                    const job = await api('/import-csv', { method: 'POST', body: JSON.stringify({ name, csv_text: csvText }) });
                    modal.querySelector('[data-close]').click();
                    toast(`Importing ${plural(job.total, 'song')} into ${name}…`);
                    location.hash = '#/downloads';
                } catch (error) { err.textContent = error.message; err.hidden = false; submit.disabled = false; }
            });
        },
    });
}

// ---------- dialogs ----------

function openModal({ title, body, wide = false, onOpen }) {
    closeMenu(false);
    const opener = document.activeElement;
    $('#modalRoot').innerHTML = html`
        <div class="modal-backdrop" data-close>
            <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
                <div class="modal-head"><h2 id="dialogTitle">${title}</h2>
                    <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close', 18)}</button></div>
                ${body}
            </div>
        </div>`.s;
    const backdrop = $('#modalRoot .modal-backdrop');
    const modal = $('.modal', backdrop);
    const close = () => { $('#modalRoot').innerHTML = ''; if (opener && opener.isConnected && opener.focus) opener.focus(); };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('button[data-close]')) close(); });
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    if (onOpen) onOpen(modal, close);
    ($('[autofocus]', modal) || $('input:not(.sr-only), select, button:not([data-close]):not(:disabled)', modal) || $('button[data-close]', modal) || modal).focus();
    return close;
}

const editablePlaylists = () => S.collections.filter((c) => c.editable);

async function refreshLibrary() {
    await loadLibrary();
    renderSidebar();
    await rerender();
}

function newPlaylistDialog(trackIds) {
    const n = editablePlaylists().length + 1;
    openModal({
        title: 'New playlist',
        body: html`<form id="newPlaylistForm" class="dialog-form">
            <label class="field"><span>Name</span><input class="field-input plain" id="playlistName" maxlength="120" value="My Playlist #${n}" autofocus></label>
            ${trackIds.length ? html`<p class="dialog-note">${plural(trackIds.length, 'song')} will be added.</p>` : ''}
            <p class="form-error" id="playlistError" hidden></p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close>Cancel</button><button type="submit" class="pill-btn primary">Create</button></div>
        </form>`,
        onOpen: (modal, close) => {
            setTimeout(() => $('#playlistName', modal).select());
            $('#newPlaylistForm', modal).addEventListener('submit', async (e) => {
                e.preventDefault();
                const err = $('#playlistError', modal);
                try {
                    const { key } = await api('/playlists', { method: 'POST', body: JSON.stringify({ name: $('#playlistName', modal).value, track_ids: trackIds }) });
                    close();
                    await refreshLibrary();
                    toast(`Created ${key}`);
                    location.hash = `#/collection/${encodeURIComponent(key)}`;
                } catch (error) { err.textContent = error.message; err.hidden = false; }
            });
        },
    });
}

function addToPlaylistDialog(trackIds, label) {
    const lists = S.collections.filter((collection) => collection.kind === 'playlist');
    openModal({
        title: 'Add to playlist',
        body: html`<p class="dialog-note">${trackIds.length === 1 ? label : plural(trackIds.length, 'song')}</p>
            <div class="pick-list">
                <button class="pick-row" data-new-playlist><div class="art pick-art">${icon('plus', 22)}</div><div><div class="pick-name">New playlist</div></div></button>
                ${lists.map((c) => html`<button class="pick-row" data-playlist-key="${c.key}">${collectionArt(c, 'pick-art')}<div><div class="pick-name">${c.name}</div><div class="pick-sub">${plural(c.track_ids.length, 'song')}</div></div></button>`)}
            </div>
            ${lists.length ? '' : html`<p class="dialog-note">No playlists yet. Create one to start organizing your songs.</p>`}`,
        onOpen: (modal, close) => {
            modal.addEventListener('click', async (e) => {
                if (e.target.closest('[data-new-playlist]')) { close(); newPlaylistDialog(trackIds); return; }
                const row = e.target.closest('[data-playlist-key]');
                if (!row) return;
                const key = row.dataset.playlistKey;
                const before = S.collections.find((c) => c.key === key).track_ids.length;
                try {
                    const { count } = await api(`/playlists/${encodeURIComponent(key)}/tracks`, { method: 'POST', body: JSON.stringify({ track_ids: trackIds, action: 'add' }) });
                    close();
                    toast(count === before ? `Already in ${key}` : `Added to ${key}`);
                    await refreshLibrary();
                } catch (error) { toast(error.message, 'error'); }
            });
        },
    });
}

function addToAlbumDialog(trackIds, label) {
    const albums = S.collections.filter((c) => c.kind === 'album');
    openModal({
        title: 'Add to album',
        body: html`<p class="dialog-note">${trackIds.length === 1 ? label : plural(trackIds.length, 'song')}</p>
            <p class="dialog-note">Groups the song in spotDLr. Your music file and album tags stay unchanged.</p>
            <div class="pick-list album-pick-list">${albums.map((c) => {
                const already = trackIds.every((id) => c.track_ids.includes(id));
                return html`<button class="pick-row" data-album-key="${c.key}" data-in-album="${String(already)}" ${already ? 'disabled' : ''}>
                    ${collectionArt(c, 'pick-art')}<div><div class="pick-name">${c.name}</div>
                    <div class="pick-sub">${c.artist} · ${plural(c.track_ids.length, 'song')}${already ? ' · Already in album' : ''}</div></div></button>`;
            })}</div>
            ${albums.length ? '' : html`<p class="dialog-note">No albums yet. Use <strong>Add music files → A new album</strong> to create one.</p>
                <button class="pill-btn" data-add-music>Add music files</button>`}
            <p class="form-error" id="albumAddError" role="alert" hidden></p>`,
        onOpen: (modal, close) => {
            modal.addEventListener('click', async (e) => {
                if (e.target.closest('[data-add-music]')) { close(); addFilesDialog([]); return; }
                const row = e.target.closest('[data-album-key]');
                if (!row || row.disabled) return;
                const album = albums.find((c) => c.key === row.dataset.albumKey);
                const rows = $$('[data-album-key]', modal), err = $('#albumAddError', modal);
                const sub = $('.pick-sub', row), before = sub.textContent;
                rows.forEach((button) => { button.disabled = true; });
                row.setAttribute('aria-busy', 'true');
                sub.textContent = 'Adding…';
                err.hidden = true;
                try {
                    const { count } = await api(`/albums/${encodeURIComponent(album.key)}/tracks`, { method: 'POST', body: JSON.stringify({ track_ids: trackIds }) });
                    if (modal.isConnected) close();
                    await refreshLibrary();
                    toast(count === album.track_ids.length ? `Already in ${album.name}` : `Added to ${album.name}`);
                } catch (error) {
                    err.textContent = error.message === 'Not Found'
                        ? 'Restart the spotDLr server on your computer, then try again. It has not loaded Add to album yet.'
                        : error.message;
                    err.hidden = false;
                } finally {
                    rows.forEach((button) => { button.disabled = button.dataset.inAlbum === 'true'; });
                    row.removeAttribute('aria-busy');
                    sub.textContent = before;
                }
            });
        },
    });
}

async function removeFromPlaylist(playlist, trackIds, label) {
    try {
        await api(`/playlists/${encodeURIComponent(playlist.key)}/tracks`, { method: 'POST', body: JSON.stringify({ track_ids: trackIds, action: 'remove' }) });
        toast(`Removed ${label} from ${playlist.name}`);
        await refreshLibrary();
    } catch (error) { toast(error.message, 'error'); }
}

async function movePlaylistSong(key, from, to) {
    const c = S.collections.find((x) => x.key === key);
    if (!c) return;
    const ids = [...c.track_ids];
    ids.splice(to, 0, ...ids.splice(from, 1));
    c.track_ids = ids; // show it straight away; the server confirms below
    if (P.context?.key === `collection:${key}` && !P.shuffle) { // playing this playlist: the queue follows the new order
        const playing = contextTrackId();
        P.queue = ids.filter((id) => S.byId.has(id));
        P.order = P.queue.map((_, i) => i);
        P.pos = Math.max(0, P.queue.indexOf(playing));
        saveSession();
    }
    try {
        await api(`/playlists/${encodeURIComponent(key)}/tracks`, { method: 'POST', body: JSON.stringify({ track_ids: ids, action: 'order' }) });
    } catch (error) { toast(error.message, 'error'); }
    await refreshLibrary();
}

function renamePlaylistDialog(c) {
    openModal({
        title: 'Rename playlist',
        body: html`<form id="renameForm" class="dialog-form">
            <label class="field"><span>Name</span><input class="field-input plain" id="renameInput" maxlength="120" value="${c.name}" autofocus></label>
            <p class="form-error" id="renameError" hidden></p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close>Cancel</button><button type="submit" class="pill-btn primary">Save</button></div>
        </form>`,
        onOpen: (modal, close) => {
            setTimeout(() => $('#renameInput', modal).select());
            $('#renameForm', modal).addEventListener('submit', async (e) => {
                e.preventDefault();
                try {
                    const { key } = await api(`/playlists/${encodeURIComponent(c.key)}/rename`, { method: 'POST', body: JSON.stringify({ name: $('#renameInput', modal).value }) });
                    const oldKey = `collection:${c.key}`, newKey = `collection:${key}`, href = `#/collection/${encodeURIComponent(key)}`;
                    if (S.recent[oldKey]) { S.recent[newKey] = S.recent[oldKey]; delete S.recent[oldKey]; store.set('recentContexts', S.recent); }
                    if (P.context?.key === oldKey) { P.context = { ...P.context, key: newKey, label: key, href }; saveSession(); }
                    close();
                    history.replaceState(null, '', href);
                    await refreshLibrary();
                    toast(`Renamed to ${key}`);
                } catch (error) { const err = $('#renameError', modal); err.textContent = error.message; err.hidden = false; }
            });
        },
    });
}

function removeTrackFromQueue(id) {
    const before = P.order.slice(0, P.pos).filter((i) => P.queue[i] !== id).length;
    const indices = new Map();
    const queue = P.queue.filter((trackId, i) => {
        if (trackId === id) return false;
        indices.set(i, indices.size);
        return true;
    });
    P.queue = queue;
    P.order = P.order.filter((i) => indices.has(i)).map((i) => indices.get(i));
    P.pos = Math.min(before, Math.max(0, P.order.length - 1));
    P.upNext = P.upNext.filter((trackId) => trackId !== id);
    if (P.queued === id) P.queued = null;
}

function deleteTrackDialog(t) {
    openModal({
        title: `Delete “${t.title}”?`,
        body: html`<p class="dialog-note">This removes the song from your library, playlists and Liked Songs. Its audio file and saved lyrics move to the ${navigator.platform.startsWith('Win') ? 'Recycle Bin' : 'Trash'}. If that isn't available, they're kept in spotDLr's Removed songs folder.</p>
            <p class="form-error" id="deleteTrackError" role="alert" hidden></p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close autofocus>Cancel</button><button type="button" class="pill-btn danger" id="confirmDeleteTrack">Delete song</button></div>`,
        onOpen: (modal, close) => {
            $('#confirmDeleteTrack', modal).addEventListener('click', async (e) => {
                const button = e.currentTarget;
                button.disabled = true;
                button.textContent = 'Deleting…';
                $('#deleteTrackError', modal).hidden = true;
                const playing = currentTrack()?.id === t.id;
                // Release the file before moving it, including on Windows.
                endFade();
                if (playing) {
                    flushListen();
                    P.audio.pause();
                    P.audio.removeAttribute('src');
                    P.audio.load();
                }
                let result;
                try { result = await api(`/tracks/${encodeURIComponent(t.id)}`, { method: 'DELETE' }); }
                catch (error) {
                    if (playing) {
                        P.audio.src = `/api/stream/${encodeURIComponent(t.id)}`;
                        startListen(t.id);
                    }
                    const message = $('#deleteTrackError', modal);
                    message.textContent = error.message;
                    message.hidden = false;
                    button.disabled = false;
                    button.textContent = 'Delete song';
                    return;
                }
                removeTrackFromQueue(t.id);
                S.byId.delete(t.id);
                close();
                if (route().name === 'abx' && route().id === t.id) location.hash = '#/songs';
                if (playing && currentTrack()) {
                    P.audio.src = `/api/stream/${encodeURIComponent(currentTrack().id)}`;
                    startListen(currentTrack().id);
                    setTrackGain(currentTrack().id);
                }
                if (!currentTrack()) {
                    store.set('session', null);
                    document.title = 'spotDLr';
                    $('#timeCurrent').textContent = '0:00';
                    $('#timeTotal').textContent = '0:00';
                    $('#seekBar').value = 0;
                    setRangeFill($('#seekBar'));
                    closeNowView();
                    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
                } else saveSession();
                updateNowPlaying();
                updateControls();
                renderQueue();
                try { await refreshLibrary(); }
                catch (error) { toast(`Song deleted. Couldn't refresh the library: ${error.message}`, 'error'); return; }
                toast(`Deleted ${t.title}. Moved to ${result.trash}.`);
            });
        },
    });
}

function deletePlaylistDialog(c) {
    openModal({
        title: `Delete ${c.name}?`,
        body: html`<p class="dialog-note">The playlist is removed. ${c.track_ids.length === 1 ? 'Its song stays' : `Its ${plural(c.track_ids.length, 'song')} stay`} in your library.</p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close autofocus>Cancel</button><button type="button" class="pill-btn danger" id="confirmDelete">Delete</button></div>`,
        onOpen: (modal, close) => {
            $('#confirmDelete', modal).addEventListener('click', async () => {
                try {
                    await api(`/playlists/${encodeURIComponent(c.key)}`, { method: 'DELETE' });
                    close();
                    toast(`Deleted ${c.name}`);
                    location.hash = '#/';
                    await refreshLibrary();
                } catch (error) { toast(error.message, 'error'); }
            });
        },
    });
}

// ---------- likes ----------

async function toggleLike(id) {
    const liked = !S.liked.has(id);
    const apply = (on) => {
        if (on) { S.liked.add(id); S.likedOrder = [id, ...S.likedOrder.filter((x) => x !== id)]; }
        else { S.liked.delete(id); S.likedOrder = S.likedOrder.filter((x) => x !== id); }
        $$(`.like-btn[data-like-id="${id}"]`).forEach((btn) => { btn.outerHTML = likeButton(id, { big: btn.classList.contains('big') }).s; });
        renderSidebar();
        if (route().name === 'liked') rerender();
    };
    apply(liked); // instant; undone if the server says no
    try { await api(`/likes/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ liked }) }); }
    catch (error) { apply(!liked); toast(`Couldn't save that: ${error.message}`, 'error'); }
}

// Phones: swipe a song left to like it (rows there have no ♥ button); on a liked song the same swipe removes it.
// The row's content follows the finger and a panel grows from the right edge into the space it leaves, showing what
// letting go will do. Past SWIPE_LIKE px it's armed; on release the heart pops, the row springs back and the row's
// small ♥ pops in. Not from the screen's right edge, which Safari uses for Forward.
// Touch events, not pointer events: iOS Safari starts its own scroll once a sideways swipe drifts ~10 px up or down,
// and from then on cancels the page's pointer events, so the row snapped back mid-swipe (Holden's iPhone, Oct 23).
// Once the swipe is ours, preventDefault() on each touchmove stops that scroll from starting. Until the direction is
// decided nothing is prevented, so up/down still scrolls; the rows' touch-action: pan-y keeps sideways pans off.
const SWIPE_LIKE = 80;
function bindSwipeToLike() {
    let swipe = null;
    const point = (e) => e.touches[0] || e.changedTouches[0];
    document.addEventListener('touchstart', (e) => {
        swipe = null;
        if (e.touches.length !== 1 || !matchMedia('(max-width: 600px)').matches) return;
        const row = e.target.closest('.tracks .track[data-id]');
        if (!row || !S.byId.has(row.dataset.id) || row.classList.contains('settling') || e.target.closest('.drag-handle')) return;
        const { clientX: x, clientY: y } = point(e);
        if (x > innerWidth - 24) return;
        swipe = { row, id: row.dataset.id, liking: !S.liked.has(row.dataset.id), x, y, swiping: false, armed: false, panel: null };
    }, { passive: true });
    // Not passive: preventDefault() is what keeps Safari from taking the gesture over
    document.addEventListener('touchmove', (e) => {
        if (!swipe) return;
        if (e.touches.length !== 1) return finish(false);   // a second finger: pinch, not a swipe
        const { row } = swipe, { clientX, clientY } = point(e);
        const dx = clientX - swipe.x, dy = clientY - swipe.y;
        if (!swipe.swiping) {
            if (dx > 10 || Math.abs(dy) > 10) { swipe = null; return; }      // rightwards or a scroll: not ours
            if (dx > -10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;       // not decided yet
            swipe.swiping = true;
            swipe.panel = document.createElement('span');
            swipe.panel.className = `swipe-panel ${swipe.liking ? 'like' : 'unlike'}`;
            swipe.panel.innerHTML = icon('heart', 22).s;
            row.append(swipe.panel);
            row.classList.add('swiping');
        }
        if (e.cancelable) e.preventDefault();
        const pull = Math.max(0, -dx);
        const shown = pull <= SWIPE_LIKE ? pull : SWIPE_LIKE + (pull - SWIPE_LIKE) * 0.35; // past it: rubber band
        row.style.setProperty('--swipe', `${-shown}px`);
        row.style.setProperty('--swipe-p', Math.min(1, pull / SWIPE_LIKE));
        if (swipe.armed !== pull >= SWIPE_LIKE) {
            swipe.armed = !swipe.armed;
            swipe.panel.classList.toggle('armed', swipe.armed);
            swipe.panel.innerHTML = icon(swipe.armed === swipe.liking ? 'heartFilled' : 'heart', 22).s; // armed shows the result
            if (swipe.armed) navigator.vibrate?.(8);                                                     // a tick on Android
        }
    }, { passive: false });
    document.addEventListener('touchend', () => finish(true));
    document.addEventListener('touchcancel', () => finish(false));

    function finish(released) {
        const current = swipe;
        swipe = null;
        if (!current?.swiping) return;
        const { row, id, liking, panel } = current;
        // The lifted finger can still count as a tap on the row, which would play the song
        const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
        const commit = released && current.armed;
        if (commit) {
            panel.classList.add('pop');
            toggleLike(id); // redraws the row's ♥ at once
            if (liking) row.querySelector('.like-btn')?.classList.add('pop');
        }
        const settle = (px, then, ms) => {
            row.classList.add('settling');
            row.style.setProperty('--swipe', `${px}px`);
            setTimeout(then, ms);
        };
        const done = () => {
            row.classList.remove('swiping', 'settling');
            row.style.removeProperty('--swipe');
            row.style.removeProperty('--swipe-p');
            panel.remove();
        };
        const back = () => { row.style.setProperty('--swipe-p', 0); settle(0, done, 340); };
        if (commit) settle(-SWIPE_LIKE, back, 300); // hold open while the heart pops, then spring back
        else back();
    }
}

// ---------- adding files ----------

const AUDIO_EXT = ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.opus', '.aac'];
const isAudioFile = (f) => AUDIO_EXT.some((ext) => f.name.toLowerCase().endsWith(ext));
const fmtSize = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;

// One file as the raw request body; XHR (not fetch) because fetch can't report upload progress
function uploadFile(file, album, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const query = new URLSearchParams({ name: file.name, ...(album ? { album } : {}) });
        xhr.open('POST', `/api/import?${query}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
            if (xhr.status < 300) resolve(data); else reject(new Error(data.detail || `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('The upload stopped. Is spotDLr still running?'));
        xhr.send(file);
    });
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that image"));
    reader.readAsDataURL(file);
});

function addFilesDialog(initialFiles) {
    let files = initialFiles.filter(isAudioFile);
    const skippedAtStart = initialFiles.length - files.length;
    let cover = null;
    const lists = editablePlaylists();
    openModal({
        title: 'Add music files',
        wide: true,
        body: html`<form id="addFilesForm" class="dialog-form">
            <label class="drop-zone" id="dropZone">
                <input type="file" id="fileInput" multiple accept="${AUDIO_EXT.join(',')},audio/*" class="sr-only">
                ${icon('upload', 28)}<strong>Drop music files here, or click to choose</strong>
                <span>MP3, M4A, FLAC, WAV, OGG or Opus. They're copied into your spotDLr music folder.</span>
            </label>
            <ul class="file-list" id="fileList"></ul>
            <p class="dialog-note" id="skippedNote" ${skippedAtStart ? '' : 'hidden'}>${skippedAtStart ? `${plural(skippedAtStart, 'file')} skipped: not music.` : ''}</p>
            <fieldset class="choice-group">
                <legend>Add them as</legend>
                <label class="choice"><input type="radio" name="addAs" value="library" checked><span><strong>Songs in your library</strong><small>Keeps each file's own title, artist and album.</small></span></label>
                <label class="choice"><input type="radio" name="addAs" value="album"><span><strong>A new album</strong><small>Writes the album name, artist, year and cover into the files, so every music player groups them.</small></span></label>
                <label class="choice ${lists.length ? '' : 'disabled'}"><input type="radio" name="addAs" value="playlist" ${lists.length ? '' : 'disabled'}><span><strong>Songs in a playlist</strong><small>${lists.length ? 'Adds them to your library and to a playlist you made.' : 'Make a playlist first: + next to Your Library.'}</small></span></label>
            </fieldset>
            <div class="album-fields" id="albumFields" hidden>
                <div class="cover-pick">
                    <label class="cover-box" id="coverBox" title="Choose a cover image">${icon('note', 32)}<input type="file" id="coverInput" accept="image/jpeg,image/png" class="sr-only"><span class="sr-only">Cover image</span></label>
                    <small>Cover (JPEG or PNG)</small>
                </div>
                <div class="album-text">
                    <label class="field"><span>Album name</span><input class="field-input plain" id="albumName" maxlength="200"></label>
                    <label class="field"><span>Artist</span><input class="field-input plain" id="albumArtist" maxlength="200"></label>
                    <label class="field short"><span>Year</span><input class="field-input plain" id="albumYear" inputmode="numeric" maxlength="4" placeholder="2026"></label>
                </div>
            </div>
            <label class="field" id="playlistPick" hidden><span>Playlist</span>
                <select id="playlistSelect">${lists.map((c) => html`<option value="${c.key}">${c.name}</option>`)}</select></label>
            <div class="upload-progress" id="uploadProgress" hidden><div class="progress-bar"><i></i></div><p id="uploadStatus"></p></div>
            <p class="form-error" id="addError" hidden></p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close>Cancel</button><button type="submit" class="pill-btn primary" id="addSubmit">Add</button></div>
        </form>`,
        onOpen: (modal, close) => {
            const list = $('#fileList', modal), submit = $('#addSubmit', modal), err = $('#addError', modal);
            const showFiles = () => {
                list.innerHTML = html`${files.map((f, i) => html`<li><span class="file-name">${f.name}</span><span class="file-size">${fmtSize(f.size)}</span><button type="button" class="icon-btn" data-remove-file="${i}" aria-label="Remove ${f.name}">${icon('close', 14)}</button></li>`)}`.s;
                submit.textContent = files.length ? `Add ${plural(files.length, 'song')}` : 'Add';
                submit.disabled = !files.length;
            };
            const addFiles = (picked) => {
                const good = [...picked].filter(isAudioFile);
                const skipped = picked.length - good.length;
                const note = $('#skippedNote', modal);
                note.hidden = !skipped;
                note.textContent = skipped ? `${plural(skipped, 'file')} skipped: not music.` : '';
                files = files.concat(good.filter((f) => !files.some((x) => x.name === f.name && x.size === f.size)));
                showFiles();
            };
            showFiles();
            $('#fileInput', modal).addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
            const zone = $('#dropZone', modal);
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('over'));
            zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); addFiles(e.dataTransfer.files); });
            list.addEventListener('click', (e) => { const b = e.target.closest('[data-remove-file]'); if (b) { files.splice(+b.dataset.removeFile, 1); showFiles(); } });
            const mode = () => $('input[name="addAs"]:checked', modal).value;
            modal.addEventListener('change', (e) => {
                if (e.target.name !== 'addAs') return;
                $('#albumFields', modal).hidden = mode() !== 'album';
                $('#playlistPick', modal).hidden = mode() !== 'playlist';
            });
            $('#coverInput', modal).addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    cover = await readAsDataUrl(file);
                    const box = $('#coverBox', modal);
                    box.querySelector('img')?.remove();
                    box.querySelector('svg')?.remove();
                    box.insertAdjacentHTML('afterbegin', html`<img src="${cover}" alt="">`.s);
                } catch (error) { err.textContent = error.message; err.hidden = false; }
            });

            $('#addFilesForm', modal).addEventListener('submit', async (e) => {
                e.preventDefault();
                err.hidden = true;
                const how = mode();
                const album = $('#albumName', modal).value.trim(), artist = $('#albumArtist', modal).value.trim(), year = $('#albumYear', modal).value.trim();
                const playlistKey = $('#playlistSelect', modal)?.value;
                if (how === 'album' && (!album || !artist)) { err.textContent = 'An album needs a name and an artist.'; err.hidden = false; return; }
                if (how === 'album' && year && !/^\d{4}$/.test(year)) { err.textContent = 'The year should be four digits, like 2026.'; err.hidden = false; return; }
                $$('input, select, button:not([data-close])', modal).forEach((el) => { el.disabled = true; });
                const progress = $('#uploadProgress', modal), bar = $('.progress-bar i', progress), status = $('#uploadStatus', modal);
                progress.hidden = false;
                const total = files.reduce((sum, f) => sum + f.size, 0) || 1;
                let sent = 0;
                const paths = [], failed = [];
                for (const [i, file] of files.entries()) {
                    status.textContent = `Adding ${i + 1} of ${files.length}: ${file.name}`;
                    try {
                        const { path } = await uploadFile(file, how === 'album' ? album : '', (fraction) => { setProgress(bar, (sent + fraction * file.size) / total); });
                        paths.push(path);
                    } catch (error) { failed.push(`${file.name}: ${error.message}`); }
                    sent += file.size;
                    setProgress(bar, sent / total);
                }
                try {
                    if (how === 'album' && paths.length) {
                        status.textContent = 'Writing the album details into the files…';
                        await api('/import/album', { method: 'POST', body: JSON.stringify({ paths, album, artist, year: year || null, cover }) });
                    }
                    await loadLibrary();
                    if (how === 'playlist' && paths.length) {
                        const ids = paths.map((p) => S.tracks.find((t) => t.path === p)?.id).filter(Boolean);
                        await api(`/playlists/${encodeURIComponent(playlistKey)}/tracks`, { method: 'POST', body: JSON.stringify({ track_ids: ids, action: 'add' }) });
                    }
                } catch (error) { failed.push(error.message); }
                if (failed.length) {
                    status.textContent = paths.length ? `Added ${plural(paths.length, 'song')}. Some didn't work:` : 'Nothing was added:';
                    err.textContent = failed.join(' • ');
                    err.hidden = false;
                    await refreshLibrary();
                    return;
                }
                close();
                await refreshLibrary();
                toast(`Added ${plural(paths.length, 'song')}`);
                const folder = paths[0] && paths[0].includes('/') ? paths[0].split('/')[0] : null;
                location.hash = how === 'album' && folder ? `#/collection/${encodeURIComponent(folder)}`
                    : how === 'playlist' ? `#/collection/${encodeURIComponent(playlistKey)}` : '#/songs';
            });
        },
    });
}

// Drop music files anywhere in the window to add them
function bindFileDrop() {
    const overlay = $('#dropOverlay');
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    document.addEventListener('dragenter', (e) => { if (!hasFiles(e) || $('#modalRoot').children.length) return; depth++; overlay.hidden = false; });
    document.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); }); // otherwise the browser opens the file
    document.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        overlay.hidden = true;
        if (!$('#modalRoot').children.length) addFilesDialog([...e.dataTransfer.files]);
    });
}

// ---------- send to device ----------

function downloadZip(trackIds, name) {
    toast(`Zipping ${plural(trackIds.length, 'song')}…`);
    fetch('/api/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: trackIds, name }) })
        .then(async (response) => {
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || `ZIP failed (${response.status})`);
            }
            return response.blob();
        })
        .then((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${name}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
            toast('ZIP downloading — save it straight onto the USB stick.');
        })
        .catch((error) => toast(error.message, 'error'));
}

async function cacheForOffline(trackIds, name) {
    // Pre-loads the playlist onto this device for offline play, with cancel,
    // per-playlist status, and a clear button. Needs an active service worker.
    const tracks = trackIds.map((id) => S.byId.get(id)).filter(Boolean);
    if (!tracks.length) return;
    if (!navigator.serviceWorker?.controller) {
        toast('Offline mode is still activating — reload the page once, then retry.', 'error');
        return;
    }
    const musicCache = async () => {
        const keys = await caches.keys();
        const found = keys.find((k) => k === 'spotdlr-music' || /^spotdlr-phone-v\d+-music$/.test(k));
        return found ? caches.open(found) : null;
    };
    const streamUrl = (t) => `/api/stream/${encodeURIComponent(t.id)}`;
    let cancelled = false;
    openModal({
        title: `Offline: ${name}`,
        body: html`<p class="dialog-note" id="offSummary">Checking what's already saved…</p>
            <div class="upload-progress"><div class="progress-bar"><i style="width:0%"></i></div>
            <p id="offlineStatus"></p></div>
            <div class="modal-actions"><button type="button" class="pill-btn primary" id="offGo">Download missing</button><button type="button" class="pill-btn" id="offClear">Remove offline copies</button><button type="button" class="pill-btn" data-close id="offClose">Close</button></div>`,
        onOpen: (modal) => {
            const summary = $('#offSummary', modal), bar = $('.progress-bar i', modal),
                status = $('#offlineStatus', modal), go = $('#offGo', modal),
                clear = $('#offClear', modal), close = $('#offClose', modal);
            let cached = new Set();
            const paint = async () => {
                cached = new Set();
                const cache = await musicCache();
                if (cache) {
                    await Promise.all(tracks.map(async (t) => {
                        try { if (await cache.match(streamUrl(t))) cached.add(t.id); } catch { /* ignore */ }
                    }));
                }
                summary.textContent = cached.size === tracks.length ? `All ${plural(tracks.length, 'song')} saved on this device.` :
                    cached.size ? `${cached.size} of ${tracks.length} already on this device.` :
                    `${plural(tracks.length, 'song')}, none saved yet.`;
                bar.style.width = `${Math.round((cached.size / tracks.length) * 100)}%`;
                return cache;
            };
            const setBusy = (busy) => { [go, clear].forEach((b) => { b.disabled = busy; }); };
            go.addEventListener('click', async () => {
                cancelled = false;
                setBusy(true);
                go.textContent = 'Cancel';
                go.disabled = false;
                const controller = new AbortController();
                go.onclick = () => { cancelled = true; controller.abort(); };
                let done = 0, failed = 0, next = 0;
                const missing = tracks.filter((t) => !cached.has(t.id));
                const worker = async () => {
                    while (!cancelled) {
                        const i = next++;
                        if (i >= missing.length) return;
                        const t = missing[i];
                        try {
                            const r = await fetch(streamUrl(t), { signal: controller.signal });
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            await r.blob();
                        } catch { if (!cancelled) failed++; }
                        done++;
                        status.textContent = `Saving ${done} of ${missing.length}…`;
                        bar.style.width = `${Math.round(((cached.size + done) / tracks.length) * 100)}%`;
                    }
                };
                await Promise.all([worker(), worker(), worker()]);
                await paint();
                status.textContent = cancelled ? `Stopped after ${done} of ${missing.length}.` :
                    failed ? `Done with ${failed} failed.` : `Done: ${plural(tracks.length, 'song')} ready offline.`;
                toast(cancelled ? 'Offline download cancelled.' : failed ? `Offline cache: ${failed} failed.` : `${plural(tracks.length, 'song')} ready offline.`, (cancelled || failed) ? 'error' : '');
                go.textContent = 'Download missing';
                go.onclick = null;
                setBusy(false);
            });
            clear.addEventListener('click', async () => {
                setBusy(true);
                status.textContent = 'Removing…';
                try {
                    const cache = await musicCache();
                    if (cache) await Promise.all(tracks.map((t) => cache.delete(streamUrl(t)).catch(() => false)));
                } catch { /* ignore */ }
                await paint();
                status.textContent = 'Offline copies removed.';
                setBusy(false);
            });
            close.addEventListener('click', () => { cancelled = true; });
            paint();
        },
    });
}
async function saveToFolder(trackIds, name) {    // Writes MP3s straight into a folder the user picks (e.g. a USB stick).
    // Needs a secure context (localhost or HTTPS); otherwise the menu item is hidden.
    const tracks = trackIds.map((id) => S.byId.get(id)).filter((t) => t && t.path);
    if (!tracks.length) { toast('Nothing saved yet — download the songs first.', 'error'); return; }
    let dir;
    try {
        dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch { return; } // picker cancelled
    const clean = (name || 'spotDLr').replace(/[\\/:*?"<>|]/g, '').trim() || 'spotDLr';
    let sub = dir;
    try { sub = await dir.getDirectoryHandle(clean, { create: true }); } catch { /* use picked dir */ }
    let done = 0, failed = 0;
    const total = tracks.length;
    openModal({
        title: `Saving to ${clean}`,
        body: html`<div class="upload-progress"><div class="progress-bar"><i style="width:0%"></i></div>
            <p id="folderSaveStatus">Starting…</p></div>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close>Close</button></div>`,
    });
    const bar = $('.progress-bar i'), status = $('#folderSaveStatus');
    for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const file = `${String(i + 1).padStart(2, '0')} - ${t.path.split('/').pop()}`;
        try {
            const response = await fetch(`/api/stream/${encodeURIComponent(t.id)}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const handle = await sub.getFileHandle(file, { create: true });
            const writable = await handle.createWritable();
            await response.body.pipeTo(writable);
        } catch { failed++; }
        done++;
        if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
        if (status) status.textContent = failed ? `${done} of ${total} (${failed} failed)…` : `${done} of ${total}…`;
    }
    if (bar) bar.style.width = '100%';
    if (status) status.textContent = failed ? `Done with ${failed} failed.` : `Done: ${plural(total, 'song')} saved. Eject the device before unplugging it.`;
    toast(failed ? `Saved with ${failed} failed.` : `Saved ${plural(total, 'song')}.`, failed ? 'error' : '');
}

function sendToDeviceDialog(trackIds, label, collection) {
    const tracks = trackIds.map((id) => S.byId.get(id)).filter(Boolean);
    const allMp3 = tracks.every((t) => t.path.toLowerCase().endsWith('.mp3'));
    const prefs = { folder: 'Music', format: allMp3 ? 'original' : 'mp3', bitrate: 256, ...store.get('sendPrefs', {}) };
    const estimate = (format, bitrate) => tracks.reduce((sum, t) =>
        sum + (format === 'mp3' && !t.path.toLowerCase().endsWith('.mp3') ? bitrate * 1000 / 8 * t.duration : t.size), 0);
    const isWindows = /Win/.test(navigator.platform || navigator.userAgent);
    openModal({
        title: 'Send to device',
        wide: true,
        body: html`<form id="sendForm" class="dialog-form">
            <p class="dialog-note">${trackIds.length === 1 ? label : html`<strong>${label}</strong>, ${plural(tracks.length, 'song')}`}. Plug in your MP3 player or USB drive, then pick it.</p>
            <fieldset class="choice-group"><legend>Device <button type="button" class="link-btn" id="refreshDevices">Refresh</button></legend>
                <div id="deviceList"><p class="dialog-note">Looking for devices…</p></div>
                <label class="choice"><input type="radio" name="device" value="other"><span><strong>Somewhere else</strong><small>Type a folder, for a player that doesn't show up above</small></span></label>
                <input class="field-input" id="otherPath" aria-label="Folder path" placeholder="${isWindows ? 'E:\\' : '/Volumes/MY PLAYER'}" hidden>
            </fieldset>
            <label class="field"><span>Folder on the device</span><input class="field-input plain" id="sendFolder" value="${prefs.folder}" maxlength="80"></label>
            <fieldset class="choice-group"><legend>Format</legend>
                <label class="choice"><input type="radio" name="format" value="mp3" ${prefs.format === 'mp3' ? 'checked' : ''}><span><strong>Convert to MP3</strong><small>Plays on any MP3 player. spotDLr downloads .m4a, which many players can't play.</small></span></label>
                <label class="choice"><input type="radio" name="format" value="original" ${prefs.format === 'original' ? 'checked' : ''}><span><strong>Keep the original files</strong><small>Best quality, for players and phones that play .m4a (AAC).</small></span></label>
                <label class="field short" id="bitrateField"><span>MP3 quality</span><select id="sendBitrate">${[128, 192, 256, 320].map((b) => html`<option value="${b}" ${b === prefs.bitrate ? 'selected' : ''}>${b} kbps${b === 256 ? ' (recommended)' : b === 128 ? ' (smallest)' : ''}</option>`)}</select></label>
            </fieldset>
            <p class="dialog-note" id="sendEstimate"></p>
            <div class="upload-progress" id="sendProgress" hidden><div class="progress-bar"><i></i></div><p id="sendStatus"></p></div>
            <p class="form-error" id="sendError" hidden></p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close id="sendCancel">Cancel</button><button type="submit" class="pill-btn primary" id="sendSubmit">Send</button></div>
        </form>`,
        onOpen: (modal) => {
            const err = $('#sendError', modal), submit = $('#sendSubmit', modal);
            let devices = [];
            const format = () => $('input[name="format"]:checked', modal).value;
            const chosenDevice = () => $('input[name="device"]:checked', modal)?.value;
            const showEstimate = () => {
                $('#bitrateField', modal).hidden = format() !== 'mp3';
                const need = estimate(format(), +$('#sendBitrate', modal).value);
                const d = devices.find((x) => x.path === chosenDevice());
                $('#sendEstimate', modal).textContent = `About ${fmtSize(need)} to copy${d ? `, with ${fmtSize(d.free)} free on ${d.name}` : ''}.${d && need > d.free ? ' That won\'t fit.' : ''}`;
                $('#sendEstimate', modal).classList.toggle('warn', !!d && need > d.free);
            };
            const loadDevices = async () => {
                $('#deviceList', modal).innerHTML = html`<p class="dialog-note">Looking for devices…</p>`.s;
                try { devices = (await api('/devices')).devices; } catch { devices = []; }
                const last = store.get('sendDevice', null);
                const preferred = devices.some((d) => d.path === last) ? last : devices[0]?.path;
                $('#deviceList', modal).innerHTML = devices.length
                    ? html`${devices.map((d) => html`<label class="choice"><input type="radio" name="device" value="${d.path}" ${d.path === preferred ? 'checked' : ''}><span><strong>${icon('usb', 16)} ${d.name}</strong><small>${fmtSize(d.free)} free of ${fmtSize(d.total)} • ${d.path}</small></span></label>`)}`.s
                    : html`<p class="dialog-note">No MP3 player or USB drive found. Plug one in and click Refresh. Players that connect like a phone (not as a drive) won't show up.</p>`.s;
                if (!devices.length) $('input[name="device"][value="other"]', modal).checked = true;
                $('#otherPath', modal).hidden = chosenDevice() !== 'other';
                showEstimate();
            };
            loadDevices();
            $('#refreshDevices', modal).addEventListener('click', loadDevices);
            modal.addEventListener('change', (e) => {
                if (e.target.name === 'device') $('#otherPath', modal).hidden = e.target.value !== 'other';
                showEstimate();
            });

            $('#sendForm', modal).addEventListener('submit', async (e) => {
                e.preventDefault();
                err.hidden = true;
                const picked = chosenDevice();
                const device = picked === 'other' ? $('#otherPath', modal).value.trim() : picked;
                if (!device) { err.textContent = 'Pick a device, or type a folder.'; err.hidden = false; return; }
                const body = { track_ids: tracks.map((t) => t.id), device, subfolder: $('#sendFolder', modal).value.trim(), collection,
                    format: format(), bitrate: +$('#sendBitrate', modal).value };
                store.set('sendPrefs', { folder: body.subfolder, format: body.format, bitrate: body.bitrate });
                if (picked !== 'other') store.set('sendDevice', device);
                let job;
                try { job = await api('/export', { method: 'POST', body: JSON.stringify(body) }); }
                catch (error) { err.textContent = error.message; err.hidden = false; return; }
                const name = devices.find((d) => d.path === device)?.name || device;
                submit.disabled = true;
                $$('fieldset, .field input, .field select', modal).forEach((el) => { el.disabled = true; });
                $('#sendCancel', modal).textContent = 'Hide';
                const progress = $('#sendProgress', modal), bar = $('.progress-bar i', progress), status = $('#sendStatus', modal);
                progress.hidden = false;
                while (job.status === 'copying') {
                    setProgress(bar, job.done / job.total);
                    status.textContent = job.current ? `${body.format === 'mp3' ? 'Converting and copying' : 'Copying'} ${job.done + 1} of ${job.total}: ${job.current}` : `Copying ${job.done} of ${job.total}`;
                    await new Promise((r) => setTimeout(r, 500));
                    try { job = await api(`/export/${job.id}`); } catch { /* keep polling */ }
                }
                $('#sendCancel', modal).textContent = 'Close';
                if (job.status === 'done') {
                    setProgress(bar, 1);
                    const copied = job.total - job.skipped;
                    status.textContent = `Done: ${plural(copied, 'song')} copied to ${name}${job.skipped ? `, ${job.skipped} already there` : ''}. Eject the device before unplugging it.`;
                    toast(`Sent ${plural(copied, 'song')} to ${name}`);
                } else {
                    err.textContent = `Stopped after ${job.done} of ${job.total}: ${job.error}`;
                    err.hidden = false;
                }
            });
            showEstimate();
        },
    });
}

// ---------- add to Apple Music (Mac) ----------
// Lossless songs become Apple Lossless (checked sample-identical), AAC/MP3 go in as they are, Opus/Ogg become
// AAC 256. Songs already in Apple Music are skipped. Playlists can get a matching playlist in Apple Music.

function appleMusicDialog(trackIds, label, collection, isPlaylist) {
    const tracks = trackIds.map((id) => S.byId.get(id)).filter(Boolean);
    const ext = (t) => t.path.slice(t.path.lastIndexOf('.')).toLowerCase();
    const lossless = tracks.filter((t) => ['.flac', '.wav', '.aif', '.aiff'].includes(ext(t))).length;
    const reencode = tracks.filter((t) => ['.opus', '.ogg'].includes(ext(t))).length;
    const asIs = tracks.length - lossless - reencode;
    const lines = [
        lossless && html`<li><strong>${plural(lossless, 'lossless song')}</strong> → Apple Lossless, checked sample for sample against the original</li>`,
        asIs && html`<li><strong>${plural(asIs, 'song')}</strong> already in a format Apple Music plays (AAC or MP3): added as they are</li>`,
        reencode && html`<li><strong>${plural(reencode, 'Opus/Ogg song')}</strong> → AAC 256 kbps (Apple Music can't play Opus)</li>`,
    ].filter(Boolean);
    openModal({
        title: 'Add to Apple Music',
        body: html`<form id="appleForm" class="dialog-form">
            <p class="dialog-note">${trackIds.length === 1 ? label : html`<strong>${label}</strong>, ${plural(tracks.length, 'song')}`}. Songs already in Apple Music are skipped.</p>
            <ul class="apple-plan">${lines}</ul>
            ${isPlaylist ? html`<label class="check"><input type="checkbox" id="applePlaylist" checked> Also make a playlist called “${collection}” in Apple Music</label>` : ''}
            <p class="dialog-note small">The Music app keeps its own copy, so spotDLr's files stay as they are. With Sync Library on, Apple may match these songs to its catalog on your other devices.</p>
            <div class="upload-progress" id="appleProgress" hidden><div class="progress-bar"><i></i></div><p id="appleStatus"></p></div>
            <p class="form-error" id="appleError" hidden></p>
            <div class="modal-actions"><button type="button" class="pill-btn" data-close id="appleCancel">Cancel</button><button type="submit" class="pill-btn primary" id="appleSubmit">Add</button></div>
        </form>`,
        onOpen: (modal) => {
            const err = $('#appleError', modal);
            $('#appleForm', modal).addEventListener('submit', async (e) => {
                e.preventDefault();
                err.hidden = true;
                const makePlaylist = !!$('#applePlaylist', modal)?.checked;
                let job;
                try { job = await api('/apple-music', { method: 'POST', body: JSON.stringify({ track_ids: tracks.map((t) => t.id), collection, make_playlist: makePlaylist }) }); }
                catch (error) { err.textContent = error.message; err.hidden = false; return; }
                $('#appleSubmit', modal).disabled = true;
                const check = $('#applePlaylist', modal);
                if (check) check.disabled = true;
                $('#appleCancel', modal).textContent = 'Hide';
                const progress = $('#appleProgress', modal), bar = $('.progress-bar i', progress), status = $('#appleStatus', modal);
                progress.hidden = false;
                while (job.status === 'working') {
                    setProgress(bar, job.done / job.total);
                    status.textContent = job.step || '';
                    await new Promise((r) => setTimeout(r, 500));
                    try { job = await api(`/apple-music/${job.id}`); } catch { /* keep polling */ }
                }
                $('#appleCancel', modal).textContent = 'Close';
                if (job.status === 'done') {
                    setProgress(bar, 1);
                    const parts = [`Added ${plural(job.added, 'song')} to Apple Music`];
                    if (job.verified) parts.push(`${job.verified} as Apple Lossless, every sample checked`);
                    if (job.skipped) parts.push(`${job.skipped} already there`);
                    status.textContent = `${parts.join('; ')}.${job.playlist ? ` Playlist: “${job.playlist}”.` : ''}`;
                    toast(job.added ? `Added ${plural(job.added, 'song')} to Apple Music` : 'Already in Apple Music');
                } else {
                    err.textContent = job.error;
                    err.hidden = false;
                }
            });
        },
    });
}

// ---------- blind listening test (ABX) ----------
// A = the original clip, B = the same clip compressed, X = secretly one of them, a new pick every trial.
// All three are decoded into memory and played with Web Audio, so switching is instant and sample-exact:
// the new clip starts at the same position the old one stopped, with the same 5 ms fade every time.
// Anything that differed between A and B except the sound (a gap, a click, a delay) would be a giveaway.

const ABX_CODECS = [['aac', 'AAC'], ['mp3', 'MP3'], ['opus', 'Opus']];
const ABX_BITRATES = [64, 96, 128, 160, 192, 256, 320];
const AB = { ctx: null, buffers: {}, playing: null, source: null, gain: null, offset: 0, startedAt: 0, session: null, trial: 0, raf: 0, keys: null };

function abxPosition() {
    const len = AB.buffers.A ? AB.buffers.A.duration : 1;
    if (!AB.playing) return AB.offset;
    return (AB.offset + AB.ctx.currentTime - AB.startedAt) % len;
}

function abxStopSource(fade = true) {
    if (!AB.source) return;
    const { source, gain } = AB;
    const t = AB.ctx.currentTime;
    if (fade) { gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + 0.005); source.stop(t + 0.006); }
    else source.stop();
    AB.source = null;
}

function abxPlay(which) {
    const buffer = AB.buffers[which];
    if (!buffer) return;
    const position = abxPosition();
    abxStopSource();
    const source = AB.ctx.createBufferSource();
    const gain = AB.ctx.createGain();
    source.buffer = buffer;
    source.loop = true; // the clip repeats until you answer
    source.connect(gain).connect(AB.ctx.destination);
    const t = AB.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.005);
    source.start(t, position);
    Object.assign(AB, { source, gain, offset: position, startedAt: t, playing: which });
    abxUpdatePlayer();
}

function abxPause() {
    AB.offset = abxPosition();
    abxStopSource();
    AB.playing = null;
    abxUpdatePlayer();
}

function abxSeek(fraction) {
    const which = AB.playing;
    AB.offset = Math.max(0, Math.min(0.999, fraction)) * AB.buffers.A.duration;
    AB.startedAt = AB.ctx.currentTime;
    if (which) { AB.playing = null; abxStopSource(); abxPlay(which); } else abxUpdatePlayer();
}

function abxUpdatePlayer() {
    $$('#abxRoot [data-abx-listen]').forEach((btn) => {
        const on = AB.playing === btn.dataset.abxListen;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
    });
    const toggle = $('#abxToggle');
    if (toggle) { toggle.innerHTML = icon(AB.playing ? 'pause' : 'play', 18).s; toggle.setAttribute('aria-label', AB.playing ? 'Pause' : 'Play'); }
}

function abxTick() {
    const bar = $('#abxBar i');
    if (!bar || !AB.buffers.A) { AB.raf = 0; return; }
    setProgress(bar, abxPosition() / AB.buffers.A.duration);
    $('#abxTime').textContent = `${fmtTime(abxPosition())} / ${fmtTime(AB.buffers.A.duration)}`;
    AB.raf = requestAnimationFrame(abxTick);
}

async function abxLoad(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Couldn't load a clip (${response.status})`);
    return AB.ctx.decodeAudioData(await response.arrayBuffer());
}

function stopAbx() {
    abxStopSource(false);
    cancelAnimationFrame(AB.raf);
    if (AB.keys) document.removeEventListener('keydown', AB.keys, true);
    Object.assign(AB, { buffers: {}, playing: null, offset: 0, session: null, trial: 0, raf: 0, keys: null });
}

function viewAbx(trackId) {
    const t = S.byId.get(trackId);
    if (!t) return html`<div class="empty"><h2>Song not found</h2><p>It isn't in your library anymore.</p></div>`;
    return html`<div class="view-pad abx" id="abxRoot" data-track="${t.id}">
        <header class="abx-head">${trackArt(t, 'abx-art')}<div>
            <div class="hero-kind">Blind listening test</div>
            <h1 class="abx-title">${t.title}</h1>
            <p class="abx-sub">${t.artists.join(', ')}</p>
        </div></header>
        <div id="abxBody"></div>
    </div>`;
}

async function mountAbx(trackId) {
    stopAbx();
    const t = S.byId.get(trackId);
    const body = $('#abxBody');
    if (!t || !body) return;
    if (!P.audio.paused) P.audio.pause(); // the test needs your ears to itself
    const source = await api(`/abx/source/${encodeURIComponent(trackId)}`).catch(() => null);
    if (!body.isConnected) return; // a newer render replaced the page while we waited (hashchange + popstate both render)
    const prefs = { codec: 'aac', bitrate: 256, trials: 10, ...store.get('abxPrefs', {}) };
    const startDefault = Math.min(60, Math.max(0, Math.floor(t.duration * 0.3)));
    body.innerHTML = html`
        <section class="abx-card">
            <p class="abx-lede">Can you hear what compression does to this song? You'll hear <strong>A</strong> (the original), <strong>B</strong> (a compressed copy) and <strong>X</strong>, which is secretly one of them. Say which. After ${prefs.trials} rounds you'll see how likely your score is from guessing alone.</p>
            ${source ? (source.lossless
                ? html`<p class="abx-source ok">${icon('check', 16)} The original is lossless (${source.codec}), so A is the real thing.</p>`
                : html`<p class="abx-source warn">${icon('warn', 16)} This song is already compressed (${source.codec}${source.bitrate_kbps ? `, ${source.bitrate_kbps} kbps` : ''}), so A isn't a lossless original: you'd be comparing compressed with more compressed. For the real test, add a FLAC or WAV of a song with <strong>+ → Add music files</strong>.</p>`) : ''}
            <form id="abxForm" class="abx-form">
                <label class="field"><span>Compress B as</span><select id="abxCodec">${ABX_CODECS.map(([v, l]) => html`<option value="${v}" ${v === prefs.codec ? 'selected' : ''}>${l}</option>`)}</select></label>
                <label class="field"><span>Bitrate</span><select id="abxBitrate">${ABX_BITRATES.map((b) => html`<option value="${b}" ${b === prefs.bitrate ? 'selected' : ''}>${b} kbps</option>`)}</select></label>
                <label class="field"><span>Clip starts at</span><input class="field-input plain" id="abxStart" value="${fmtTime(startDefault)}" inputmode="numeric" aria-describedby="abxStartHelp"><small id="abxStartHelp">m:ss — 30 seconds from here. Pick a busy part: cymbals, vocals, applause.</small></label>
                <label class="field"><span>Rounds</span><select id="abxTrials">${[10, 16, 20].map((n) => html`<option value="${n}" ${n === prefs.trials ? 'selected' : ''}>${n}</option>`)}</select></label>
                <p class="form-error" id="abxError" hidden></p>
                <div class="abx-actions"><button type="submit" class="pill-btn primary" id="abxStartBtn">Start the test</button><span class="field-note">Use headphones in a quiet room.</span></div>
            </form>
        </section>`.s;
    $('#abxForm', body).addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#abxError');
        err.hidden = true;
        const m = /^(\d+):(\d{1,2})$|^(\d+)$/.exec($('#abxStart').value.trim());
        if (!m) { err.textContent = 'Write the start like 1:05.'; err.hidden = false; return; }
        const start = m[3] !== undefined ? +m[3] : +m[1] * 60 + +m[2];
        const settings = { codec: $('#abxCodec').value, bitrate: +$('#abxBitrate').value, trials: +$('#abxTrials').value };
        store.set('abxPrefs', settings);
        const btn = $('#abxStartBtn');
        btn.disabled = true;
        btn.textContent = 'Preparing the clips…';
        try {
            const session = await api('/abx', { method: 'POST', body: JSON.stringify({ track_id: trackId, start, length: 30, ...settings }) });
            AB.ctx = AB.ctx || new (window.AudioContext || window.webkitAudioContext)();
            if (AB.ctx.state === 'suspended') await AB.ctx.resume();
            const [a, b] = await Promise.all([abxLoad(`/api/abx/${session.id}/clip/a`), abxLoad(`/api/abx/${session.id}/clip/b`)]);
            AB.buffers = { A: a, B: b };
            AB.session = session;
            AB.trial = 0;
            await abxTrial();
        } catch (error) {
            err.textContent = error.message;
            err.hidden = false;
            btn.disabled = false;
            btn.textContent = 'Start the test';
        }
    });
}

async function abxTrial() {
    const s = AB.session, body = $('#abxBody');
    if (!body) return;
    const wasPlaying = AB.playing ? (AB.playing === 'X' ? 'X' : AB.playing) : null;
    abxStopSource();
    AB.playing = null;
    AB.buffers.X = await abxLoad(s.x_urls[AB.trial]);
    body.innerHTML = html`
        <section class="abx-card abx-test">
            <div class="abx-progress"><span>Round ${AB.trial + 1} of ${s.trials}</span><span>${s.codec} ${s.bitrate} kbps • ${fmtTime(s.start)}–${fmtTime(s.start + s.length)}</span></div>
            <div class="abx-dots" aria-hidden="true">${Array.from({ length: s.trials }, (_, i) => html`<i class="${i < AB.trial ? 'done' : i === AB.trial ? 'now' : ''}"></i>`)}</div>
            <div class="abx-listen" role="group" aria-label="Listen">
                <button type="button" class="abx-key" data-abx-listen="A" aria-pressed="false"><b>A</b><small>original</small></button>
                <button type="button" class="abx-key" data-abx-listen="B" aria-pressed="false"><b>B</b><small>compressed</small></button>
                <button type="button" class="abx-key x" data-abx-listen="X" aria-pressed="false"><b>X</b><small>which is it?</small></button>
            </div>
            <div class="abx-player">
                <button type="button" class="play-btn" id="abxToggle" aria-label="Play">${icon('play', 18)}</button>
                <div class="abx-bar" id="abxBar" role="slider" aria-label="Position in the clip" tabindex="0" aria-valuemin="0" aria-valuemax="100"><i></i></div>
                <span class="abx-time" id="abxTime">0:00 / 0:30</span>
            </div>
            <div class="abx-answer">
                <span>X is…</span>
                <button type="button" class="pill-btn" data-abx-guess="A">A</button>
                <button type="button" class="pill-btn" data-abx-guess="B">B</button>
            </div>
            <p class="abx-hint">Keys: <kbd>A</kbd> <kbd>B</kbd> <kbd>X</kbd> to listen, <kbd>Space</kbd> to pause, <kbd>1</kbd> or <kbd>2</kbd> to answer A or B. Switching keeps your place in the clip.</p>
        </section>`.s;
    const root = $('#abxRoot');
    root.onclick = async (e) => {
        const listen = e.target.closest('[data-abx-listen]');
        if (listen) { AB.playing === listen.dataset.abxListen ? abxPause() : abxPlay(listen.dataset.abxListen); return; }
        if (e.target.closest('#abxToggle')) { AB.playing ? abxPause() : abxPlay('A'); return; }
        const guess = e.target.closest('[data-abx-guess]');
        if (guess) await abxAnswer(guess.dataset.abxGuess);
    };
    const bar = $('#abxBar');
    bar.onpointerdown = (e) => { const r = bar.getBoundingClientRect(); abxSeek((e.clientX - r.left) / r.width); };
    bar.onkeydown = (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        abxSeek((abxPosition() + (e.key === 'ArrowRight' ? 2 : -2)) / AB.buffers.A.duration);
    };
    if (!AB.keys) {
        // Capture phase: these keys belong to the test, not to the main player's shortcuts
        AB.keys = (e) => {
            if (!$('#abxRoot') || !AB.session || e.metaKey || e.ctrlKey || e.target.closest?.('input, select, textarea')) return;
            const k = e.key.toLowerCase();
            const act = { a: () => abxPlay('A'), b: () => abxPlay('B'), x: () => abxPlay('X'), ' ': () => (AB.playing ? abxPause() : abxPlay('A')),
                1: () => abxAnswer('A'), 2: () => abxAnswer('B') }[k];
            if (!act || !$('.abx-test')) return;
            e.preventDefault();
            e.stopPropagation();
            act();
        };
        document.addEventListener('keydown', AB.keys, true);
    }
    abxUpdatePlayer();
    if (!AB.raf) AB.raf = requestAnimationFrame(abxTick);
    if (wasPlaying) abxPlay(wasPlaying === 'X' ? 'X' : wasPlaying); // carry on listening into the next round
}

async function abxAnswer(guess) {
    if (AB.busy) return;
    AB.busy = true;
    try {
        const s = await api(`/abx/${AB.session.id}/answer`, { method: 'POST', body: JSON.stringify({ trial: AB.trial, guess }) });
        AB.session = { ...AB.session, ...s };
        AB.trial += 1;
        if (s.result) abxResults(s); else await abxTrial();
    } catch (error) { toast(error.message, 'error'); }
    finally { AB.busy = false; }
}

function abxResults(s) {
    abxStopSource();
    AB.playing = null;
    cancelAnimationFrame(AB.raf);
    AB.raf = 0;
    const { correct, p_value: p, answers, guesses } = s.result;
    const pct = p * 100;
    const odds = pct < 0.1 ? 'less than 1 in 1,000' : pct < 1 ? `about 1 in ${Math.round(1 / p).toLocaleString()}` : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
    const heard = p < 0.05;
    const lower = ABX_BITRATES[Math.max(0, ABX_BITRATES.indexOf(s.bitrate) - 1)];
    $('#abxBody').innerHTML = html`
        <section class="abx-card abx-result">
            <div class="abx-score"><b>${correct}</b><span>of ${s.trials} right</span></div>
            <h2>${heard ? `You can hear ${s.codec} at ${s.bitrate} kbps.` : `No reliable difference at ${s.codec} ${s.bitrate} kbps.`}</h2>
            <p>Guessing alone gets ${correct} or more right ${pct < 1 ? html`<strong>${odds}</strong> times` : html`<strong>${odds}</strong> of the time`}. ${heard
                ? 'That\'s rare enough (under 5%) to say you really heard it.'
                : 'That\'s too common to rule out luck, so at this bitrate the compressed copy sounds the same to you.'}</p>
            <ol class="abx-rounds">${answers.map((a, i) => html`<li class="${guesses[i] === a ? 'right' : 'wrong'}"><span>Round ${i + 1}</span><span>X was ${a}</span><span>You said ${guesses[i]} ${guesses[i] === a ? '✓' : '✗'}</span></li>`)}</ol>
            <div class="abx-actions">
                <button type="button" class="pill-btn primary" id="abxAgain">Test again</button>
                ${heard ? '' : s.bitrate > ABX_BITRATES[0] ? html`<button type="button" class="pill-btn" id="abxLower">Try ${lower} kbps</button>` : ''}
            </div>
        </section>`.s;
    const restart = (bitrate) => {
        if (bitrate) store.set('abxPrefs', { ...store.get('abxPrefs', {}), bitrate });
        mountAbx($('#abxRoot').dataset.track);
    };
    $('#abxAgain').addEventListener('click', () => restart());
    $('#abxLower')?.addEventListener('click', () => restart(lower));
}

// ---------- boot ----------

// While genres are being looked up, refresh the library every 15 s so they appear as they're found
async function pollGenres() {
    let status;
    try { status = await api('/genres/status'); } catch { setTimeout(pollGenres, 30000); return; }
    const was = S.genrePending;
    S.genrePending = status.pending;
    if (was || status.pending) {
        await loadLibrary();
        if (['home', 'songs', 'genres', 'genre'].includes(route().name)) rerender();
    }
    setTimeout(pollGenres, status.pending ? 15000 : 60000);
}

// ---------- window check-in ----------
// The installed Windows app stops its server when the last window closes, and it learns that from the
// page itself: a check-in every 15 s, a goodbye on close. (Harmless when running from source.)
const WINDOW_ID = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const checkIn = () => fetch('/api/window/alive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: WINDOW_ID }) }).catch(() => {});
function bindWindowCheckIn() {
    checkIn();
    setInterval(checkIn, 15000);
    window.addEventListener('pagehide', () => navigator.sendBeacon('/api/window/bye', new Blob([JSON.stringify({ id: WINDOW_ID })], { type: 'application/json' })));
    window.addEventListener('pageshow', (e) => { if (e.persisted) checkIn(); }); // back from the back/forward cache
}

(async function boot() {
    paintChrome(); // first: paint before anything that can stall
    bindWindowCheckIn();
    // Ask to be exempt from storage eviction: a big offline music cache otherwise gives Chrome
    // permission to wipe the whole origin (worker included) under disk pressure. Never awaited —
    // a stalled prompt must not hold the app behind the launch screen.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* unsupported */ }
    bindFileDrop();
    bindImageFallback();
    bindChartTooltip();
    bindPlayer();
    bindNowView();
    bindSwipeToLike();
    bindEvents();
    try { S.init = await api('/status/init'); } catch { S.init = { initialized: false, message: 'Server not reachable' }; }
    registerPhoneCache();
    watchForUpdates(); // reload into new releases instead of rotting on stale code
    try { await loadLibrary(); } catch (err) { toast(`Couldn't load your library: ${err.message}`, 'error'); }
    const resumePage = restoreSession(S.init.on_phone && R.mode === 'listen' ? 'transferSession' : 'session');
    // Opening or reloading the app on Home (or no page, as the app window opens) shows the last playlist.
    // Reloading any other page (Stats, a search, another playlist) stays on it.
    if (resumePage && ['', '#', '#/'].includes(location.hash)) history.replaceState(null, '', resumePage);
    await render();
    pollJobs();
    pollGenres();
    remoteSyncTick();
    startScheduler(); // after the library loads: a due schedule needs its songs
})();
