#!/usr/bin/env python
"""
spotDLr - FastAPI backend
A local music library + player, with Spotify search and spotDL downloads.

Routes that touch Spotify or the disk are plain `def` on purpose: FastAPI runs
those in a threadpool, so a slow call never blocks the event loop.
"""

import base64
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
import zipfile
from urllib.parse import urlparse
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from pydantic import BaseModel

# Load SPOTIPY_CLIENT_ID / SPOTIPY_CLIENT_SECRET from .env next to this file
from paths import APP_DIR, DATA_DIR, FROZEN, MUSIC_DIR  # noqa: E402  (see paths.py: source vs installed app)

BASE_DIR = APP_DIR
ENV_FILE = DATA_DIR / ".env"
load_dotenv(ENV_FILE)

import spotify_api  # noqa: E402  (reads env vars, so it comes after load_dotenv)
import spotify_embed  # noqa: E402
import ytmusic  # noqa: E402
from downloader import Downloader, write_playlist  # noqa: E402
from genres import Genres  # noqa: E402
import stats  # noqa: E402
from library import MEDIA_TYPES, Library  # noqa: E402
from lyrics import Lyrics, LyricsError  # noqa: E402
import organize  # noqa: E402
import cleanup  # noqa: E402
import loudness  # noqa: E402
import phone  # noqa: E402
import schedules  # noqa: E402
import version  # noqa: E402
import abx  # noqa: E402
import apple_music  # noqa: E402
from organize import Exporter, Likes, OrganizeError  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DOWNLOAD_DIR = MUSIC_DIR
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="spotDLr", version="2.0.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

# Local-only guard. The API can write your Spotify secret to disk, so:
# - Host must be this machine (blocks DNS rebinding: evil.example resolving to 127.0.0.1)
# - writes must come from this page, not another site you happen to have open
# Phone access (phone.py) is the one way in from another device: its own server on the Wi-Fi address,
# and every request from there needs the key from the QR code (as a cookie after the first visit).
EXTRA_HOSTS = {h.strip() for h in os.getenv("SPOTDLR_HOSTS", "").split(",") if h.strip()}
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"} | EXTRA_HOSTS
phones = phone.PhoneAccess(DATA_DIR / "phone.json", app)
LOCAL_ONLY_PATHS = ("/api/phone", "/api/credentials", "/api/reveal", "/api/remote/source")  # computer-only actions
# What a phone's browser fetches without cookies (home-screen icon, manifest, service worker): nothing private
PUBLIC_PATHS = {"/static/manifest.webmanifest", "/sw.js", "/static/icons/icon-192.png", "/static/icons/icon-512.png",
                "/static/icons/apple-touch-icon.png", "/static/icons/icon.svg"}

