"""
Download queue: one worker thread runs spotDL jobs one at a time.

Why judge success by files on disk: spotDL exits 0 even when it was stopped or
found nothing, so the exit code alone can't tell "downloaded" from "did nothing".
"""

import itertools
import os
import queue
import re
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

from library import AUDIO_EXTENSIONS, PLAYLIST_FILE

STALL_SECONDS = 300          # no output from spotDL for this long = stuck (e.g. dead credentials)
BASE_TIMEOUT = 900           # plus PER_TRACK_TIMEOUT per expected track
PER_TRACK_TIMEOUT = 90
LOSSLESS = {"flac", "wav"}
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _audio_files(folder: Path):
    if not folder.exists():
        return set()
    return {p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS}


def write_playlist(folder: Path, paths):
    """playlist.m3u8 in the playlist's folder, so songs already owned elsewhere still show up in it, in order."""
    folder.mkdir(parents=True, exist_ok=True)
    lines = ["#EXTM3U"] + [Path(os.path.relpath(p, folder)).as_posix() for p in paths if p]
    tmp = folder / (PLAYLIST_FILE + ".tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.replace(tmp, folder / PLAYLIST_FILE)


def safe_folder_name(name: str):
    """Keep letters, digits and common punctuation; drop path separators and the like."""
    cleaned = "".join(c if c.isalnum() or c in " -_'&.,()!" else "" for c in name)
    return re.sub(r"\s+", " ", cleaned).strip(" .")[:100]


class Downloader:
    def __init__(self, download_dir: Path, on_finished=None, owned_video_ids=None, owned_spotify_ids=None, save_lyrics=None):
        self.download_dir = download_dir
        self.on_finished = on_finished
        self.save_lyrics = save_lyrics  # (audio path, title, artists) -> bool; writes an .lrc when lyrics exist
        # {id: file path} of songs already in the library, by YouTube video id / Spotify track id
        self.owned_video_ids = owned_video_ids or (lambda: {})
        self.owned_spotify_ids = owned_spotify_ids or (lambda: {})
        self.jobs = {}          # id -> job dict (newest last)
        self.queue = queue.Queue()
        self.counter = itertools.count(1)
        self.lock = threading.Lock()
        self.current_process = None
        threading.Thread(target=self._worker, daemon=True).start()

    # ---------- public ----------

    def submit(self, *, query, kind, source="spotify", item_id=None, title=None, image=None, total=None, format="m4a", bitrate="auto", lyrics=False, queries=None):
        job_id = f"{time.strftime('%Y%m%d%H%M%S')}-{next(self.counter)}"
        job = {
            "id": job_id,
            "query": query,
            "queries": queries or [query],  # one spotDL query per song (CSV imports pass many)
            "kind": kind,                # track | album | playlist | artist
            "source": source,            # spotify (spotDL) | ytm (yt-dlp) | spotify-embed (Spotify list → YouTube Music)
            "item_id": item_id,
            "title": title or query,
            "image": image,
            "format": "m4a" if format == "aac" else format,
            "bitrate": bitrate,
            "lyrics": lyrics,
            "status": "queued",          # queued | downloading | completed | failed | cancelled
            "done": 0,
            "total": total,
            "message": "Waiting…",
            "error": None,
            "log": [],
            "created": time.time(),
            "finished": None,
        }
        with self.lock:
            self.jobs[job_id] = job
            # Keep the 50 most recent jobs
            for old in list(self.jobs)[:-50]:
                if self.jobs[old]["status"] not in ("queued", "downloading"):
                    del self.jobs[old]
        self.queue.put(job_id)
        return job

    def list(self):
        with self.lock:
            return [dict(j, log=j["log"][-12:]) for j in reversed(list(self.jobs.values()))]

    def cancel(self, job_id):
        job = self.jobs.get(job_id)
        if not job:
            return False
        if job["status"] == "queued":
            job.update(status="cancelled", message="Cancelled", finished=time.time())
        elif job["status"] == "downloading":
            job["cancel_requested"] = True  # YouTube jobs stop before the next song
            if self.current_process:
                self.current_process.terminate()
        return True

    # ---------- worker ----------

    def _worker(self):
        while True:
            job_id = self.queue.get()
            job = self.jobs.get(job_id)
            if not job or job["status"] != "queued":
                continue
            try:
                self._run(job) if job["source"] == "spotify" else self._run_ytm(job)
            except Exception as e:  # never let one job kill the worker
                job.update(status="failed", error=str(e), message="Failed", finished=time.time())
            if self.on_finished:
                self.on_finished(job)

    def _output_dir(self, job):
        if job["kind"] in ("album", "playlist"):
            name = safe_folder_name(job["title"] or "") or f"{job['kind']}_{job['id'][:8]}"
            return self.download_dir / name
        return self.download_dir

    def _command(self, job, output_dir):
        cmd = [
            sys.executable, "-m", "spotdl", "download", *job.get("queries", [job["query"]]),
            "--output", str(output_dir),
            "--format", job["format"],
            "--force-update-metadata",
            "--ytm-data",
            "--threads", "4",
        ]
        # spotDL's CLI reads no env vars: without these it falls back to its built-in shared keys,
        # which every spotDL user shares and Spotify rate-limits (HTTP 429 → spotDL retries forever)
        client_id, client_secret = os.getenv("SPOTIPY_CLIENT_ID"), os.getenv("SPOTIPY_CLIENT_SECRET")
        if client_id and client_secret:
            cmd += ["--client-id", client_id, "--client-secret", client_secret]
        # "auto" keeps the source quality; re-encoding a ~128-160 kbps YouTube stream to 320 adds size, not quality
        if job["bitrate"] not in (None, "", "auto") and job["format"] not in LOSSLESS:
            cmd += ["--bitrate", f"{job['bitrate']}k"]
        if job["lyrics"]:
            cmd.append("--generate-lrc")
        return cmd

    def _run(self, job):
        output_dir = self._output_dir(job)
        output_dir.mkdir(parents=True, exist_ok=True)
        before = _audio_files(self.download_dir)
        cmd = self._command(job, output_dir)
        job.update(status="downloading", message="Finding songs…", started=time.time())

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.current_process = process
        last_output = [time.time()]
        tail = deque(maxlen=40)
        skipped, not_found = 0, 0
        limit = BASE_TIMEOUT + PER_TRACK_TIMEOUT * (job["total"] or 1)

        def watchdog():
            while process.poll() is None:
                now = time.time()
                if now - last_output[0] > STALL_SECONDS:
                    job["error"] = f"spotDL printed nothing for {STALL_SECONDS // 60} minutes, so it was stopped. Check the Spotify credentials and your connection."
                    process.terminate()
                    return
                if now - job["started"] > limit:
                    job["error"] = f"Took longer than {limit // 60} minutes, so it was stopped."
                    process.terminate()
                    return
                time.sleep(2)

        threading.Thread(target=watchdog, daemon=True).start()

        for raw in process.stdout:  # blocking is fine: this is a worker thread, not the event loop
            line = ANSI.sub("", raw).strip()
            last_output[0] = time.time()
            if not line:
                continue
            tail.append(line)
            if line.startswith("Downloaded"):
                job["message"] = line.split(": http")[0][:140]  # 'Downloaded "Artist - Title": https://…'
            elif "Skipping" in line or "already exists" in line:
                skipped += 1
            elif "LookupError" in line or "No results found" in line:
                not_found += 1
            elif line.startswith("Found") and "songs" in line:
                match = re.search(r"Found (\d+) songs", line)
                if match:
                    job["total"] = int(match.group(1))
            job["done"] = len(_audio_files(output_dir) - before) + skipped
            job["log"] = list(tail)
        process.wait()
        self.current_process = None

        new_files = _audio_files(self.download_dir) - before
        job["done"] = len(new_files) + skipped
        job["new_files"] = len(new_files)
        job["log"] = list(tail)
        job["finished"] = time.time()

        if job.get("cancel_requested"):
            job.update(status="cancelled", message=f"Cancelled after {len(new_files)} songs")
        elif job["error"]:
            job.update(status="failed", message="Stopped")
        elif process.returncode != 0:
            job.update(status="failed", message="Failed", error=_reason(tail) or f"spotDL exited with code {process.returncode}")
        elif not new_files and not skipped:
            job.update(status="failed", message="Nothing downloaded", error=_reason(tail) or "spotDL finished without downloading anything.")
        else:
            parts = []
            if new_files:
                parts.append(f"{len(new_files)} new")
            if skipped:
                parts.append(f"{skipped} already in library")
            if not_found:
                parts.append(f"{not_found} not found")
            job.update(status="completed", message=", ".join(parts))

    def _run_ytm(self, job):
        """YouTube Music job, from a YouTube Music link or a Spotify link (song list from Spotify's embed).

        Each item is {name, spotify_id, resolve()}; resolve() returns the tag data, matching the song
        on YouTube Music first when it came from Spotify. Owned songs are skipped before any matching.
        """
        import ytmusic

        job.update(status="downloading", message="Finding songs\u2026", started=time.time())
        if job.get("queries") and not job.get("item_id"):
            # CSV import: free-text rows matched on YouTube Music (one filtered
            # search each). No Spotify involved, so no keys or quotas.
            metas, missing = [], []
            queries = job["queries"]
            for i, q in enumerate(queries):
                if job.get("cancel_requested"):
                    break
                job.update(message=f"Matching {i + 1} of {len(queries)}\u2026")
                try:
                    hits = ytmusic._call(ytmusic._client().search, q, filter="songs", limit=3) or []
                    hit = next((t for t in (ytmusic._track(h) for h in hits) if t), None)
                except Exception:
                    hit = None
                if not hit:
                    missing.append(q)
                    continue
                metas.append({
                    "video_id": hit["id"], "title": hit["name"],
                    "artists": [a["name"] for a in hit["artists"]] or ["Unknown artist"],
                    "album": (hit["album"] or {}).get("name") or hit["name"],
                    "album_artist": None, "year": None,
                    "track_number": None, "track_total": None,
                    "cover_url": (hit["album"] or {}).get("image"),
                })
            job["queries"] = None  # resolved; don't do this twice
            items = [{"name": f"{', '.join(m['artists'])} - {m['title']}", "spotify_id": None,
                      "video_id": m["video_id"], "resolve": (lambda m=m: m)} for m in metas]
            job["_missing"] = missing
            if not items and missing:
                job.update(status="failed", message="Nothing matched",
                           error=f"No YouTube Music match for: {', '.join(missing[:5])}", finished=time.time())
                return
        elif job["source"] == "spotify-embed":
            title, items, info = ytmusic.spotify_items(job["kind"], job["item_id"])
            if job["kind"] == "playlist" and len(items) >= 100:
                job["note"] = "Spotify's embed lists at most 100 songs, so a longer playlist stops at 100."
        else:
            title, metas = ytmusic.resolve(job["kind"], job["item_id"])
            items = [{"name": f"{', '.join(m['artists'])} - {m['title']}", "spotify_id": None, "video_id": m["video_id"],
                      "resolve": (lambda m=m: m)} for m in metas]
        if title and job["kind"] in ("album", "playlist") and (not job["title"] or job["title"] == job["query"]):
            job["title"] = title
        output_dir = self._output_dir(job)
        owned_videos, owned_spotify = self.owned_video_ids(), self.owned_spotify_ids()
        job["total"] = len(items)
        new, skipped, failed = 0, 0, []
        paths = []  # every song's file, in playlist order, owned ones included
        log = deque(maxlen=40)
        for missing_name in job.pop("_missing", []):
            failed.append(missing_name)
            log.append(f"No YouTube Music match, skipped: {missing_name}")

        for item in items:
            if job.get("cancel_requested"):
                break
            name = item["name"]
            owned = owned_spotify.get(item["spotify_id"]) or owned_videos.get(item.get("video_id"))
            if owned:
                skipped += 1
                paths.append(owned)
                log.append(f"Skipping {name} (already in library)")
            else:
                job["message"] = f"Finding {name}" if item["spotify_id"] else f"Downloading {name}"
                try:
                    meta = item["resolve"]()
                    if meta["video_id"] in owned_videos:
                        skipped += 1
                        paths.append(owned_videos[meta["video_id"]])
                        log.append(f"Skipping {name} (already in library)")
                        job.update(done=new + skipped, log=list(log))
                        continue
                    job["message"] = f"Downloading {name}"
                    path, existed = ytmusic.download_track(meta, output_dir, job["format"], job["bitrate"])
                    paths.append(path)
                    skipped += existed
                    new += not existed
                    log.append(f"{'Skipping' if existed else 'Downloaded'} {name}")
                    if job["lyrics"] and not existed and self.save_lyrics and self.save_lyrics(path, meta["title"], meta["artists"]):
                        log.append(f"Saved lyrics for {name}")
                except Exception as e:
                    failed.append(name)
                    log.append(f"Error: {name}: {str(e)[:200]}")
            job.update(done=new + skipped, log=list(log))

        if job["kind"] in ("album", "playlist") and paths:
            write_playlist(output_dir, paths)
        job["finished"] = time.time()
        job["new_files"] = new
        if job.get("cancel_requested"):
            job.update(status="cancelled", message=f"Cancelled after {new} songs")
        elif not new and not skipped:
            job.update(status="failed", message="Nothing downloaded", error=_reason(log) or "No songs could be downloaded.")
        else:
            parts = [f"{new} new"] if new else []
            if skipped:
                parts.append(f"{skipped} already in library")
            if failed:
                parts.append(f"{len(failed)} failed")
            job.update(status="completed", message=", ".join(parts))
            if failed:
                job["error"] = "Couldn't download: " + "; ".join(failed[:5]) + (" …" if len(failed) > 5 else "")


def _reason(tail):
    """The most useful recent line from spotDL's output."""
    for line in reversed(tail):
        if any(word in line for word in ("Error", "error", "Exception", "Traceback", "No results")):
            return line[:300]
    return tail[-1][:300] if tail else None
