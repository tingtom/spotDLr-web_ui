"""
Organizing the library: likes, your own playlists, adding files, real albums, and sending to a device.

- Likes: {track id: when} in likes.json (data folder).
- Your playlists are folders that hold only a playlist.m3u8 pointing at songs elsewhere, so nothing is
  copied. Downloaded playlists can also receive songs through their playlist.m3u8, without copying audio.
- Adding files streams each upload straight to disk. "As an album" writes album / album artist / year /
  cover into the files themselves, so any player groups them.
- Sending to a device copies files onto a USB drive or MP3 player, optionally converting to MP3, since
  many players can't play .m4a (AAC), which is what spotDLr downloads.
"""

import base64
import json
import os
import shutil
import string
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from downloader import safe_folder_name, write_playlist
from library import ALBUM_FILE, AUDIO_EXTENSIONS, PLAYLIST_FILE, PLAYLISTS_DIR

MAX_UPLOAD = 2 * 1024**3   # 2 GB per file: anything bigger isn't a song
MP3_BITRATES = (128, 192, 256, 320)


class OrganizeError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _unique(path: Path):
    """path, or 'name (2).ext', 'name (3).ext'… if it's taken."""
    if not path.exists():
        return path
    for n in range(2, 1000):
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
        if not candidate.exists():
            return candidate
    raise OrganizeError("Too many files with that name")