PAIR_PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>spotDLr</title><body style="font:16px/1.5 system-ui,sans-serif;background:#121212;color:#fff;padding:32px 20px;max-width:440px;margin:auto">
<h1 style="font-size:22px">Scan the QR code to open spotDLr</h1>
<p style="color:#b3b3b3">On your computer, open spotDLr → Settings → <b>Phone access</b>, and scan the code with this phone's camera.
If you already did, the code was renewed or phone access was turned off: scan it again.</p></body>"""


@app.middleware("http")
async def local_only(request: Request, call_next):
    host = request.headers.get("host", "")
    hostname = host.rsplit(":", 1)[0]
    if phones.is_remote(request) and hostname not in EXTRA_HOSTS:
        verdict = phones.check(request) if phones.allowed_host(hostname) else None
        if not verdict and request.method == "GET" and request.url.path in PUBLIC_PATHS and phones.allowed_host(hostname):
            verdict = "ok"
        if request.url.path == "/" or not verdict:  # one line per page visit or refusal (never the key itself)
            logger.info("Phone access: %s %s from %s via %s → %s", request.method, request.url.path,
                        request.client.host if request.client else "?", hostname, verdict or "refused")
        if not verdict:
            if request.url.path == "/":
                return HTMLResponse(PAIR_PAGE, status_code=403)
            return JSONResponse({"detail": "Scan the QR code in spotDLr's Settings → Phone access on your computer"}, status_code=403)
        if request.url.path.startswith(LOCAL_ONLY_PATHS) and request.method not in ("GET", "HEAD"):
            return JSONResponse({"detail": "That can only be changed on the computer running spotDLr"}, status_code=403)
        if verdict == "pair":  # first visit from the QR code: remember this phone, and drop the key from the address bar
            response = RedirectResponse("/", status_code=303)
            response.set_cookie(phone.COOKIE, phones.session_value(), max_age=365 * 86400, httponly=True, samesite="lax", path="/",
                                secure=hostname.endswith(".ts.net"))  # HTTPS through Tailscale
            return response
    elif hostname not in ALLOWED_HOSTS and not phones.allowed_host(hostname):  # this computer on its own Wi-Fi/Tailscale address
        return JSONResponse({"detail": f"Host {host!r} not allowed. Add it to SPOTDLR_HOSTS in .env to allow it."}, status_code=403)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin and urlparse(origin).netloc != host:
        return JSONResponse({"detail": "Cross-site request blocked"}, status_code=403)
    response = await call_next(request)
    # The page and its scripts: always revalidate (a 304 when unchanged). Without this, Chrome guesses
    # freshness from Last-Modified and can keep running an old app.js for hours after an update.
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


library = Library(DOWNLOAD_DIR)
genres = Genres(DATA_DIR / ".genres.json", library.scan)  # fills in genres from Deezer in the background
plays = stats.Plays(DATA_DIR / "plays.jsonl")  # listening history for the Stats page
lyrics = Lyrics(DATA_DIR / ".lyrics")  # one cached lookup per song
likes = Likes(DATA_DIR / "likes.json")
album_fixer = cleanup.AlbumFixer(DATA_DIR / "tag-backups")  # "Fix album info": old tags saved here, for undo
REMOVED_DIR = DATA_DIR / "Removed songs"  # only when the Trash can't be used
scheduled = schedules.Schedules(DATA_DIR / "schedules.json")  # "Schedule play": alarm-style plays
song_loudness = loudness.Loudness(DATA_DIR / "loudness.json", ytmusic.ffmpeg_path, library)  # "Even out volume"
exporter = Exporter(ytmusic.ffmpeg_path)  # "Send to device"
abx_tests = abx.ABX(DATA_DIR / ".abx", ytmusic.ffmpeg_path)  # blind listening tests
apple = apple_music.AppleMusic(ytmusic.ffmpeg_path)  # "Add to Apple Music" (Mac)
downloader = Downloader(
    DOWNLOAD_DIR,
    on_finished=lambda job: logger.info(f"Job {job['id']} {job['status']}: {job['title']} ({job['message']})"),
    owned_video_ids=lambda: {v: library.path_for(i) for v, i in library.youtube_index().items()},
    owned_spotify_ids=lambda: {v: library.path_for(i) for v, i in library.spotify_index().items()},
    save_lyrics=lyrics.save_lrc,  # "Include lyrics": an .lrc next to each new song
)


class CredentialsRequest(BaseModel):
    client_id: str
    client_secret: str


class LikeRequest(BaseModel):
    liked: bool


class RevealRequest(BaseModel):
    track_id: Optional[str] = None
    collection_key: Optional[str] = None


class PlaylistRequest(BaseModel):
    name: str
    track_ids: list[str] = []


class PlaylistTracksRequest(BaseModel):
    track_ids: list[str]
    action: str  # add | remove | order (track_ids = the same songs in their new order)


class AlbumTracksRequest(BaseModel):
    track_ids: list[str]


class RenameRequest(BaseModel):
    name: str


class AlbumRequest(BaseModel):
    paths: list[str]               # as returned by /api/import
    album: str
    artist: str
    year: Optional[str] = None
    cover: Optional[str] = None    # data: URL of a JPEG/PNG


class MergeRequest(BaseModel):
    keep: str
    remove: list[str]


class AlbumFix(BaseModel):
    id: str
    album: str
    album_artist: Optional[str] = None
    artist: Optional[str] = None
    year: Optional[str] = None
    cover_url: Optional[str] = None


class AlbumFixRequest(BaseModel):
    items: list[AlbumFix]


class ExportRequest(BaseModel):
    track_ids: list[str]
    device: str                    # a path from /api/devices (or one the user typed)
    subfolder: str = "Music"
    collection: Optional[str] = None
    format: str = "original"       # original | mp3
    bitrate: int = 256


class AppleMusicRequest(BaseModel):
    track_ids: list[str]
    collection: Optional[str] = None
    make_playlist: bool = False


class ABXRequest(BaseModel):
    track_id: str
    codec: str = "aac"
    bitrate: int = 256
    start: float = 60
    length: float = 30
    trials: int = 10


class ABXAnswer(BaseModel):
    trial: int
    guess: str  # A | B


class WindowRequest(BaseModel):
    id: str


class PlayRequest(BaseModel):
    track_id: str
    seconds: float


class RemoteSourceRequest(BaseModel):
    device_id: str
    device_name: str
    state: dict


class RemoteCommandRequest(BaseModel):
    action: str
    value: Optional[object] = None


class DownloadRequest(BaseModel):
    query: str                      # Spotify or YouTube Music URL, or free text for a single track
    type: Optional[str] = None      # track | album | playlist | artist (detected from the URL when omitted)
    title: Optional[str] = None     # display name / folder name hint from the UI
    image: Optional[str] = None
    total: Optional[int] = None
    format: str = "m4a"
    bitrate: str = "auto"
    includeLyrics: bool = False


@app.get("/")
def root():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/api/ping")
def ping():
    """"Are you spotDLr?" for the launchers: instant, no network, disk or git."""
    return {"app": "spotDLr", "version": version.VERSION}


@app.get("/api/status/init")
def check_initialization(request: Request):
    """Is Spotify usable? Search and downloads fall back to YouTube Music when it isn't.
    Never waits on Spotify (see spotify_api.check): it must answer at once."""
    ok, error = spotify_api.check(wait=False)
    return {
        "initialized": ok,
        "message": "Spotify connected" if ok else error,
        "search_source": "spotify" if ok else "ytm",
        "setup_url": "https://developer.spotify.com/dashboard/",
        "version": version.VERSION,
        "build": version.source_build(),  # git describe when running from source, else None
        "apple_music": apple_music.available(),
        "on_phone": phones.is_remote(request),  # opened through phone access (Wi-Fi or Tailscale)
    }


THEME_FILE = DATA_DIR / "theme.json"
CLIENT_PREFERENCES_FILE = DATA_DIR / "client-preferences.json"
THEME_KEYS = {"theme", "mode", "surface", "glass", "transparency", "themeSchedule", "customColors"}


@app.get("/api/preferences/theme")
def theme_preferences():
    try:
        values = json.loads(THEME_FILE.read_text(encoding="utf-8"))
        return {key: value for key, value in values.items() if key in THEME_KEYS}
    except (OSError, ValueError, AttributeError):
        return {}


@app.put("/api/preferences/theme")
def save_theme_preferences(values: dict = Body(...)):
    clean = {key: value for key, value in values.items() if key in THEME_KEYS}
    encoded = json.dumps(clean, separators=(",", ":"))
    if len(encoded) > 16_384:
        raise HTTPException(413, "Too many saved colors")
    temporary = THEME_FILE.with_suffix(".tmp")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(THEME_FILE)
    return {"saved": True}


@app.get("/api/preferences/client")
def client_preferences():
    try:
        values = json.loads(CLIENT_PREFERENCES_FILE.read_text(encoding="utf-8"))
        return values if isinstance(values, dict) else {}
    except (OSError, ValueError):
        return {}


@app.put("/api/preferences/client")
def save_client_preferences(values: dict = Body(...)):
    current = client_preferences()
    clean = {str(key): value for key, value in values.items()
             if isinstance(key, str) and 0 < len(key) <= 64 and key != "preferencesRestored"}
    current.update(clean)
    encoded = json.dumps(current, separators=(",", ":"))
    if len(encoded) > 131_072:
        raise HTTPException(413, "Too many saved preferences")
    temporary = CLIENT_PREFERENCES_FILE.with_suffix(".tmp")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(CLIENT_PREFERENCES_FILE)
    return {"saved": True}


# ---------- Spotify credentials ----------

def _write_env(updates: dict):
    """Set keys in .env, keeping every other line (comments, SPOTIFY_MARKET, …). Owner-only permissions."""
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    out, seen = [], set()
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in updates and not line.lstrip().startswith("#"):
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in updates.items() if k not in seen]
    tmp = ENV_FILE.with_name(".env.tmp")
    tmp.write_text("\n".join(out) + "\n")
    os.chmod(tmp, 0o600)
    tmp.replace(ENV_FILE)  # atomic: never a half-written .env


def _credentials_status():
    client_id = os.getenv("SPOTIPY_CLIENT_ID") or ""
    ok, error = spotify_api.check()
    return {
        "configured": bool(client_id and os.getenv("SPOTIPY_CLIENT_SECRET")),
        "client_id_hint": f"…{client_id[-4:]}" if client_id else None,  # the secret is never sent back
        "initialized": ok,
        "message": "Spotify connected" if ok else error,
    }


@app.get("/api/credentials")
def get_credentials():
    return _credentials_status()


@app.post("/api/credentials")
def set_credentials(request: CredentialsRequest):
    client_id, client_secret = request.client_id.strip(), request.client_secret.strip()
    for label, value in (("Client ID", client_id), ("Client Secret", client_secret)):
        if not re.fullmatch(r"[A-Za-z0-9]{32}", value):
            raise HTTPException(status_code=400, detail=f"{label} should be 32 letters and numbers. Copy it again from the Spotify dashboard.")
    status, error = spotify_api.test_credentials(client_id, client_secret)
    if status == "bad":
        raise HTTPException(status_code=400, detail=error)  # nothing saved
    # "premium": the keys are valid but the app owner needs Premium. Save them anyway, so the
    # app starts working by itself once Spotify enables the account (it can take a few hours)
    _write_env({"SPOTIPY_CLIENT_ID": client_id, "SPOTIPY_CLIENT_SECRET": client_secret})
    os.environ["SPOTIPY_CLIENT_ID"] = client_id          # live: search and new downloads use them now
    os.environ["SPOTIPY_CLIENT_SECRET"] = client_secret
    spotify_api.reset()
    logger.info(f"Spotify credentials updated (client id …{client_id[-4:]})")
    return _credentials_status()


# ---------- library ----------

@app.get("/api/library")
def get_library():
    snapshot = library.snapshot()
    for track in snapshot["tracks"]:
        track["genre"] = genres.genre_for(track)
    snapshot["liked"] = likes.ids()
    return snapshot


@app.post("/api/plays")
def record_play(request: PlayRequest):
    """The player reports how long a song actually played; it counts from 30 s (or half a short song)."""
    track = next((t for t in library.scan() if t["id"] == request.track_id), None)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"recorded": plays.record(dict(track, genre=genres.genre_for(track)), request.seconds)}


# ---------- remote playback ----------
# A paired phone never talks directly to the desktop browser. The local server holds the latest player
# snapshot and a short command queue; the desktop checks both while it is open. Nothing is persisted.
class RemotePlayback:
    ACTIONS = {"play", "pause", "toggle", "next", "previous", "seek", "volume", "mute", "transfer",
               "shuffle", "repeat", "play_context", "queue_add", "queue_remove", "queue_clear",
               "queue_play", "queue_move"}

    def __init__(self):
        self.condition = threading.Condition()
        self.source = None
        self.commands = []

    def publish(self, device_id, device_name, state, wait=0):
        now = time.time()
        device_id = device_id[:64]
        with self.condition:
            current = self.source
            stale = not current or now - current["seen"] > 5
            takeover = current and bool(state.get("playing")) and not bool(current["state"].get("playing"))
            if stale or current["device_id"] == device_id or takeover:
                self.source = {"device_id": device_id, "device_name": device_name[:80],
                               "state": state, "seen": now}
                if not self.commands and wait > 0:
                    self.condition.wait(timeout=min(float(wait), 2))
                current = self.source
                if current and current["device_id"] == device_id:
                    self.source = {"device_id": device_id, "device_name": device_name[:80],
                                   "state": state, "seen": time.time()}
                    commands, self.commands = self.commands, []
                else:
                    commands = []
            else:
                commands = []
        return {"commands": commands}

    def status(self):
        with self.condition:
            source = dict(self.source) if self.source else None
        if not source or time.time() - source["seen"] > 5:
            return {"online": False, "source": None, "state": None}
        return {"online": True, "source": {"id": source["device_id"], "name": source["device_name"]},
                "state": source["state"]}

    def command(self, action, value):
        if action not in self.ACTIONS:
            raise ValueError("Unknown remote command")
        with self.condition:
            if not self.source or time.time() - self.source["seen"] > 5:
                raise RuntimeError("The computer player is not available")
            self.commands.append({"action": action, "value": value})
            self.condition.notify_all()


remote_playback = RemotePlayback()


@app.post("/api/remote/source")
def remote_source(request: RemoteSourceRequest, wait: float = 0):
    return remote_playback.publish(request.device_id, request.device_name, request.state,
                                   wait=max(0, min(wait, 2)))


@app.get("/api/remote/status")
def remote_status():
    return remote_playback.status()


@app.post("/api/remote/command")
def remote_command(request: RemoteCommandRequest):
    try:
        remote_playback.command(request.action, request.value)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error))
    return {"ok": True}


# ---------- organizing: likes, your playlists, adding files, sending to a device (organize.py) ----------

@app.exception_handler(OrganizeError)
def organize_error(request: Request, error: OrganizeError):
    return JSONResponse({"detail": str(error)}, status_code=error.status)


def _paths_for(track_ids):
    """Library tracks → absolute paths, in order; unknown ids are an error, not silently dropped."""
    paths = []
    for track_id in track_ids:
        path = library.path_for(track_id)
        if not path:
            raise OrganizeError("A song isn't in your library anymore. Refresh and try again.", 404)
        paths.append(path)
    return paths


@app.post("/api/reveal")
def reveal_location(request: RevealRequest):
    if request.track_id is not None and request.collection_key is not None:
        raise OrganizeError("Choose a song or a collection to open", 400)
    if request.track_id is not None:
        path = library.path_for(request.track_id)
        if path is None:
            raise OrganizeError("This song is no longer in your library. Refresh and try again.", 404)
    elif request.collection_key is not None:
        if not any(c["key"] == request.collection_key for c in library.snapshot()["collections"]):
            raise OrganizeError("This collection is no longer in your library. Refresh and try again.", 404)
        path = DOWNLOAD_DIR / request.collection_key
    else:
        path = DOWNLOAD_DIR
    organize.open_location(DOWNLOAD_DIR, path)
    return {"opened": True}


@app.post("/api/likes/{track_id}")
def set_like(track_id: str, request: LikeRequest):
    if not library.path_for(track_id):
        raise HTTPException(status_code=404, detail="Track not found")
    likes.set(track_id, request.liked)
    return {"liked": likes.ids()}


@app.post("/api/playlists")
def create_playlist(request: PlaylistRequest):
    return {"key": organize.create_playlist(DOWNLOAD_DIR, request.name, _paths_for(request.track_ids))}


@app.post("/api/playlists/{key}/tracks")
def change_playlist(key: str, request: PlaylistTracksRequest):
    collection = next((c for c in library.snapshot()["collections"] if c["key"] == key), None)
    if request.action == "add":
        if not collection:
            raise OrganizeError("This playlist is no longer in your library. Refresh and try again.", 404)
        if collection["kind"] != "playlist":
            raise OrganizeError("Songs can only be added to playlists, not albums", 403)
        folder = DOWNLOAD_DIR / key
        if folder.parent != DOWNLOAD_DIR or folder.resolve().parent != DOWNLOAD_DIR.resolve() or not folder.is_dir():
            raise OrganizeError("This playlist is outside your music folder", 403)
    else:
        folder = organize.user_playlist(DOWNLOAD_DIR, key)
    current = collection["track_ids"] if collection else []
    if request.action == "add":
        ids = list(dict.fromkeys(current + request.track_ids))  # no duplicates, appended at the end
    elif request.action == "remove":
        ids = [i for i in current if i not in set(request.track_ids)]
    elif request.action == "order":
        if sorted(request.track_ids) != sorted(current):
            raise HTTPException(status_code=409, detail="The playlist changed meanwhile. Refresh and try again.")
        ids = request.track_ids
    else:
        raise HTTPException(status_code=400, detail="action must be add, remove or order")
    write_playlist(folder, _paths_for(ids))
    return {"count": len(ids)}


@app.post("/api/playlists/{key}/rename")
def rename_playlist(key: str, request: RenameRequest):
    return {"key": organize.rename_playlist(DOWNLOAD_DIR, key, request.name)}


@app.post("/api/albums/{key}/tracks")
def add_album_tracks(key: str, request: AlbumTracksRequest):
    collection = next((c for c in library.snapshot()["collections"] if c["key"] == key), None)
    if not collection:
        raise OrganizeError("This album is no longer in your library. Refresh and try again.", 404)
    if collection["kind"] != "album":
        raise OrganizeError("Choose an album to add songs to", 403)
    ids = list(dict.fromkeys(collection["track_ids"] + request.track_ids))
    organize.add_to_album(DOWNLOAD_DIR, collection, _paths_for(ids))
    return {"count": len(ids)}


@app.delete("/api/playlists/{key}")
def delete_playlist(key: str):
    organize.delete_playlist(DOWNLOAD_DIR, key)
    return {"deleted": key}


@app.post("/api/import")
async def import_file(request: Request, name: str, album: str = ""):
    """Body = the raw file (no multipart, so no extra dependency). ?album= puts it in that album's folder."""
    path = await organize.import_stream(DOWNLOAD_DIR, name, album, request.stream())
    return {"path": path}


