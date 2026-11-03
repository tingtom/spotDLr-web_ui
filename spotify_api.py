"""
Thin Spotify Web API layer (client-credentials, so no user login).

Every response is trimmed to the fields the UI uses, and each track is marked
with `local_id` when the library already has it (matched by exact Spotify ID).

Retries are off on purpose: spotipy otherwise sleeps through 429 Retry-After
waits and retries bad credentials silently, which looks like a hang in the UI.
"""

import os
import re
import threading
import time

import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

SPOTIFY_URL = re.compile(r"(?:open\.spotify\.com/(?:intl-[a-z]+/)?|spotify:)(track|album|playlist|artist)[/:]([A-Za-z0-9]{22})")
MARKET = os.getenv("SPOTIFY_MARKET", "US")


class SpotifyError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


_client = None
_check = {"time": 0, "ok": False, "error": None}


def _get_client():
    global _client
    if _client is None:
        client_id = os.getenv("SPOTIPY_CLIENT_ID")
        client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
        if not client_id or not client_secret:
            raise SpotifyError("No Spotify app keys yet. Add them in Settings → Spotify connection.", 400)
        auth = SpotifyClientCredentials(
            client_id=client_id,
            client_secret=client_secret,
            cache_handler=spotipy.MemoryCacheHandler(),  # don't write a .cache token file
            requests_timeout=10,
        )
        _client = spotipy.Spotify(auth_manager=auth, requests_timeout=10, retries=0, status_retries=0)
    return _client


PREMIUM_MESSAGE = ("Spotify requires the account that owns this Spotify app to have Premium (a rule for all "
                   "developer apps since February 2026). Subscribe on that account, or create the app from an account "
                   "that has Premium. After subscribing it can take a few hours to start working.")


def _friendly(message):
    if "invalid_client" in message:
        return "Spotify rejected the Client ID/Secret (invalid_client). Check them in developer.spotify.com/dashboard."
    return message


def _probe(auth):
    """Token + one real search. Returns ("ok" | "premium" | "bad", message).

    A token alone proves nothing: spotDL's shared keys get a token and then 429 on every
    request, and apps whose owner lacks Premium get a token and then 403 on every request.
    """
    try:
        auth.get_access_token(as_dict=False)
    except Exception as e:
        return "bad", _friendly(str(e))
    try:
        spotipy.Spotify(auth_manager=auth, requests_timeout=10, retries=0, status_retries=0).search(q="test", type="track", limit=1)
    except spotipy.SpotifyException as e:
        if e.http_status == 403 and "premium" in str(e.msg).lower():
            return "premium", PREMIUM_MESSAGE
        if e.http_status == 429:
            return "bad", "These keys are rate-limited by Spotify right now (HTTP 429). Try again later or use a different app."
        return "bad", f"Token worked, but search failed: Spotify error {e.http_status}: {e.msg}"
    except Exception as e:
        return "bad", f"Token worked, but search failed: {e}"
    return "ok", None


def check(max_age=300, wait=True):
    """Do the configured keys actually work (token + search)? Cached for max_age seconds.

    wait=False never blocks: with a stale (or no) answer it returns what it has and refreshes in the
    background. That's for /api/status/init, which must answer at once: the launchers ask it (or /ping)
    "are you spotDLr?" with a short deadline, and two 10 s Spotify requests on a slow network used to
    miss it, so the Mac launcher reported "port 8000 is used by another app" about spotDLr itself."""
    if time.time() - _check["time"] < max_age and _check["time"]:
        return _check["ok"], _check["error"]
    if not wait:
        if not _refreshing.locked():
            threading.Thread(target=_refresh_in_background, daemon=True).start()
        return _check["ok"], _check["error"]
    return _refresh()


_refreshing = threading.Lock()


def _refresh_in_background():
    if _refreshing.acquire(blocking=False):  # one refresh at a time
        try:
            _refresh()
        finally:
            _refreshing.release()


def _refresh():
    try:
        status, message = _probe(_get_client().auth_manager)
        _check.update(time=time.time(), ok=status == "ok", error=message)
    except SpotifyError as e:  # keys missing
        _check.update(time=time.time(), ok=False, error=str(e))
    return _check["ok"], _check["error"]


def test_credentials(client_id, client_secret):
    """Probe new keys with a throwaway client, without touching the live one."""
    auth = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret,
                                    cache_handler=spotipy.MemoryCacheHandler(), requests_timeout=10)
    return _probe(auth)


def reset():
    """Forget the client and the cached check, so new env vars take effect immediately."""
    global _client
    _client = None
    _check.update(time=0, ok=False, error=None)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except spotipy.SpotifyException as e:
        if e.http_status == 429:
            wait = (e.headers or {}).get("Retry-After")
            raise SpotifyError(f"Spotify rate limit hit. Try again in {wait} s." if wait else "Spotify rate limit hit. Try again shortly.", 429)
        if e.http_status == 403 and "premium" in str(e.msg).lower():
            raise SpotifyError(PREMIUM_MESSAGE, 403)
        if e.http_status == 404:
            raise SpotifyError("Spotify doesn't let apps read this (Spotify-owned playlists are blocked for API apps).", 404)
        raise SpotifyError(f"Spotify error {e.http_status}: {e.msg}", 502)
    except SpotifyError:
        raise
    except Exception as e:
        ok, error = check(max_age=0)
        raise SpotifyError(error if not ok else f"Spotify request failed: {e}", 502)


def parse_url(text):
    """('album', '0mZ8…') for a Spotify URL/URI, else None."""
    match = SPOTIFY_URL.search(text or "")
    return (match.group(1), match.group(2)) if match else None


