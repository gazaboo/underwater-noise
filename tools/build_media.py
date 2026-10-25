# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "requests", "scipy", "json5"]
# ///
"""
Catalogue des médias de la carte : extraits de vrais enregistrements et photos, avec leur provenance.

Entrée : tools/media_sources.json5, écrit à la main. Chaque entrée dit d'où vient l'extrait (source, auteur,
date, lieu, hydrophone, licence ou accord), où le couper et comment le préparer.

Pour chaque son :
  1. téléchargement d'un **petit extrait** seulement, mis en cache dans tools/.cache/media :
     - `wav-range` : requête HTTP par plage d'octets dans un WAV PCM (fichiers journaliers MBARI de 24 h :
       on ne lit que les secondes voulues) ;
     - `file` : fichier court (mp3, ogg, wav…), décodé par ffmpeg puis coupé ;
  2. spectrogramme calculé sur l'extrait **original** (avant filtrage), en niveaux de gris : le client le
     colore et trace les axes ;
  3. préparation : passe-haut, passe-bas éventuel, fondus, normalisation de crête [E] ;
  4. encodage Opus (.ogg) et AAC (.m4a, repli pour les navigateurs sans Opus).

La hauteur n'est **jamais** modifiée ici : les fichiers gardent la hauteur d'origine. La transposition des
infrasons (`audio.whales.transpose`) se fait à la lecture et reste un choix artistique [A].

Pour chaque photo (section `photos`, fichiers de Wikimedia Commons) : auteur, licence et date sont lus dans les
métadonnées de Commons (jamais recopiés à la main), vignette de 960 px convertie en WebP.

Sortie : data/media/sons/<id>.ogg, .m4a, <id>.spectro.png, data/media/photos/<id>.webp, data/media/catalog.json (vérifié par
shared/test/media.test.ts) et docs/MEDIAS.md (table de provenance).

Usage :
  uv run tools/build_media.py            # tous les médias
  uv run tools/build_media.py orca-s19   # un seul (les autres entrées du catalogue sont conservées)
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

import json5
import numpy as np
import requests
from PIL import Image
from scipy import signal
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "tools" / "media_sources.json5"
CACHE = ROOT / "tools" / ".cache" / "media"
OUT = ROOT / "data" / "media"
SOUNDS = OUT / "sons"
PHOTOS = OUT / "photos"
PHOTO_W = 960
UA = {"User-Agent": "carte-du-vacarme/0.1 (projet de vulgarisation non commercial)"}

SPECTRO_W, SPECTRO_H = 640, 160


# --- Téléchargement -------------------------------------------------------------------------------------------

def wav_header(url: str) -> tuple[int, int, int, int]:
    """(fréquence d'échantillonnage, canaux, bits, position des données) d'un WAV PCM distant."""
    head = requests.get(url, headers={"Range": "bytes=0-65535"}, timeout=60).content
    if head[:4] != b"RIFF" or head[8:12] != b"WAVE":
        raise ValueError(f"pas un WAV : {url}")
    i, fmt = 12, None
    while i + 8 <= len(head):
        cid, size = head[i:i + 4], struct.unpack("<I", head[i + 4:i + 8])[0]
        if cid == b"fmt ":
            tag, ch, sr, _, _, bits = struct.unpack("<HHIIHH", head[i + 8:i + 24])
            if tag != 1:
                raise ValueError(f"WAV non PCM ({tag}) : {url}")
            fmt = (sr, ch, bits)
        if cid == b"data":
            if fmt is None:
                raise ValueError(f"bloc fmt absent : {url}")
            return (*fmt, i + 8)
        i += 8 + size + (size & 1)
    raise ValueError(f"bloc data introuvable dans les 64 premiers ko : {url}")


def pcm_to_float(raw: bytes, bits: int, ch: int) -> np.ndarray:
    if bits == 16:
        x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768
    elif bits == 24:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        x = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float32) / (1 << 23)
    elif bits == 32:
        x = np.frombuffer(raw, "<i4").astype(np.float32) / (1 << 31)
    else:
        raise ValueError(f"{bits} bits non pris en charge")
    return x.reshape(-1, ch).mean(axis=1)


def fetch_wav_range(sid: str, f: dict) -> tuple[np.ndarray, int]:
    sr, ch, bits, data = wav_header(f["url"])
    frame = ch * bits // 8
    cache = CACHE / f"{sid}.{f['startSec']}+{f['durationSec']}.raw"
    if not cache.exists():
        a = data + int(f["startSec"] * sr) * frame
        b = a + int(f["durationSec"] * sr) * frame - 1
        r = requests.get(f["url"], headers={"Range": f"bytes={a}-{b}"}, timeout=300)
        r.raise_for_status()
        if r.status_code != 206:
            raise RuntimeError(f"le serveur ignore la plage demandée : {f['url']}")
        cache.write_bytes(r.content)
    return pcm_to_float(cache.read_bytes(), bits, ch), sr


def fetch_file(sid: str, f: dict) -> tuple[np.ndarray, int]:
    name = f["url"].split("?")[0].rsplit("/", 1)[-1]
    cache = CACHE / f"{sid}--{name}"
    if not cache.exists():
        r = requests.get(f["url"], timeout=300)
        r.raise_for_status()
        cache.write_bytes(r.content)
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate",
                            "-of", "csv=p=0", str(cache)], capture_output=True, text=True, check=True)
    sr = int(probe.stdout.strip())
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(cache), "-ac", "1", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, "<f4").astype(np.float32)
    a = int(f.get("startSec", 0) * sr)
    b = a + int(f["durationSec"] * sr) if "durationSec" in f else len(x)
    return x[a:b], sr


# --- Traitement -------------------------------------------------------------------------------------------------

def spectrogram(x: np.ndarray, sr: int, fmin: float, fmax: float, out: Path) -> None:
    """Spectrogramme en dB, niveaux de gris (0 = faible), hautes fréquences en haut."""
    fmax = min(fmax, sr / 2)
    res = max((fmax - fmin) / SPECTRO_H, 0.25)  # pas de fréquence visé (Hz)
    nper = int(2 ** np.ceil(np.log2(sr / res)))
    nper = min(nper, max(64, len(x) // 8))
    f, _, s = signal.spectrogram(x, sr, window="hann", nperseg=nper, noverlap=int(nper * 0.875), mode="psd")
    keep = (f >= fmin) & (f <= fmax)
    db = 10 * np.log10(s[keep] + 1e-20)
    lo, hi = np.percentile(db, 5), np.percentile(db, 99.7)
    img = np.clip((db - lo) / max(hi - lo, 1e-6), 0, 1)[::-1]
    Image.fromarray((img * 255).astype(np.uint8), "L").resize((SPECTRO_W, SPECTRO_H), Image.BILINEAR).save(out, optimize=True)


def prepare(x: np.ndarray, sr: int, p: dict) -> np.ndarray:
    y = x - x.mean()
    if p.get("highpassHz"):
        y = signal.sosfiltfilt(signal.butter(4, p["highpassHz"], "highpass", fs=sr, output="sos"), y)
    if p.get("lowpassHz") and p["lowpassHz"] < sr / 2:
        y = signal.sosfiltfilt(signal.butter(4, p["lowpassHz"], "lowpass", fs=sr, output="sos"), y)
    fade = int(sr * p.get("fadeMs", 50) / 1000)
    if fade and len(y) > 2 * fade:
        ramp = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
        y[:fade] *= ramp
        y[-fade:] *= ramp[::-1]
    peak = np.max(np.abs(y)) or 1
    return (y / peak * 10 ** (p.get("peakDb", -3) / 20)).astype(np.float32)


def active_level(y: np.ndarray, sr: int) -> float:
    """Niveau actif (dBFS) : 90e centile des niveaux RMS sur des trames de 100 ms [E].

    Le RMS global sous-estime les sons épars (clics de cachalot, impulsions de rorqual commun) ; le lecteur
    compense vers un niveau de référence commun à partir de cette mesure (`levelDbfs` du catalogue)."""
    n = max(1, sr // 10)
    m = max(1, len(y) // n)
    frames = np.sqrt(np.mean(y[: m * n].reshape(m, n) ** 2, axis=1) + 1e-20)
    return float(20 * np.log10(np.percentile(frames, 90)))


def bitrates(sr: int) -> tuple[str, str]:
    """(Opus, AAC). Les sources décimées (≤ 4 kHz, infrasons) n'ont rien au-delà de 2 kHz : 16 kbit/s suffisent
    (écart < 0,1 dB à 43 et 85 Hz, mesuré sur le rorqual bleu)."""
    return ("16k", "24k") if sr <= 4000 else ("48k", "64k")


def encode(y: np.ndarray, sr: int, base: Path) -> None:
    opus, aac = bitrates(sr)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "x.wav"
        wavfile.write(wav, sr, y)
        common = ["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-ac", "1", "-map_metadata", "-1",
                  "-fflags", "+bitexact", "-flags:a", "+bitexact"]  # fichiers reproductibles (git)
        subprocess.run([*common, "-c:a", "libopus", "-b:a", opus, "-ar", "48000", str(base.with_suffix(".ogg"))], check=True)
        subprocess.run([*common, "-c:a", "aac", "-b:a", aac, "-ar", "44100", str(base.with_suffix(".m4a"))], check=True)


# --- Catalogue --------------------------------------------------------------------------------------------------

def build(s: dict) -> dict:
    sid, f, p = s["id"], s["fetch"], s.get("prepare", {})
    x, sr = (fetch_wav_range if f["type"] == "wav-range" else fetch_file)(sid, f)
    if len(x) < sr * 0.2:
        raise ValueError(f"{sid} : extrait trop court ({len(x) / sr:.2f} s)")
    view = s["spectrogram"]
    spectrogram(x, sr, view["fMinHz"], view["fMaxHz"], SOUNDS / f"{sid}.spectro.png")
    y = prepare(x, sr, p)
    encode(y, sr, SOUNDS / sid)
    transforms = [{"op": "découpe", "detail": f"{len(x) / sr:.1f} s", "status": "S"}]
    if p.get("highpassHz"):
        transforms.append({"op": "passe-haut", "detail": f"{p['highpassHz']} Hz, ordre 4", "status": "E"})
    if p.get("lowpassHz"):
        transforms.append({"op": "passe-bas", "detail": f"{p['lowpassHz']} Hz, ordre 4", "status": "E"})
    transforms.append({"op": "normalisation", "detail": f"crête à {p.get('peakDb', -3)} dBFS, fondus {p.get('fadeMs', 50)} ms", "status": "E"})
    opus, aac = bitrates(sr)
    transforms.append({"op": "encodage", "detail": f"Opus {opus}bit/s (.ogg), AAC {aac}bit/s (.m4a)", "status": "E"})
    return {
        "id": sid,
        "kind": "son",
        "subject": s["subject"],
        "title": s["title"],
        "files": {"ogg": f"sons/{sid}.ogg", "m4a": f"sons/{sid}.m4a"},
        "durationSec": round(len(y) / sr, 2),
        "sampleRateHz": sr,
        "levelDbfs": round(active_level(y, sr), 1),
        "origin": s["origin"],
        "license": s["license"],
        "credit": s["credit"],
        "transforms": transforms,
        "spectrogram": {"file": f"sons/{sid}.spectro.png", **view, "computedOn": "original"},
        "notes": s.get("notes", ""),
        "status": s.get("status", "S"),
    }


def build_photo(s: dict) -> dict:
    """Photo de Wikimedia Commons : métadonnées de licence lues sur Commons, vignette WebP."""
    import html
    import re

    pid, name = s["id"], s["commons"]
    r = requests.get("https://commons.wikimedia.org/w/api.php", headers=UA, timeout=60, params={
        "action": "query", "format": "json", "prop": "imageinfo", "titles": f"File:{name}",
        "iiprop": "url|size|extmetadata", "iiurlwidth": PHOTO_W})
    r.raise_for_status()
    page = next(iter(r.json()["query"]["pages"].values()))
    info = page["imageinfo"][0]
    meta = info["extmetadata"]
    text = lambda k: html.unescape(re.sub(r"<[^>]+>", "", meta.get(k, {}).get("value", ""))).strip()
    license_ = text("LicenseShortName")
    artist = text("Artist")
    if not license_ or not artist:
        raise ValueError(f"{pid} : licence ou auteur absent des métadonnées de Commons")
    cache = CACHE / f"{pid}--{Path(info['thumburl'].split('?')[0]).name}"
    if not cache.exists():
        img = requests.get(info["thumburl"], headers=UA, timeout=120)
        img.raise_for_status()
        cache.write_bytes(img.content)
    PHOTOS.mkdir(parents=True, exist_ok=True)
    im = Image.open(cache).convert("RGB")
    out = PHOTOS / f"{pid}.webp"
    im.save(out, "WEBP", quality=80, method=6)
    return {
        "id": pid,
        "kind": "photo",
        "subject": s["subject"],
        "title": s["title"],
        "files": {"image": f"photos/{pid}.webp"},
        "width": im.width,
        "height": im.height,
        "origin": {
            "source": f"Wikimedia Commons, « {name} »" + (f" ({text('Credit')})" if text("Credit") else ""),
            "url": info["descriptionurl"],
            "author": artist,
            "recordedAt": text("DateTimeOriginal"),
            "place": s.get("place", "") or text("ImageDescription") or "non précisé",
            "instrument": "photographie",
        },
        "license": license_,
        "credit": f"{artist}, {license_}, via Wikimedia Commons",
        "transforms": [{"op": "vignette", "detail": f"{im.width} × {im.height} px, WebP qualité 80", "status": "E"}],
        "notes": s.get("notes", ""),
        "status": "S",
    }


def write_doc(items: list[dict]) -> None:
    """docs/MEDIAS.md : table de provenance, une ligne par fichier, régénérée avec le catalogue."""
    cell = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
    lines = [
        "# Médias : provenance des sons et des photos",
        "",
        "Fichier **généré** par `tools/build_media.py` à partir de `tools/media_sources.json5` : ne pas le modifier",
        "à la main. Chaque son est un extrait de vrai enregistrement, gardé à sa hauteur d'origine. Le spectrogramme",
        "est calculé sur l'extrait original, avant filtrage. Les transpositions des infrasons se font à la lecture",
        "(`audio.whales.transpose`) et sont des choix artistiques [A]. Le niveau actif (90e centile des trames de",
        "100 ms) sert à égaliser les espèces à la lecture [E]. Statuts : voir `REVUE_SCIENTIFIQUE.md`.",
        "",
        "| Son | Sujet | Source | Date, lieu | Licence | Transformations | Niveau actif | Remarques |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for m in (m for m in items if m["kind"] == "son"):
        subject = m["subject"].get("species") or f"lieu `{m['subject'].get('lieu')}`"
        o = m["origin"]
        when = f"{o['recordedAt'] or 'date non précisée'}, {o['place']}"
        tr = " ; ".join(f"{t['op']} ({t['detail']}) [{t['status']}]" for t in m["transforms"])
        lines.append(
            f"| `{m['id']}` : {cell(m['title'])}, {m['durationSec']} s | {cell(subject)} | [{cell(o['source'])}]({o['url']}) ; "
            f"{cell(o['instrument'])} | {cell(when)} | {cell(m['license'])} | {cell(tr)} | {m['levelDbfs']} dBFS | {cell(m.get('notes', ''))} |")
    lines += ["", "## Photos", "", "| Photo | Sujet | Source | Auteur | Licence | Lieu |", "|---|---|---|---|---|---|"]
    for m in (m for m in items if m["kind"] == "photo"):
        o = m["origin"]
        subject = m["subject"].get("species") or f"lieu `{m['subject'].get('lieu')}`"
        lines.append(f"| `{m['id']}` : {cell(m['title'])} | {cell(subject)} | [{cell(o['source'])}]({o['url']}) | {cell(o['author'])} | "
                     f"{cell(m['license'])} | {cell(o['place'])} |")
    lines += ["", "## Crédits", ""] + sorted({f"- {m['credit']}" for m in items}) + [""]
    (ROOT / "docs" / "MEDIAS.md").write_text("\n".join(lines), encoding="utf-8")


def main(only: list[str]) -> None:
    spec = json5.loads(SOURCES.read_text(encoding="utf-8"))
    sources = [*spec["sons"], *spec.get("photos", [])]
    CACHE.mkdir(parents=True, exist_ok=True)
    SOUNDS.mkdir(parents=True, exist_ok=True)
    path = OUT / "catalog.json"
    old = {e["id"]: e for e in json.loads(path.read_text())["items"]} if path.exists() and only else {}
    items = []
    for s in sources:
        if only and s["id"] not in only:
            if s["id"] in old:
                items.append(old[s["id"]])
            continue
        print(f"[media] {s['id']}…", flush=True)
        items.append(build_photo(s) if "commons" in s else build(s))
    catalog = {
        "generated": date.today().isoformat(),
        "about": "Extraits de vrais enregistrements ; provenance et transformations par entrée. Produit par tools/build_media.py.",
        "items": items,
    }
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_doc(items)
    total = sum(f.stat().st_size for d in (SOUNDS, PHOTOS) if d.exists() for f in d.iterdir())
    print(f"[media] {len(items)} média(s), {total / 1e6:.2f} Mo dans {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1:])
