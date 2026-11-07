"""
Local music library, built from the tags spotDL embeds in every file.

Nothing is stored in a database: the downloads/ folder *is* the library.
Each file's tags are read once and cached until its mtime or size changes,
so a rescan of ~250 files costs a few milliseconds after the first one.
"""

import hashlib
import json
import os
import re
import threading
from collections import Counter, OrderedDict
from pathlib import Path

import mutagen

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".flac", ".opus", ".ogg", ".wav", ".aac"}
MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",  # Opus files are Ogg containers; browsers expect audio/ogg
}
SPOTIFY_TRACK_ID = re.compile(r"open\.spotify\.com/track/([A-Za-z0-9]{22})")
# spotDL and our YouTube downloader both put the source URL in the comment tag
YOUTUBE_ID = re.compile(r"(?:[?&]v=|youtu\.be/)([\w-]{11})")
# Folder names spotDL/old versions produced when the album/playlist name lookup failed
# Written by the downloader into a playlist/album folder: every song in order, including songs that
# were already in the library and so live in another folder. Standard m3u8, so VLC etc. read it too.
PLAYLIST_FILE = "playlist.m3u8"
PLAYLISTS_DIR = "Playlists"  # canonical home once Jellyfin mode has converted the library
ALBUM_FILE = ".album.json"  # preserves an album's identity when it includes songs stored elsewhere

JUNK_FOLDER_NAME = re.compile(r"^(https?open|album_\d|playlist_\d|artist_\d)")


class Library:
    def __init__(self, root: Path):
        self.root = root
        self._lock = threading.Lock()
        self._cache = {}  # relative path -> (mtime, size, track dict)
        self._tracks_by_id = {}
        self._playlists = {}  # folder -> [relative track paths] from its playlist.m3u8
        self._albums = {}  # folder -> album identity saved by "Add to album"
        self._covers = OrderedDict()  # (track id, mtime) -> (bytes, mime), LRU

    # ---------- scanning ----------

    def scan(self):
        """Return every track, refreshing tags only for files that changed."""
        with self._lock:
            seen, playlists, albums = {}, {}, {}
            for path in self.root.rglob("*"):
                if path.name == ALBUM_FILE and path.parent.parent == self.root:
                    try:
                        info = json.loads(path.read_text(encoding="utf-8"))
                        if isinstance(info, dict) and isinstance(info.get("name"), str) and isinstance(info.get("artist"), str):
                            albums[path.parent.name] = info
                    except (OSError, ValueError):
                        pass
                    continue
                if path.name == PLAYLIST_FILE and path.parent.parent == self.root:
                    playlists[path.parent.name] = (_read_playlist(path, self.root), path.stat().st_mtime)
                    continue
                # Canonical playlists (Jellyfin mode): Playlists/<Spotify name>.m3u, entries
                # like ../Artist/Album/track.mp3 — _read_playlist normalises those fine.
                if (path.parent.name == PLAYLISTS_DIR and path.parent.parent == self.root
                        and path.suffix.lower() in (".m3u", ".m3u8")):
                    playlists.setdefault(path.stem, (_read_playlist(path, self.root), path.stat().st_mtime))
                    continue
                if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
                    continue
                rel = path.relative_to(self.root).as_posix()
                stat = path.stat()
                cached = self._cache.get(rel)
                if cached and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
                    track = cached[2]
                else:
                    track = _read_track(path, rel, stat)
                    self._cache[rel] = (stat.st_mtime, stat.st_size, track)
                seen[rel] = track
            # Forget deleted files
            for rel in set(self._cache) - set(seen):
                del self._cache[rel]
            tracks = sorted(seen.values(), key=lambda t: t["added"], reverse=True)
            self._tracks_by_id = {t["id"]: t for t in tracks}
            self._playlists = playlists
            self._albums = albums
            return tracks

    def snapshot(self):
        """Library payload for the frontend: tracks plus folder-based collections."""
        tracks = self.scan()
        return {"tracks": tracks, "collections": _collections(tracks, self._playlists, self._albums)}

    def spotify_index(self):
        """{spotify track id: local track id} for marking search results as owned."""
        return {t["spotify_id"]: t["id"] for t in self.scan() if t["spotify_id"]}

    # ---------- lookups ----------

    def youtube_index(self):
        """{youtube video id: local track id}."""
        return {t["youtube_id"]: t["id"] for t in self.scan() if t["youtube_id"]}

    def path_for(self, track_id):
        track = self._tracks_by_id.get(track_id) or {t["id"]: t for t in self.scan()}.get(track_id)
        return (self.root / track["path"]) if track else None

    def cover(self, track_id):
        """Embedded cover art as (bytes, mime), or None."""
        path = self.path_for(track_id)
        if not path or not path.exists():
            return None
        key = (track_id, path.stat().st_mtime)
        if key in self._covers:
            self._covers.move_to_end(key)
            return self._covers[key]
        art = _read_cover(path)
        if art:
            self._covers[key] = art
            if len(self._covers) > 400:  # ~100 KB each, so this caps memory around 40 MB
                self._covers.popitem(last=False)
        return art