def url_for(kind, spotify_id):
    return f"https://open.spotify.com/{kind}/{spotify_id}"


# ---------- trimming ----------

def _image(images, target=300):
    """Pick the image closest to `target` px wide (Spotify sends 640/300/64)."""
    images = [i for i in (images or []) if i and i.get("url")]
    if not images:
        return None
    return min(images, key=lambda i: abs((i.get("width") or target) - target))["url"]


def _artists(items):
    return [{"id": a.get("id"), "name": a.get("name")} for a in (items or []) if a]


def _track(t, owned, album=None):
    if not t or not t.get("id"):
        return None
    album = t.get("album") or album or {}
    return {
        "source": "spotify",
        "id": t["id"],
        "name": t.get("name"),
        "artists": _artists(t.get("artists")),
        "album": {"id": album.get("id"), "name": album.get("name"), "image": _image(album.get("images"))},
        "duration_ms": t.get("duration_ms") or 0,
        "explicit": bool(t.get("explicit")),
        "url": url_for("track", t["id"]),
        "local_id": owned.get(t["id"]),
    }


def _album(a):
    if not a or not a.get("id"):
        return None
    return {
        "source": "spotify",
        "id": a["id"],
        "name": a.get("name"),
        "artists": _artists(a.get("artists")),
        "image": _image(a.get("images")),
        "year": (a.get("release_date") or "")[:4] or None,
        "album_type": a.get("album_type"),
        "total_tracks": a.get("total_tracks"),
        "url": url_for("album", a["id"]),
    }


def _artist(a):
    if not a or not a.get("id"):
        return None
    return {
        "source": "spotify",
        "id": a["id"],
        "name": a.get("name"),
        "image": _image(a.get("images")),
        "followers": (a.get("followers") or {}).get("total"),
        "genres": a.get("genres") or [],
        "url": url_for("artist", a["id"]),
    }


def _playlist(p):
    if not p or not p.get("id"):
        return None
    return {
        "source": "spotify",
        "id": p["id"],
        "name": p.get("name"),
        "owner": (p.get("owner") or {}).get("display_name"),
        "image": _image(p.get("images")),
        # Feb 2026: the playlist's "tracks" field was renamed "items"
        "total_tracks": (p.get("items") or p.get("tracks") or {}).get("total"),
        "description": re.sub(r"<[^>]+>", "", p.get("description") or ""),
        "url": url_for("playlist", p["id"]),
    }


def _clean(items):
    return [i for i in items if i]


# ---------- endpoints ----------

def search(query, owned, limit=10):
    sp = _get_client()
    result = _call(sp.search, q=query, type="track,artist,album,playlist", limit=limit, market=MARKET)
    return {
        "tracks": _clean(_track(t, owned) for t in (result.get("tracks") or {}).get("items", [])),
        "artists": _clean(_artist(a) for a in (result.get("artists") or {}).get("items", [])),
        "albums": _clean(_album(a) for a in (result.get("albums") or {}).get("items", [])),
        "playlists": _clean(_playlist(p) for p in (result.get("playlists") or {}).get("items", [])),
    }


def _all_pages(sp, first_page):
    """Follow Spotify pagination; a single call returns max 50-100 items."""
    page = first_page
    while True:
        yield page
        if not page.get("next"):
            break
        page = _call(sp.next, page)


def album(album_id, owned):
    sp = _get_client()
    a = _call(sp.album, album_id, market=MARKET)
    info = _album(a)
    tracks = []
    for page in _all_pages(sp, a.get("tracks") or {}):
        tracks += page.get("items", [])
    info["tracks"] = _clean(_track(t, owned, album=a) for t in tracks)
    info["label"] = a.get("label")
    return info


def playlist(playlist_id, owned):
    sp = _get_client()
    p = _call(sp.playlist, playlist_id, market=MARKET)
    info = _playlist(p)
    entries = []
    for page in _all_pages(sp, p.get("items") or p.get("tracks") or {}):
        entries += page.get("items") or []
    # Feb 2026: each entry's "track" became "item"; and Spotify only returns entries for playlists you own
    info["tracks"] = _clean(_track((entry or {}).get("item") or (entry or {}).get("track"), owned) for entry in entries)
    info["tracks_hidden"] = not info["tracks"] and bool(info["total_tracks"])
    return info


def artist(artist_id, owned):
    sp = _get_client()
    info = _artist(_call(sp.artist, artist_id))
    info["top_tracks"] = []  # GET /artists/{id}/top-tracks was removed in Feb 2026
    try:
        albums = _call(sp.artist_albums, artist_id, album_type="album,single", limit=30)
        info["albums"] = _clean(_album(a) for a in albums.get("items", []))
    except SpotifyError:
        info["albums"] = []
    return info


def describe(kind, spotify_id):
    """(title, image, total tracks) for a URL the user pasted, best effort."""
    try:
        sp = _get_client()
        if kind == "album":
            a = _call(sp.album, spotify_id)
            return a.get("name"), _image(a.get("images")), a.get("total_tracks")
        if kind == "playlist":
            p = _call(sp.playlist, spotify_id, fields="name,images,tracks.total")
            return p.get("name"), _image(p.get("images")), (p.get("tracks") or {}).get("total")
        if kind == "track":
            t = _call(sp.track, spotify_id)
            name = f"{', '.join(a['name'] for a in t.get('artists', []))} - {t.get('name')}"
            return name, _image((t.get("album") or {}).get("images")), 1
        if kind == "artist":
            a = _call(sp.artist, spotify_id)
            return a.get("name"), _image(a.get("images")), None
    except SpotifyError:
        pass
    return None, None, None
