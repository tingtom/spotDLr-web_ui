"""Jellyfin music-library layout for spotDLr downloads.

Docs: https://jellyfin.org/docs/general/server/media/music/
- One folder per album, under an artist folder: Music/Artist/Album/track.ext
- Filenames only need the illegal characters gone (< > : " / \\ | ? *); metadata
  comes from the tags, which spotDLr already embeds.
- Lyrics (.lrc) sit beside their track with the same filename.
- Playlists are .m3u files inside the library's Playlists/ folder.

Enabling runs a conversion that re-files existing downloads into that layout and
writes Playlists/<Spotify playlist name>.m3u for every playlist. The original
playlist.m3u8 files in the old playlist folders are left untouched.
"""

import json
import logging
import shutil
import threading
from pathlib import Path

from mutagen import File as MutagenFile

logger = logging.getLogger(__name__)

ILLEGAL = set('<>:"/\\|?*')
AUDIO = {'.mp3', '.m4a', '.ogg', '.opus', '.flac', '.wav', '.aac', '.wma', '.aiff', '.alac'}


def safe_name(name: str) -> str:
    """Strip the characters Jellyfin's docs flag as problematic."""
    cleaned = "".join(ch for ch in (name or "") if ch not in ILLEGAL).strip(" .")
    return cleaned or "Unknown"


class JellyfinLibrary:
    def __init__(self, root: Path, data_dir: Path):
        self.root = Path(root)
        self.state_file = data_dir / "jellyfin.json"
        self._lock = threading.Lock()
        self.status = {"running": False, "state": "idle", "moved": 0, "total": 0,
                       "playlists": 0, "errors": 0, "message": ""}
        try:
            self.enabled = bool(json.loads(self.state_file.read_text(encoding="utf-8")).get("enabled"))
        except (OSError, ValueError):
            self.enabled = False

    # ---------- state ----------

    def _save(self) -> None:
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps({"enabled": self.enabled}), encoding="utf-8")
        tmp.replace(self.state_file)

    def set_enabled(self, on: bool) -> None:
        self.enabled = bool(on)
        self._save()

    def snapshot(self) -> dict:
        return {"enabled": self.enabled, **self.status}

    # ---------- conversion ----------

    def playlist_collections(self) -> list[dict]:
        """Top-level folders that hold a playlist.m3u8 — name = the Spotify playlist name.
        Once converted the folder has no audio left; recover the file list from the
        canonical Playlists/<name>.m3u so a re-run can still clean up the legacy list."""
        out = []
        playlists_dir = self.root / "Playlists"
        for folder in sorted(self.root.iterdir()) if self.root.is_dir() else []:
            if not folder.is_dir() or folder.name == "Playlists":
                continue
            if not (folder / "playlist.m3u8").exists():
                continue
            paths = [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO]
            if not paths:
                modern = playlists_dir / f"{folder.name}.m3u"
                if modern.exists():
                    for line in modern.read_text(encoding="utf-8-sig").splitlines():
                        line = line.strip().replace("\\", "/")
                        if not line or line.startswith("#"):
                            continue
                        candidate = (playlists_dir / line).resolve()
                        if not candidate.is_file():
                            candidate = (self.root / line.lstrip("./")).resolve()
                        if candidate.is_file() and candidate.suffix.lower() in AUDIO:
                            paths.append(candidate)
            out.append({"name": folder.name, "paths": paths})
        return out

    def start(self, collections: list[dict] | None = None) -> bool:
        with self._lock:
            if self.status["running"]:
                return False
            self.status.update(running=True, state="converting", moved=0, errors=0,
                               playlists=0, total=0, message="")
        thread = threading.Thread(target=self._run, args=(collections,), daemon=True)
        thread.start()
        return True

    @staticmethod
    def _tags(path: Path) -> tuple[list[str], str | None]:
        try:
            audio = MutagenFile(path, easy=True)
            if audio is None or audio.tags is None:
                return [], None
            artists = audio.get("artist") or []
            if isinstance(artists, str):
                artists = [artists]
            album = audio.get("album")
            if isinstance(album, list):
                album = album[0] if album else None
            return [str(a) for a in artists if str(a).strip()], str(album) if album else None
        except Exception:
            return [], None

    def _target(self, path: Path) -> Path:
        artists, album = self._tags(path)
        artist = safe_name(artists[0] if artists else "Unknown Artist")
        album_dir = safe_name(album if album else "Unknown Album")
        target_dir = self.root / artist / album_dir
        target = target_dir / safe_name(path.name)
        if target == path:
            return path
        if not target.exists():
            return target
        stem, suffix = target.stem, target.suffix
        n = 2
        while (target_dir / f"{stem} ({n}){suffix}").exists():
            n += 1
        return target_dir / f"{stem} ({n}){suffix}"

    def _run(self, collections: list[dict] | None) -> None:
        moved_map: dict[Path, Path] = {}
        try:
            files = [p for p in self.root.rglob("*")
                     if p.is_file() and p.suffix.lower() in AUDIO
                     and "Playlists" not in p.parts]
            self.status["total"] = len(files)
            for path in files:
                target = self._target(path)
                if target == path:
                    continue
                try:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(path), str(target))
                    moved_map[path] = target
                    # lyrics travel with their track (same stem, same folder rule)
                    for ext in (".lrc", ".elrc", ".txt"):
                        sibling = path.with_suffix(ext)
                        if sibling.exists():
                            shutil.move(str(sibling), str(target.with_suffix(ext)))
                    self.status["moved"] += 1
                except OSError as exc:
                    self.status["errors"] += 1
                    logger.warning("jellyfin move failed for %s: %s", path, exc)

            # Playlists/<Spotify name>.m3u — entries relative to the Playlists folder
            if collections:
                playlists_dir = self.root / "Playlists"
                playlists_dir.mkdir(exist_ok=True)
                for coll in collections:
                    try:
                        lines = ["#EXTM3U"]
                        for old in coll.get("paths", []):
                            new = moved_map.get(old, old)
                            if not new.exists():
                                continue
                            # Library-root relative (no ../): Jellyfin resolves playlist
                            # entries against the library root, spotDLr accepts both forms.
                            lines.append(new.relative_to(self.root).as_posix())
                        if len(lines) == 1:
                            continue
                        (playlists_dir / f"{safe_name(coll['name'])}.m3u").write_text(
                            "\n".join(lines) + "\n", encoding="utf-8")
                        self.status["playlists"] += 1
                        # One file per playlist, the properly named one: drop the legacy
                        # playlist.m3u8 (its paths went stale when the audio moved) and the
                        # now-empty playlist folder. spotDLr reads Playlists/<name>.m3u.
                        legacy = self.root / coll["name"] / "playlist.m3u8"
                        if legacy.exists():
                            try:
                                legacy.unlink()
                                legacy.parent.rmdir()  # only succeeds when nothing else remains
                            except OSError:
                                pass
                    except ValueError:
                        # file lives outside the library root: fall back to absolute path
                        pass
                    except OSError as exc:
                        self.status["errors"] += 1
                        logger.warning("playlist write failed for %s: %s", coll.get("name"), exc)
            self.status.update(state="done",
                               message=f"Moved {self.status['moved']} files, "
                                       f"wrote {self.status['playlists']} playlists"
                                       + (f", {self.status['errors']} errors" if self.status["errors"] else ""))
        except Exception as exc:  # never die silently: surface it in status
            logger.exception("jellyfin conversion failed")
            self.status.update(state="error", message=str(exc)[:200])
        finally:
            with self._lock:
                self.status["running"] = False