@app.post("/api/import/album")
def make_album(request: AlbumRequest):
    album, artist = request.album.strip(), request.artist.strip()
    if not album or not artist:
        raise HTTPException(status_code=400, detail="An album needs a name and an artist")
    cover = None
    if request.cover:
        header, _, data = request.cover.partition(",")
        mime = header.removeprefix("data:").split(";")[0]
        if mime not in ("image/jpeg", "image/png"):
            raise HTTPException(status_code=415, detail="The cover must be a JPEG or PNG image")
        cover = (base64.b64decode(data), mime)
        if len(cover[0]) > 15_000_000:
            raise HTTPException(status_code=413, detail="That cover image is over 15 MB")
    tagged, untaggable = 0, []
    for rel in request.paths:
        path = (DOWNLOAD_DIR / rel).resolve()
        if DOWNLOAD_DIR.resolve() not in path.parents or not path.is_file():
            raise HTTPException(status_code=400, detail=f"Not a file in your library: {rel}")
        if organize.tag_album(path, album, artist, request.year, cover):
            tagged += 1
        else:
            untaggable.append(path.name)
    return {"tagged": tagged, "untaggable": untaggable}


# ---------- tidying: duplicates and album info (cleanup.py) ----------

@app.exception_handler(cleanup.CleanupError)
def cleanup_error(request: Request, error: cleanup.CleanupError):
    return JSONResponse({"detail": str(error)}, status_code=error.status)