def _atomic_json(path: Path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    os.replace(tmp, path)


# ---------- likes ----------

class Likes:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.data = {}

    def ids(self):
        with self.lock:
            return sorted(self.data, key=self.data.get, reverse=True)  # newest like first, like Spotify

    def set(self, track_id, liked):
        with self.lock:
            if liked:
                self.data.setdefault(track_id, time.time())
            else:
                self.data.pop(track_id, None)
            _atomic_json(self.path, self.data)

    def merge(self, old_ids, new_id):
        """Duplicates merged into new_id: liked if any copy was, keeping the earliest like."""
        with self.lock:
            when = [self.data.pop(i) for i in old_ids if i in self.data]
            if when:
                self.data[new_id] = min(when + ([self.data[new_id]] if new_id in self.data else []))
                _atomic_json(self.path, self.data)


# ---------- your playlists ----------

def open_location(music_dir: Path, path: Path):
    """Reveal a library file on Mac, or open its containing folder on other desktops."""
    if not path.exists():
        raise OrganizeError("This file or folder is no longer in your library. Refresh and try again.", 404)
    if not path.resolve().is_relative_to(music_dir.resolve()):
        raise OrganizeError("Only locations inside your music folder can be opened", 403)
    try:
        if sys.platform == "win32":
            os.startfile(str(path if path.is_dir() else path.parent))
        else:
            if sys.platform == "darwin":
                command = ["/usr/bin/open", str(path)] if path.is_dir() else ["/usr/bin/open", "-R", str(path)]
            else:
                command = ["xdg-open", str(path if path.is_dir() else path.parent)]
            subprocess.run(command, check=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as error:
        raise OrganizeError("Couldn't open the folder. Try opening it in your computer's file manager.", 500) from error


def is_user_playlist(folder: Path):
    """Made in spotDLr: a playlist.m3u8 and no audio files of its own."""
    if not (folder / PLAYLIST_FILE).exists() or (folder / ALBUM_FILE).exists():
        return False
    return not any(p.suffix.lower() in AUDIO_EXTENSIONS for p in folder.iterdir() if p.is_file())


def create_playlist(music_dir: Path, name, paths):
    folder_name = safe_folder_name(name or "")
    if not folder_name:
        raise OrganizeError("Give the playlist a name")
    folder = music_dir / folder_name
    if folder.exists():
        raise OrganizeError(f'There\'s already a playlist or album called "{folder_name}"', 409)
    write_playlist(folder, paths)
    return folder_name


def user_playlist(music_dir: Path, key):
    # Canonical form (Jellyfin mode): Playlists/<key>.m3u with no folder at all.
    if (music_dir / PLAYLISTS_DIR / f"{key}.m3u").exists():
        if "/" in key or key in (".", ".."):
            raise OrganizeError("No such playlist", 404)
        return music_dir / key  # callers route through write_playlist/rename/delete below
    folder = music_dir / key
    if folder.parent != music_dir or not folder.is_dir() or not is_user_playlist(folder):
        raise OrganizeError("Only playlists you made in spotDLr can be changed", 403)
    return folder


def rename_playlist(music_dir: Path, key, name):
    """Renames the playlist: its canonical Playlists/<name>.m3u file, or (legacy) its folder —
    playlist.m3u8 uses paths relative to the folder, and the folder stays at the same depth,
    so every entry still points at the same song."""
    folder = user_playlist(music_dir, key)
    new_name = safe_folder_name(name or "")
    if not new_name:
        raise OrganizeError("Give the playlist a name")
    if new_name == key:
        return key
    modern = music_dir / PLAYLISTS_DIR / f"{key}.m3u"
    if modern.exists():
        target = music_dir / PLAYLISTS_DIR / f"{new_name}.m3u"
        if target.exists():
            raise OrganizeError(f'There\'s already a playlist or album called "{new_name}"', 409)
        modern.rename(target)
        return new_name
    target = music_dir / new_name
    if target.exists() and target.resolve() != folder.resolve():  # (a case-only rename on macOS is the same folder)
        raise OrganizeError(f'There\'s already a playlist or album called "{new_name}"', 409)
    folder.rename(target)
    return new_name


def delete_playlist(music_dir: Path, key):
    """Removes the playlist, never the songs: the list is all there is."""
    folder = user_playlist(music_dir, key)
    modern = music_dir / PLAYLISTS_DIR / f"{key}.m3u"
    if modern.exists():
        modern.unlink()
        return
    (folder / PLAYLIST_FILE).unlink()
    try:
        folder.rmdir()
    except OSError:
        pass  # something else (a cover image, .DS_Store) is in there: leave the folder


def add_to_album(music_dir: Path, collection, paths):
    """Group existing files under an album without moving audio or rewriting its tags."""
    folder = music_dir / collection["key"]
    if folder.parent != music_dir or folder.resolve().parent != music_dir.resolve() or not folder.is_dir():
        raise OrganizeError("This album is outside your music folder", 403)
    if any(not path.is_file() or not path.resolve().is_relative_to(music_dir.resolve()) for path in paths):
        raise OrganizeError("A song is missing or outside your music folder. Refresh and try again.", 400)
    info = {key: collection[key] for key in ("name", "artist", "year")}
    _atomic_json(folder / ALBUM_FILE, info)
    write_playlist(folder, paths)


# ---------- adding files ----------

async def import_stream(music_dir: Path, filename, folder_name, chunks):
    """Write one uploaded file (an async iterator of byte chunks, straight from the request) into the
    library. Returns its relative path. Streams to disk, so a 100 MB FLAC never sits in memory."""
    name = Path(filename or "").name
    if Path(name).suffix.lower() not in AUDIO_EXTENSIONS:
        raise OrganizeError(f'"{name}" isn\'t a music file spotDLr can play ({", ".join(sorted(AUDIO_EXTENSIONS))})', 415)
    folder = music_dir
    if folder_name:
        safe = safe_folder_name(folder_name)
        if not safe:
            raise OrganizeError("That album name has no usable characters")
        folder = music_dir / safe
    folder.mkdir(parents=True, exist_ok=True)
    target = _unique(folder / name)
    tmp = target.with_name(f".{target.name}.{uuid.uuid4().hex[:8]}.part")  # hidden + not an audio suffix: the library skips it
    size = 0
    try:
        with open(tmp, "wb") as out:
            async for chunk in chunks:
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise OrganizeError("That file is over 2 GB", 413)
                out.write(chunk)
        if size == 0:
            raise OrganizeError(f'"{name}" is empty')
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink()
    return target.relative_to(music_dir).as_posix()


def tag_album(path: Path, album, album_artist, year=None, cover=None):
    """Write album, album artist, year and cover into one file. cover = (bytes, mime) or None.
    Returns False for formats without tags (WAV)."""
    import mutagen

    easy = mutagen.File(path, easy=True)
    if easy is None:
        return False
    if easy.tags is None:
        easy.add_tags()
    stem_artist, _, stem_title = path.stem.partition(" - ")
    if not easy.tags.get("title"):
        easy.tags["title"] = stem_title or path.stem
    if not easy.tags.get("artist"):
        easy.tags["artist"] = (stem_artist if stem_title else None) or album_artist
    easy.tags["album"] = album
    easy.tags["albumartist"] = album_artist
    if year:
        easy.tags["date"] = str(year)
    easy.save()
    if cover:
        _write_cover(path, *cover)
    return True


def _write_cover(path: Path, data, mime):
    import mutagen
    from mutagen.flac import FLAC, Picture
    from mutagen.id3 import APIC, ID3, ID3NoHeaderError
    from mutagen.mp4 import MP4, MP4Cover

    suffix = path.suffix.lower()
    if suffix in (".m4a", ".mp4", ".aac"):
        audio = MP4(path)
        fmt = MP4Cover.FORMAT_PNG if mime == "image/png" else MP4Cover.FORMAT_JPEG
        audio.tags["covr"] = [MP4Cover(data, imageformat=fmt)]
        audio.save()
    elif suffix == ".mp3":
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        tags.delall("APIC")
        tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data))
        tags.save(path)
    elif suffix in (".flac", ".ogg", ".opus"):
        picture = Picture()
        picture.type, picture.mime, picture.data = 3, mime, data
        if suffix == ".flac":
            audio = FLAC(path)
            audio.clear_pictures()
            audio.add_picture(picture)
        else:  # Ogg: the picture goes in a base64 comment
            audio = mutagen.File(path)
            audio["metadata_block_picture"] = [base64.b64encode(picture.write()).decode("ascii")]
        audio.save()


