#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara un album (fotos y videos) para la galeria JENNIPER y genera data/galeria.json.

Fotos  -> <salida>/<slug>-full.webp  (ancho maximo) + <salida>/<slug>-thumb.webp
Videos -> <salida-videos>/<slug>.mp4 (recomprimido) + <salida-videos>/<slug>-poster.jpg

Requiere: Pillow. Para los videos, ffmpeg/ffprobe en el PATH (opcional: si no estan,
el video se copia tal cual y se queda sin portada).

Uso:
    python tools/preparar-album.py "fotos y videos" --album "Viaje" --tags "vacaciones, 2026"

Opciones:
    --ancho 1920        ancho maximo de la foto completa
    --thumb 480         ancho maximo de la miniatura
    --calidad 82        calidad WebP
    --video-ancho 1280  ancho maximo del video (720p por defecto)
    --crf 24            calidad del video (menor = mejor)
    --salida assets/fotos
    --salida-videos assets/videos
    --manifiesto data/galeria.json
    --titulo-vacio      deja el titulo vacio en vez de usar el nombre del archivo
    --forzar            reprocesa aunque ya exista en cache
    --dry-run
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Falta Pillow. Instala con:  pip install Pillow", file=sys.stderr)
    raise SystemExit(1)

RAIZ = Path(__file__).resolve().parent.parent
EXT_IMG = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
EXT_VID = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}
CACHE = RAIZ / ".cache" / "album.json"


def slug(texto):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto or "archivo"


def titulo_limpio(nombre, vacio=False):
    """Si el nombre trae fecha (20261017 / 20261017_165017) la usa como titulo."""
    if vacio:
        return ""
    m = re.search(r"(\d{4})(\d{2})(\d{2})(?:[_ .-]?(\d{2})(\d{2})(\d{2})?)?", nombre)
    if m:
        try:
            d = datetime.strptime("%s-%s-%s" % (m.group(1), m.group(2), m.group(3)), "%Y-%m-%d")
            if m.group(4):
                return d.strftime("%d %b %Y") + " · " + m.group(4) + ":" + m.group(5)
            return d.strftime("%d %b %Y")
        except ValueError:
            pass
    base = Path(nombre).stem
    base = re.sub(r"^(IMG|VID|DSC|WhatsApp)[-_ ]*", "", base, flags=re.I)
    base = re.sub(r"[_-]+", " ", base).strip()
    base = re.sub(r"\s+", " ", base)
    return base.capitalize() if base else Path(nombre).stem


def fecha_del_nombre(nombre, respaldo):
    """Fecha del nombre del archivo (WhatsApp no guarda metadatos)."""
    m = re.search(r"(\d{4})(\d{2})(\d{2})(?:[_ .-]?(\d{2})(\d{2})(\d{2})?)?", nombre)
    if m:
        try:
            if m.group(4):
                return datetime.strptime(
                    "%s-%s-%s %s:%s:%s" % (m.group(1), m.group(2), m.group(3),
                                           m.group(4), m.group(5), m.group(6) or "00"),
                    "%Y-%m-%d %H:%M:%S").isoformat(timespec="seconds")
            return datetime.strptime(
                "%s-%s-%s 12:00:00" % (m.group(1), m.group(2), m.group(3)),
                "%Y-%m-%d %H:%M:%S").isoformat(timespec="seconds")
        except ValueError:
            pass
    return respaldo


def fecha_foto(ruta):
    try:
        with Image.open(ruta) as im:
            exif = im.getexif()
            raw = exif.get(36867) or exif.get(306)  # DateTimeOriginal / DateTime
            if raw:
                return datetime.strptime(raw[:19], "%Y:%m:%d %H:%M:%S").isoformat()
    except Exception:
        pass
    # sin EXIF (WhatsApp): la fecha del nombre o la de modificacion
    return fecha_del_nombre(ruta.name,
                             datetime.fromtimestamp(Path(ruta).stat().st_mtime).isoformat(timespec="seconds"))