@app.get("/api/duplicates")
def duplicates():
    snapshot = library.snapshot()
    groups = cleanup.find_duplicates(snapshot["tracks"], snapshot["collections"], set(likes.ids()))
    return {"groups": groups, "extra_bytes": sum(g["extra_bytes"] for g in groups)}


@app.post("/api/duplicates/merge")
def merge_duplicates(request: MergeRequest):
    return cleanup.merge(DOWNLOAD_DIR, library.scan(), request.keep, request.remove, likes, plays, REMOVED_DIR)


@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str):
    return cleanup.delete_track(DOWNLOAD_DIR, library.scan(), track_id, likes, REMOVED_DIR)


@app.post("/api/album-fix/scan")
def album_fix_scan():
    snapshot = library.snapshot()
    return album_fixer.start(cleanup.album_suspects(snapshot["tracks"], snapshot["collections"]))


@app.get("/api/album-fix")
def album_fix_status():
    job = album_fixer.get()
    return {"job": job, "can_undo": bool(album_fixer.last_backup())}


@app.post("/api/album-fix/apply")
def album_fix_apply(request: AlbumFixRequest):
    if not request.items:
        raise HTTPException(status_code=400, detail="Pick at least one song")
    for item in request.items:
        if not item.album.strip():
            raise HTTPException(status_code=400, detail="An album name can't be empty")
        if item.cover_url and not re.match(r"^https://[\w.-]+\.(googleusercontent|ggpht|ytimg)\.com/", item.cover_url):
            raise HTTPException(status_code=400, detail="Covers can only come from YouTube Music")
    return album_fixer.apply(DOWNLOAD_DIR, [i.model_dump() if hasattr(i, "model_dump") else i.dict() for i in request.items],
                             _paths_for, organize.tag_album, ytmusic._fetch_cover)