def _remove_cover(path: Path):
    import mutagen
    from mutagen.flac import FLAC
    from mutagen.id3 import ID3, ID3NoHeaderError
    from mutagen.mp4 import MP4

    suffix = path.suffix.lower()
    if suffix in (".m4a", ".mp4", ".aac"):
        audio = MP4(path)
        if audio.tags and "covr" in audio.tags:
            del audio.tags["covr"]
            audio.save()
    elif suffix == ".mp3":
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            return
        tags.delall("APIC")
        tags.save(path)
    elif suffix == ".flac":
        audio = FLAC(path)
        audio.clear_pictures()
        audio.save()
    elif suffix in (".ogg", ".opus"):
        audio = mutagen.File(path)
        if audio and "metadata_block_picture" in audio:
            del audio["metadata_block_picture"]
            audio.save()


# ---------- devices ----------

def list_devices():
    """Drives an MP3 player or USB stick shows up as: [{name, path, free, total}]."""
    found = []
    if sys.platform == "win32":
        import ctypes
        kernel = ctypes.windll.kernel32
        mask = kernel.GetLogicalDrives()
        system = os.environ.get("SystemDrive", "C:").upper()
        for i, letter in enumerate(string.ascii_uppercase):
            root = f"{letter}:\\"
            if not mask >> i & 1 or f"{letter}:" == system:
                continue
            if kernel.GetDriveTypeW(root) != 2:  # DRIVE_REMOVABLE: USB sticks and most players
                continue
            label = ctypes.create_unicode_buffer(261)
            kernel.GetVolumeInformationW(root, label, 261, None, None, None, None, 0)
            found.append((label.value or "USB drive", root))
    elif sys.platform == "darwin":
        for entry in sorted(Path("/Volumes").iterdir()) if Path("/Volumes").exists() else []:
            if os.path.realpath(entry) == "/" or not os.path.ismount(entry):
                continue  # the Mac's own disk is linked here too
            found.append((entry.name, str(entry)))
    else:
        for base in (Path("/media") / os.environ.get("USER", ""), Path("/run/media") / os.environ.get("USER", "")):
            if base.is_dir():
                found += [(p.name, str(p)) for p in sorted(base.iterdir()) if os.path.ismount(p)]
    devices = []
    for name, path in found:
        try:
            usage = shutil.disk_usage(path)
        except OSError:
            continue  # card reader with no card, etc.
        devices.append({"name": name, "path": path, "free": usage.free, "total": usage.total})
    return devices


# ---------- sending to a device ----------

def _id3_v23(path: Path):
    """Rewrite an MP3's tags as ID3v2.3. Many MP3 players only read v2.3 and show v2.4 as "Unknown artist";
    mutagen writes v2.4 by default."""
    from mutagen.id3 import ID3, ID3NoHeaderError
    try:
        tags = ID3(path)
    except ID3NoHeaderError:
        return
    tags.update_to_v23()
    tags.save(path, v2_version=3)