# ---------- tag reading ----------

def _first(tags, key):
    value = tags.get(key) if tags else None
    if isinstance(value, list):
        return str(value[0]) if value else None
    return str(value) if value else None


def _read_track(path: Path, rel: str, stat):
    # Filenames are "{artists} - {title}.ext"; used only when tags are missing
    stem = path.stem
    fallback_artist, _, fallback_title = stem.partition(" - ")
    if not fallback_title:
        fallback_artist, fallback_title = "", stem

    title, artists, album, album_artist, date, duration, genre_tag = fallback_title, [], None, None, None, 0, None
    spotify_id, youtube_id, has_cover, bitrate, lossless = None, None, False, 0, path.suffix.lower() in (".flac", ".wav")
    try:
        easy = mutagen.File(path, easy=True)
        if easy is not None:
            tags = easy.tags or {}
            title = _first(tags, "title") or fallback_title
            artists = [str(a) for a in tags.get("artist", [])] if tags else []
            album = _first(tags, "album")
            album_artist = _first(tags, "albumartist")
            date = _first(tags, "date")
            genre_tag = _first(tags, "genre")
            duration = round(getattr(easy.info, "length", 0) or 0, 2)
            bitrate = round((getattr(easy.info, "bitrate", 0) or 0) / 1000)
            lossless = lossless or getattr(easy.info, "codec", None) == "alac"
        full = mutagen.File(path)
        if full is not None:
            spotify_id = _find_spotify_id(full)
            youtube_id = _find_youtube_id(full)
            has_cover = _has_cover(full)
    except Exception:
        pass  # unreadable tags: keep filename-based fallbacks

    if not artists:
        artists = [a.strip() for a in fallback_artist.split(",") if a.strip()] or ["Unknown artist"]
    parts = rel.split("/")
    return {
        "id": hashlib.sha1(rel.encode()).hexdigest()[:16],
        "path": rel,
        "folder": parts[0] if len(parts) > 1 else None,
        "title": title,
        "artists": artists,
        "album": album or title,
        "album_artist": album_artist or artists[0],
        "year": (date or "")[:4] or None,
        "duration": duration,
        "added": stat.st_mtime,
        "size": stat.st_size,
        "spotify_id": spotify_id,
        "youtube_id": youtube_id,
        "has_cover": has_cover,
        "bitrate": bitrate,     # kbps; 0 when unknown
        "lossless": lossless,   # FLAC, WAV or Apple Lossless
        "genre_tag": genre_tag,  # spotDL's Spotify genre, when present; see genres.py
    }


def _find_spotify_id(audio):
    """spotDL stores the track's Spotify URL in a WOAS tag (----:spotdl:WOAS in M4A)."""
    for key, value in (audio.tags or {}).items():
        if "woas" not in str(key).lower():
            continue
        values = value if isinstance(value, list) else [value]
        for v in values:
            if isinstance(v, (bytes, bytearray)):  # MP4FreeForm is a bytes subclass
                raw = bytes(v).decode(errors="ignore")
            else:  # ID3 WOAS frame has .url; Vorbis comments are plain strings
                raw = str(getattr(v, "url", v))
            match = SPOTIFY_TRACK_ID.search(raw)
            if match:
                return match.group(1)
    return None


def _find_youtube_id(audio):
    """The YouTube video id from the comment tag: ©cmt (M4A), COMM (ID3) or comment (Vorbis)."""
    tags = audio.tags or {}
    candidates = []
    for key, value in tags.items():
        k = str(key).lower()
        if k in ("©cmt", "comment", "description") or k.startswith("comm"):
            values = value if isinstance(value, list) else [value]
            candidates += [str(getattr(v, "text", [v])[0] if hasattr(v, "text") else v) for v in values]
    for text in candidates:
        match = YOUTUBE_ID.search(text)
        if match:
            return match.group(1)
    return None