@app.post("/api/album-fix/undo")
def album_fix_undo():
    return album_fixer.undo(DOWNLOAD_DIR)


# ---------- loudness, for "Even out volume" (loudness.py) ----------

@app.get("/api/loudness/{track_id}")
def track_loudness(track_id: str):
    """{lufs, peak} for one song, measured now if it hasn't been (about a second)."""
    track = library._tracks_by_id.get(track_id) or next((t for t in library.scan() if t["id"] == track_id), None)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return song_loudness.get(track) or {"lufs": None, "peak": None}


@app.post("/api/loudness/scan")
def loudness_scan():
    """Measure every song not measured yet, in the background (when "Even out volume" is turned on)."""
    return song_loudness.start_scan()


@app.get("/api/loudness")
def loudness_status():
    return dict(song_loudness.scan, measured=len(song_loudness.data))


# ---------- scheduled plays (schedules.py) ----------

@app.exception_handler(schedules.ScheduleError)
def schedule_error(request: Request, error: schedules.ScheduleError):
    return JSONResponse({"detail": str(error)}, status_code=error.status)


class FiredRequest(BaseModel):
    occurrence: str


@app.get("/api/schedules")
def list_schedules():
    return {"schedules": scheduled.all()}


@app.post("/api/schedules")
async def save_schedule(request: Request):
    return scheduled.save(await request.json())


@app.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: str):
    scheduled.delete(schedule_id)
    return {"deleted": schedule_id}


@app.post("/api/schedules/{schedule_id}/fired")
def schedule_fired(schedule_id: str, body: FiredRequest):
    """The page claims this occurrence before playing it; only the first claim wins."""
    return {"play": scheduled.fired(schedule_id, body.occurrence)}


# ---------- phone access (phone.py) ----------

class PhoneRequest(BaseModel):
    enabled: Optional[bool] = None
    tailscale: Optional[bool] = None
    funnel: Optional[bool] = None


@app.on_event("startup")
def start_phone_access():
    threading.Thread(target=phones.start, daemon=True).start()  # if it was on last time