class Exporter:
    """One copy job at a time per request, run on a thread; progress is polled by the page."""

    def __init__(self, ffmpeg_path):
        self.ffmpeg_path = ffmpeg_path
        self.jobs = {}
        self.lock = threading.Lock()

    def start(self, items, destination, subfolder, collection, fmt, bitrate):
        """items: [(absolute source path, duration seconds)] in order."""
        dest_root = Path(destination)
        if not dest_root.is_dir():
            raise OrganizeError("That device isn't connected anymore. Plug it in and pick it again.", 404)
        if fmt not in ("original", "mp3"):
            raise OrganizeError("Format must be original or mp3")
        if fmt == "mp3" and bitrate not in MP3_BITRATES:
            raise OrganizeError(f"MP3 quality must be one of {MP3_BITRATES} kbps")
        if fmt == "mp3" and not self.ffmpeg_path():
            raise OrganizeError("Converting to MP3 needs FFmpeg, which isn't installed", 500)
        parts = [safe_folder_name(p) for p in (subfolder, collection) if p and safe_folder_name(p)]
        folder = dest_root.joinpath(*parts)
        # Will it fit? MP3 size = bitrate × duration; originals are their own size
        need = sum(bitrate * 1000 / 8 * duration if fmt == "mp3" and src.suffix.lower() != ".mp3" else src.stat().st_size
                   for src, duration in items)
        free = shutil.disk_usage(dest_root).free
        if need > free:
            raise OrganizeError(f"Not enough space on the device: needs about {need / 1e6:,.0f} MB, {free / 1e6:,.0f} MB free", 507)
        job = {"id": uuid.uuid4().hex[:12], "status": "copying", "done": 0, "total": len(items), "skipped": 0,
               "current": None, "error": None, "folder": str(folder), "started": time.time()}
        with self.lock:
            self.jobs[job["id"]] = job
        threading.Thread(target=self._run, args=(job, items, folder, fmt, bitrate, collection), daemon=True).start()
        return job

    def get(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            return dict(job) if job else None

    def _run(self, job, items, folder, fmt, bitrate, collection):
        try:
            folder.mkdir(parents=True, exist_ok=True)
            numbered = bool(collection) and len(items) > 1
            for index, (src, _) in enumerate(items, 1):
                convert = fmt == "mp3" and src.suffix.lower() != ".mp3"
                ext = ".mp3" if convert else src.suffix.lower()
                # Players sort by filename, so a number keeps the playlist/album order
                name = f"{index:02d} {src.stem}{ext}" if numbered else f"{src.stem}{ext}"
                target = folder / name
                job["current"] = src.stem
                if target.exists() and target.stat().st_size > 0:
                    job["skipped"] += 1  # already on the device: sending again only adds what's new
                else:
                    tmp = target.with_name(f".{target.name}.part")  # unplugged halfway = no broken file left behind
                    try:
                        if convert:
                            self._to_mp3(src, tmp, bitrate)
                        else:
                            shutil.copyfile(src, tmp)
                            if fmt == "mp3" and ext == ".mp3":
                                _id3_v23(tmp)  # already MP3: same audio, tags older players can read
                        os.replace(tmp, target)
                    finally:
                        if tmp.exists():
                            tmp.unlink()
                job["done"] = index
            job.update(status="done", current=None, finished=time.time())
        except OSError as e:
            reason = "The device is full" if getattr(e, "errno", None) == 28 else \
                     "The device was unplugged or can't be written to" if not folder.parent.exists() else str(e)
            job.update(status="failed", error=reason, current=None)
        except Exception as e:  # ffmpeg errors etc.: report, never crash the thread silently
            job.update(status="failed", error=str(e)[:300], current=None)

    def _to_mp3(self, src: Path, out: Path, bitrate):
        # Keep tags and the cover (as ID3v2.3, which older players read); -f mp3 because out ends in .part
        cmd = [self.ffmpeg_path(), "-v", "error", "-y", "-i", str(src), "-map", "0:a:0", "-map", "0:v:0?",
               "-c:a", "libmp3lame", "-b:a", f"{bitrate}k", "-c:v", "copy", "-disposition:v:0", "attached_pic",
               "-map_metadata", "0", "-id3v2_version", "3", "-f", "mp3", str(out)]
        flags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW: no console flashing up
        result = subprocess.run(cmd, capture_output=True, text=True, creationflags=flags, timeout=600)
        if result.returncode != 0:
            raise RuntimeError(f"Couldn't convert {src.name}: {result.stderr.strip()[-200:]}")