def _has_cover(audio):
    tags = audio.tags or {}
    if "covr" in tags:  # MP4
        return True
    if any(str(k).startswith("APIC") for k in tags.keys()):  # MP3 (ID3)
        return True
    if getattr(audio, "pictures", None):  # FLAC
        return True
    return "metadata_block_picture" in tags  # Ogg/Opus


def _read_cover(path: Path):
    try:
        audio = mutagen.File(path)
        tags = audio.tags or {}
        if "covr" in tags and tags["covr"]:
            cover = tags["covr"][0]
            mime = "image/png" if cover.imageformat == 14 else "image/jpeg"  # MP4Cover.FORMAT_PNG == 14
            return bytes(cover), mime
        for key in tags.keys():
            if str(key).startswith("APIC"):
                return tags[key].data, tags[key].mime or "image/jpeg"
        if getattr(audio, "pictures", None):
            picture = audio.pictures[0]
            return picture.data, picture.mime or "image/jpeg"
        if "metadata_block_picture" in tags:
            import base64
            from mutagen.flac import Picture
            picture = Picture(base64.b64decode(tags["metadata_block_picture"][0]))
            return picture.data, picture.mime or "image/jpeg"
    except Exception:
        return None
    return None


# ---------- collections ----------

def _read_playlist(path: Path, root: Path):
    """Entries of an m3u8 as paths relative to the library root (entries outside the library are dropped)."""
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        line = line.strip().replace("\\", "/")
        if not line or line.startswith("#"):
            continue
        rel = os.path.normpath(os.path.join(path.parent.name, line)).replace(os.sep, "/")
        if not rel.startswith("../"):
            out.append(rel)
    return out


def _collections(tracks, playlists=None, album_overrides=None):
    """One collection per top-level folder: an album if every track shares an album tag, else a playlist.

    A folder's playlist.m3u8 (when there is one) sets the order and can pull in songs from other folders.
    A folder with an m3u8 and no audio of its own is a playlist you made, unless .album.json preserves
    its album identity. Your playlists stay listed while empty and are "editable" (songs can be added
    and removed; deleting the playlist never touches the songs).
    """
    playlists = playlists or {}
    album_overrides = album_overrides or {}
    folders, by_path = {}, {t["path"]: t for t in tracks}
    for track in tracks:
        if track["folder"]:
            folders.setdefault(track["folder"], []).append(track)

    collections = []
    for folder in set(folders) | set(playlists):
        own = sorted(folders.get(folder, []), key=lambda t: t["path"])
        entries, listed_at = playlists.get(folder, ([], 0))
        album_info = album_overrides.get(folder)
        editable = folder in playlists and not own and not album_info
        listed = list({t["id"]: t for t in (by_path.get(r) for r in entries) if t}.values())
        listed_ids = {t["id"] for t in listed}
        items = listed + [t for t in own if t["id"] not in listed_ids]  # files not in the m3u8 go last
        if not items and not editable:
            continue
        albums = Counter(t["album"] for t in items)
        is_album = bool(album_info) or len(albums) == 1 and not editable
        name = folder
        if album_info:
            name = album_info["name"]
        elif editable:
            pass  # your name, even if every song happens to be from one album
        elif is_album and (JUNK_FOLDER_NAME.match(folder) or len(items) > 1):
            name = items[0]["album"]
        elif JUNK_FOLDER_NAME.match(folder):
            name = albums.most_common(1)[0][0]

        covers, seen_albums = [], set()
        for track in items:
            if track["has_cover"] and track["album"] not in seen_albums:
                covers.append(track["id"])
                seen_albums.add(track["album"])
            if len(covers) == 4:
                break

        collections.append({
            "key": folder,
            "name": name,
            "kind": "album" if is_album else "playlist",
            "artist": album_info["artist"] if album_info else items[0]["album_artist"] if is_album else None,
            "year": album_info.get("year") if album_info else items[0]["year"] if is_album else None,
            "track_ids": [t["id"] for t in items],
            "cover_ids": covers[:1] if is_album else covers,
            "duration": round(sum(t["duration"] for t in items)),
            "added": max([t["added"] for t in items] + [listed_at if editable else 0]),
            "editable": editable,
        })
    collections.sort(key=lambda c: c["added"], reverse=True)
    return collections