@app.get("/sw.js")
def service_worker():
    """At the root so its scope is the whole app (from /static/ it could only cover /static/)."""
    # The offline page offers the home Wi-Fi address (no key in it: this file is public), for when Tailscale
    # is off on the phone but it's on the same Wi-Fi as this computer
    status = phones.status(with_tailscale=False)
    home = "" if status["tailscale"]["funnel"] else status["address"] or ""  # public with Funnel: don't reveal the home network name
    script = (BASE_DIR / "static" / "sw.js").read_text(encoding="utf-8").replace("__HOME_URL__", home)
    return Response(script, media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/api/phone")
def phone_status():
    return phones.status()


@app.post("/api/phone")
def set_phone_access(request: Request, body: PhoneRequest):
    result = None
    if body.enabled is not None:
        result = phones.enable(request.url.port) if body.enabled else phones.disable()
    if body.tailscale is not None:
        if body.tailscale and not phones.enabled:
            raise HTTPException(status_code=400, detail="Turn on phone access first")
        result = phones.set_tailscale(body.tailscale)
    if body.funnel is not None:
        result = phones.set_funnel(body.funnel)
    return result or phones.status()


@app.post("/api/phone/new-key")
def new_phone_key():
    """A new QR code: every phone signed in with the old one is signed out."""
    if not phones.enabled:
        raise HTTPException(status_code=400, detail="Phone access is off")
    return phones.new_key()


@app.get("/api/devices")
def devices():
    return {"devices": organize.list_devices()}


@app.post("/api/export")
def export(request: ExportRequest):
    tracks = [library._tracks_by_id.get(i) for i in request.track_ids]
    items = [(path, (track or {}).get("duration") or 0) for path, track in zip(_paths_for(request.track_ids), tracks)]
    if not items:
        raise HTTPException(status_code=400, detail="No songs to send")
    return exporter.start(items, request.device, request.subfolder, request.collection, request.format, request.bitrate)


@app.get("/api/export/{job_id}")
def export_status(job_id: str):
    job = exporter.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such copy job")
    return job


class ZipRequest(BaseModel):
    track_ids: list[str]
    name: str = "playlist"


class CsvImportRequest(BaseModel):
    name: str
    csv_text: str
    format: str = "mp3"
    bitrate: str = "auto"
    lyrics: bool = False


def _csv_queries(csv_text):
    """Exportify-style rows → ['Artist - Title', …]. Matches Track/Song/Title
    and Artist(s) columns loosely; skips incomplete rows."""
    import csv as _csv
    import io as _io
    rows = list(_csv.DictReader(_io.StringIO(csv_text)))
    if not rows:
        raise HTTPException(status_code=400, detail="No rows found in the CSV.")
    cols = {c.strip().lower(): c for c in (rows[0].keys() or [])}
    def pick(*wants):
        for w in wants:
            for key, orig in cols.items():
                if w in key:
                    return orig
        return None
    title_col = pick("track name", "song name", "track", "song", "title")
    artist_col = pick("artist name", "artist")
    if not title_col or not artist_col:
        raise HTTPException(status_code=400, detail="Couldn't find track and artist columns.")
    queries = []
    for r in rows[:2000]:
        title = (r.get(title_col) or "").strip()
        artist = (r.get(artist_col) or "").strip()
        if title and artist:
            queries.append(f"{artist} - {title}")
    if not queries:
        raise HTTPException(status_code=400, detail="No usable artist/title rows found.")
    return queries


@app.post("/api/import-csv")
def import_csv(request: CsvImportRequest):
    """One background job from a playlist CSV. Rows are matched on YouTube
    Music (no Spotify keys needed); the job title becomes the folder, so an
    existing playlist name merges into its folder instead of forking."""
    from downloader import safe_folder_name
    folder = safe_folder_name(request.name or "")
    if not folder:
        raise HTTPException(status_code=400, detail="Give the playlist a name.")
    queries = _csv_queries(request.csv_text)
    return downloader.submit(query=queries[0], queries=queries, kind="playlist", source="ytm",
                             title=folder, total=len(queries),
                             format=request.format, bitrate=request.bitrate, lyrics=request.lyrics)


@app.post("/api/zip")
def download_zip(request: ZipRequest):
    """Bundle library tracks into a numbered zip for one-click browser download
    (save it straight onto a USB stick). Uncompressed: MP3s don't shrink."""
    paths = _paths_for(request.track_ids)
    safe = re.sub(r"\s+", " ", (request.name or "playlist")).strip(" .") or "playlist"
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    try:
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_STORED) as zf:
            for i, path in enumerate(paths):
                zf.write(path, f"{i + 1:02d} - {path.name}")
    except Exception:
        os.unlink(tmp.name)
        raise
    return FileResponse(tmp.name, media_type="application/zip", filename=f"{safe}.zip",
                        background=BackgroundTask(os.unlink, tmp.name))


# ---------- Add to Apple Music (apple_music.py) ----------

@app.exception_handler(apple_music.AppleMusicError)
def apple_music_error(request: Request, error: apple_music.AppleMusicError):
    return JSONResponse({"detail": str(error)}, status_code=error.status)


@app.post("/api/apple-music")
def add_to_apple_music(request: AppleMusicRequest):
    tracks = []
    for track_id, path in zip(request.track_ids, _paths_for(request.track_ids)):
        t = library._tracks_by_id[track_id]
        tracks.append({"path": path, "title": t["title"], "album": t["album"], "artists": t["artists"]})
    return apple.start(tracks, request.collection, request.make_playlist)


@app.get("/api/apple-music/{job_id}")
def apple_music_status(job_id: str):
    job = apple.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such job")
    return job


# ---------- blind listening test (abx.py) ----------

@app.exception_handler(abx.ABXError)
def abx_error(request: Request, error: abx.ABXError):
    return JSONResponse({"detail": str(error)}, status_code=error.status)


@app.get("/api/abx/source/{track_id}")
def abx_source(track_id: str):
    path = library.path_for(track_id)
    if not path:
        raise HTTPException(status_code=404, detail="Track not found")
    return abx.describe_source(path)


@app.post("/api/abx")
def abx_create(request: ABXRequest):
    path = library.path_for(request.track_id)
    track = library._tracks_by_id.get(request.track_id)
    if not path or not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return abx_tests.create(path, track["duration"], request.codec, request.bitrate, request.start, request.length, request.trials)


@app.get("/api/abx/{session_id}")
def abx_status(session_id: str):
    return abx_tests.public(abx_tests.get(session_id))


@app.get("/api/abx/{session_id}/{kind}/{token}")
def abx_clip(session_id: str, kind: str, token: str):
    """kind=clip: token a|b. kind=x: a per-trial random token. no-store, so nothing is learned from the cache."""
    path = abx_tests.clip_path(session_id, token if kind in ("clip", "x") else "")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.post("/api/abx/{session_id}/answer")