def ffmpeg_disponible():
    return shutil.which("ffmpeg") is not None


def duracion_video(ruta):
    if not shutil.which("ffprobe"):
        return 0.0
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(ruta)],
            capture_output=True, text=True, timeout=60)
        return round(float(out.stdout.strip()), 1)
    except Exception:
        return 0.0


def procesar_video(ruta, destino, ancho, crf):
    """Reencode a H.264/AAC con faststart. Devuelve (ok, portada_o_None)."""
    if not ffmpeg_disponible():
        shutil.copy2(ruta, destino)
        return True, None
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", str(ruta),
        "-vf", "scale='min(%d,iw)':-2" % ancho,
        "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        str(destino),
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=1800, check=True)
    except Exception as exc:
        print("  ffmpeg fallo (%s): se copia el original" % exc, file=sys.stderr)
        shutil.copy2(ruta, destino)
        return True, None
    return True, True


def portada_video(ruta, destino_jpg, momento=1.0):
    if not ffmpeg_disponible():
        return False
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", str(momento), "-i", str(ruta),
             "-frames:v", "1", "-q:v", "3", str(destino_jpg)],
            capture_output=True, timeout=120, check=True)
        return destino_jpg.exists()
    except Exception:
        return False


def cargar_cache():
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def guardar_cache(cache):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Prepara fotos y videos del album")
    ap.add_argument("origen", help="carpeta con las fotos y videos")
    ap.add_argument("--album", default="Viaje")
    ap.add_argument("--tags", default="")
    ap.add_argument("--ancho", type=int, default=1920)
    ap.add_argument("--thumb", type=int, default=480)
    ap.add_argument("--calidad", type=int, default=82)
    ap.add_argument("--video-ancho", type=int, default=1280)
    ap.add_argument("--crf", type=int, default=24)
    ap.add_argument("--salida", default="assets/fotos")
    ap.add_argument("--salida-videos", default="assets/videos")
    ap.add_argument("--manifiesto", default="data/galeria.json")
    ap.add_argument("--titulo-vacio", action="store_true")
    ap.add_argument("--forzar", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    origen = Path(args.origen).expanduser()
    if not origen.is_dir():
        print("No existe la carpeta:", origen, file=sys.stderr)
        raise SystemExit(1)

    salida_foto = (RAIZ / args.salida).resolve()
    salida_vid = (RAIZ / args.salida_videos).resolve()
    manifiesto = (RAIZ / args.manifiesto).resolve()
    etiquetas = [t.strip() for t in args.tags.split(",") if t.strip()]

    archivos = sorted(p for p in origen.rglob("*")
                      if p.is_file() and p.suffix.lower() in (EXT_IMG | EXT_VID))
    if not archivos:
        print("No hay fotos ni videos en", origen, file=sys.stderr)
        raise SystemExit(1)

    print("ffmpeg: %s" % ("disponible" if ffmpeg_disponible() else "NO (los videos se copian tal cual)"))
    print("%d archivos\n" % len(archivos))

    cache = cargar_cache()
    entradas = []
    ids_vistos = set()

    for ruta in archivos:
        clave = str(ruta.resolve())
        estampa = [ruta.stat().st_size, int(ruta.stat().st_mtime)]
        if not args.forzar and cache.get(clave) == estampa and cache.get("e" + clave):
            info = cache["e" + clave]
            if info["id"] not in ids_vistos:
                entradas.append(info)
                ids_vistos.add(info["id"])
                print("= %-40s (cache)" % ruta.name)
            continue

        base = slug(ruta.stem)
        id_foto = base
        n = 2
        while id_foto in ids_vistos:
            id_foto = "%s-%d" % (base, n)
            n += 1
        ids_vistos.add(id_foto)

        if ruta.suffix.lower() in EXT_IMG:
            try:
                with Image.open(ruta) as im:
                    im = ImageOps.exif_transpose(im)
                    alfa = im.mode in ("RGBA", "LA", "P")
                    im = im.convert("RGBA" if alfa else "RGB")
                    full = im.copy(); full.thumbnail((args.ancho, args.ancho * 4), Image.LANCZOS)
                    thumb = im.copy(); thumb.thumbnail((args.thumb, args.thumb * 4), Image.LANCZOS)
                    if not args.dry_run:
                        salida_foto.mkdir(parents=True, exist_ok=True)
                        full.save(salida_foto / ("%s-full.webp" % id_foto), "WEBP",
                                  quality=args.calidad, method=5)
                        thumb.save(salida_foto / ("%s-thumb.webp" % id_foto), "WEBP",
                                   quality=args.calidad, method=5)
            except Exception as exc:
                print("ERROR %s: %s" % (ruta.name, exc), file=sys.stderr)
                continue

            rel = Path(args.salida).as_posix()
            info = {
                "id": id_foto,
                "tipo": "foto",
                "thumb": "%s/%s-thumb.webp" % (rel, id_foto),
                "url": "%s/%s-full.webp" % (rel, id_foto),
                "titulo": titulo_limpio(ruta.name, args.titulo_vacio),
                "descripcion": ruta.name,
                "etiquetas": etiquetas,
                "album": args.album,
                "fecha": fecha_foto(ruta),
                "bytes": (salida_foto / ("%s-full.webp" % id_foto)).stat().st_size
                          if (salida_foto / ("%s-full.webp" % id_foto)).exists() else 0,
            }
            print("+ %-40s -> %s" % (ruta.name, info["thumb"]))

        else:  # video
            destino = salida_vid / ("%s.mp4" % id_foto)
            poster = salida_vid / ("%s-poster.jpg" % id_foto)
            if not args.dry_run:
                salida_vid.mkdir(parents=True, exist_ok=True)
            procesar_video(ruta, destino, args.video_ancho, args.crf)
            hay_portada = False if args.dry_run else portada_video(ruta, poster)
            if args.dry_run and not args.dry_run:
                hay_portada = False
            rel = Path(args.salida_videos).as_posix()
            info = {
                "id": id_foto,
                "tipo": "video",
                "thumb": ("%s/%s-poster.jpg" % (rel, id_foto)) if hay_portada else "",
                "poster": ("%s/%s-poster.jpg" % (rel, id_foto)) if hay_portada else "",
                "url": "%s/%s.mp4" % (rel, id_foto),
                "duracion": duracion_video(ruta),
                "titulo": titulo_limpio(ruta.name, args.titulo_vacio),
                "descripcion": ruta.name,
                "etiquetas": etiquetas,
                "album": args.album,
                "fecha": fecha_del_nombre(
                    ruta.name,
                    datetime.fromtimestamp(ruta.stat().st_mtime).isoformat(timespec="seconds")),
                "bytes": destino.stat().st_size if destino.exists() else 0,
            }
            print("+ %-40s -> %s  (%.1f s)" % (ruta.name, info["url"], info["duracion"]))

        entradas.append(info)
        cache[clave] = estampa
        cache["e" + clave] = info

    if not args.dry_run:
        datos = {}
        if manifiesto.exists():
            try:
                datos = json.loads(manifiesto.read_text(encoding="utf-8"))
            except Exception:
                datos = {}
        fotos = [f for f in datos.get("fotos", []) if f.get("id") not in {e["id"] for e in entradas}]
        fotos.extend(entradas)
        fotos.sort(key=lambda f: f.get("fecha", ""))
        datos["fotos"] = fotos
        datos["version"] = 1
        datos["actualizado"] = datetime.now().date().isoformat()
        manifiesto.parent.mkdir(parents=True, exist_ok=True)
        manifiesto.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        guardar_cache(cache)

    peso = sum(e.get("bytes", 0) for e in entradas)
    print("\n%d entradas. Peso: %.1f MB" % (len(entradas), peso / 1048576))
    print("Manifiesto: %s" % manifiesto)


if __name__ == "__main__":
    main()