def abx_answer(session_id: str, request: ABXAnswer):
    return abx_tests.answer(session_id, request.trial, request.guess)


# ---------- open windows (the desktop app stops when the last one closes) ----------
# Each page checks in every 15 s and says goodbye on close. desktop.py reads `windows` to decide when to
# stop: watching Edge's process doesn't work, because Edge hands the window to another process and exits.
windows = {}            # window id -> last check-in (time.time())
windows_lock = threading.Lock()
WINDOW_TIMEOUT = 180    # no check-in for this long = gone without a goodbye (crash, sleep); a hidden
                        # window's timers can slow to once a minute, so this stays well above that


@app.post("/api/window/alive")
def window_alive(request: WindowRequest):
    with windows_lock:
        windows[request.id[:64]] = time.time()
    return {"ok": True}


@app.post("/api/window/bye")
def window_bye(request: WindowRequest):
    with windows_lock:
        windows.pop(request.id[:64], None)
    return {"ok": True}


def open_windows():
    """How many windows have checked in recently (drops ones that went quiet)."""
    now = time.time()
    with windows_lock:
        for window_id in [w for w, seen in windows.items() if now - seen > WINDOW_TIMEOUT]:
            del windows[window_id]
        return len(windows)


@app.get("/api/stats")
def get_stats(range: str = "30d", days: int | None = None):
    if days is not None:  # the old ?days=7|30|90|365|0
        range = f"{days}d" if days else "all"
    if range not in stats.RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of: {', '.join(stats.RANGES)}")
    tracks = library.scan()
    return {
        "library": stats.library_stats(tracks, genres.genre_for),
        "listening": stats.listening_stats(plays.load(), range, {t["id"] for t in tracks}),
    }


@app.get("/api/genres/status")
def genre_status():
    return genres.status()


@app.get("/api/stream/{track_id}")
def stream(track_id: str, request: Request):
    path = library.path_for(track_id)
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="Track not found")
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return _ranged_file(path, media_type, request.headers.get("range"))


def _ranged_file(path: Path, media_type: str, range_header: Optional[str]):
    """Answer `Range: bytes=…` with 206 Partial Content.

    Starlette 0.27's FileResponse ignores Range and always sends the whole file,
    and Safari won't seek <audio> without real 206 responses.
    """
    size = path.stat().st_size
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", (range_header or "").strip())
    if not match or match.groups() == ("", ""):
        return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})
    first, last = match.groups()
    if first == "":  # "bytes=-500" means the last 500 bytes
        start, end = max(size - int(last), 0), size - 1
    else:
        start, end = int(first), min(int(last) if last else size - 1, size - 1)
    if start > end or start >= size:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})

    def chunks():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                data = f.read(min(64 * 1024, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {"Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes", "Content-Length": str(end - start + 1)}
    return StreamingResponse(chunks(), status_code=206, media_type=media_type, headers=headers)


@app.get("/api/lyrics/save-status")
def lyrics_save_status():
    return lyrics.save_status()


@app.post("/api/lyrics/save-library")
def save_library_lyrics():
    return lyrics.start_save(library.scan(), DOWNLOAD_DIR)


@app.post("/api/lyrics/{track_id}")
def save_track_lyrics(track_id: str):
    path = library.path_for(track_id)
    track = library._tracks_by_id.get(track_id)
    if not path or not path.is_file() or not track:
        raise HTTPException(status_code=404, detail="Track not found")
    try:
        return {"status": lyrics.save_existing(track, path)}
    except LyricsError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't save lyrics: {e}")


@app.get("/api/lyrics/{track_id}")
def track_lyrics(track_id: str):
    """{lines: [{t, text}] | null, plain: str | null, instrumental, source}. Plain def: LRCLIB is a blocking call."""
    path = library.path_for(track_id)
    track = library._tracks_by_id.get(track_id)
    if not path or not track:
        raise HTTPException(status_code=404, detail="Track not found")
    try:
        return lyrics.for_track(track, path)
    except LyricsError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/art/{track_id}")
def art(track_id: str):
    cover = library.cover(track_id)
    if not cover:
        raise HTTPException(status_code=404, detail="No cover art")
    data, mime = cover
    return Response(content=data, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})


# ---------- remote cover images (proxied + cached) ----------

# Google's image host rate-limits bursts (HTTP 429): a search page asks for 30-40 covers at once.
# Fetch each cover once, at most 4 at a time, keep it on disk, and serve it from here.
IMAGE_CACHE = DATA_DIR / ".imgcache"
IMAGE_HOSTS = ("yt3.googleusercontent.com", "lh3.googleusercontent.com", "yt3.ggpht.com", "i.ytimg.com", "i.scdn.co",
               "mosaic.scdn.co", "image-cdn-ak.spotifycdn.com", "image-cdn-fa.spotifycdn.com")
_image_slots = threading.BoundedSemaphore(4)


@app.get("/api/img")
def remote_image(u: str):
    parsed = urlparse(u)
    if parsed.scheme != "https" or parsed.hostname not in IMAGE_HOSTS:
        raise HTTPException(status_code=400, detail="Image host not allowed")  # not an open proxy
    key = hashlib.sha1(u.encode()).hexdigest()
    cached = IMAGE_CACHE / key
    headers = {"Cache-Control": "public, max-age=604800"}
    if cached.exists():
        return FileResponse(cached, media_type=(IMAGE_CACHE / f"{key}.type").read_text() if (IMAGE_CACHE / f"{key}.type").exists() else "image/jpeg", headers=headers)
    with _image_slots:
        for attempt in range(3):
            try:
                response = requests.get(u, timeout=15)
            except requests.RequestException:
                response = None
            if response is not None and response.status_code == 429 and attempt < 2:
                time.sleep(1.5 * (attempt + 1))  # rate-limited: back off and retry
                continue
            break
    if response is None or not response.ok or not response.headers.get("content-type", "").startswith("image/"):
        raise HTTPException(status_code=502, detail="Couldn't fetch image")
    IMAGE_CACHE.mkdir(exist_ok=True)
    tmp = IMAGE_CACHE / f"{key}.tmp"
    tmp.write_bytes(response.content)
    tmp.replace(cached)
    (IMAGE_CACHE / f"{key}.type").write_text(response.headers["content-type"].split(";")[0])
    return Response(content=response.content, media_type=response.headers["content-type"].split(";")[0], headers=headers)


# ---------- Spotify ----------

def _spotify(fn, *args):
    try:
        return fn(*args)
    except spotify_api.SpotifyError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


@app.get("/api/search")
def search(q: str, source: Optional[str] = None):
    """Spotify when it's connected (or asked for), otherwise YouTube Music."""
    if not q.strip():
        return {"tracks": [], "artists": [], "albums": [], "playlists": []}
    if source != "ytm" and (source == "spotify" or spotify_api.check()[0]):
        return dict(_spotify(spotify_api.search, q.strip(), library.spotify_index()), source="spotify")
    return _ytmusic(ytmusic.search, q.strip())


def _ytmusic(fn, *args):
    try:
        return fn(*args)
    except ytmusic.YTMusicError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


@app.get("/api/ytm/{kind}/{item_id}")
def ytm_item(kind: str, item_id: str):
    handlers = {"album": ytmusic.album, "playlist": ytmusic.playlist, "artist": ytmusic.artist}
    if kind not in handlers:
        raise HTTPException(status_code=404, detail="Unknown type")
    return _ytmusic(handlers[kind], item_id)


@app.get("/api/spotify/{kind}/{spotify_id}")
def spotify_item(kind: str, spotify_id: str):
    handlers = {"album": spotify_api.album, "playlist": spotify_api.playlist, "artist": spotify_api.artist}
    if kind not in handlers:
        raise HTTPException(status_code=404, detail="Unknown type")
    if not spotify_api.check()[0] and kind in ("album", "playlist"):
        # No API (e.g. Premium rule): the public embed still lists the songs
        try:
            return spotify_embed.item(kind, spotify_id)
        except spotify_embed.EmbedError as e:
            raise HTTPException(status_code=502, detail=str(e))
    return _spotify(handlers[kind], spotify_id, library.spotify_index())


# ---------- downloads ----------

@app.post("/api/download")
def download(request: DownloadRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    kind, title, image, total = request.type, request.title, request.image, request.total
    common = dict(format=request.format, bitrate=request.bitrate, lyrics=request.includeLyrics)

    # YouTube Music link, or free text while Spotify is unavailable → yt-dlp path (no Spotify needed)
    ytm = _ytmusic(ytmusic.parse_url, query)
    spotify_ok, spotify_error = spotify_api.check()
    # Installed app (FROZEN): spotDL can't run there (`sys.executable -m spotdl` would start spotDLr.exe
    # again), so everything goes through YouTube Music even when Spotify keys work
    use_ytm_only = FROZEN or not spotify_ok
    if not ytm and not spotify_api.parse_url(query) and use_ytm_only:
        songs = _ytmusic(ytmusic.search, query)["tracks"]
        if not songs:
            raise HTTPException(status_code=404, detail=f"Nothing found on YouTube Music for {query!r}")
        ytm = ("track", songs[0]["id"])
    if ytm:
        kind, item_id = ytm
        if kind == "artist":
            raise HTTPException(status_code=400, detail="Artists can't be downloaded as a whole. Open the artist and download albums or songs.")
        if not title:
            title, image, total = ytmusic.describe(kind, item_id)
        return downloader.submit(query=ytmusic.url_for(kind, item_id), kind=kind, source="ytm", item_id=item_id,
                                 title=title, image=image, total=1 if kind == "track" else total, **common)

    # Spotify link without a working API: read the song list from Spotify's public embed,
    # then match and download each song from YouTube Music
    parsed = spotify_api.parse_url(query)
    if parsed and use_ytm_only:
        kind, item_id = parsed
        if kind == "artist":
            raise HTTPException(status_code=400, detail="Artists can't be downloaded as a whole. Open an album or song instead.")
        if not title:
            try:
                info = spotify_embed.item(kind, item_id)
                title = info["name"] if kind != "track" else f"{', '.join(a['name'] for a in info['artists'])} - {info['name']}"
                image, total = info.get("image"), info.get("total_tracks")
            except spotify_embed.EmbedError as e:
                raise HTTPException(status_code=502, detail=str(e))
        return downloader.submit(query=spotify_api.url_for(kind, item_id), kind=kind, source="spotify-embed", item_id=item_id,
                                 title=title, image=image, total=1 if kind == "track" else total, **common)

    # Spotify link or free text with working Spotify keys → spotDL
    if not spotify_ok:
        raise HTTPException(status_code=400, detail=f"Free-text downloads need Spotify. {spotify_error}")
    if parsed:
        kind = parsed[0]
        query = spotify_api.url_for(*parsed)  # drop ?si= tracking params
        if not title:
            title, image, total = spotify_api.describe(*parsed)
    kind = kind or "track"
    return downloader.submit(query=query, kind=kind, title=title, image=image,
                             total=1 if kind == "track" else total, **common)


@app.get("/api/jobs")
def jobs():
    return {"jobs": downloader.list()}


@app.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str):
    if not downloader.cancel(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
