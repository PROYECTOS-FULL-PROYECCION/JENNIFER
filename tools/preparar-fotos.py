#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara un álbum de fotos para GitLab Pages.

Genera, por cada imagen:
    <slug>-full.webp    version optimizada (ancho maximo configurable)
    <slug>-thumb.webp   miniatura para el muro de la galeria
y actualiza data/galeria.json con las entradas correspondientes.

Es la "Opcion B/C": reduces ~1 GB de originales a ~200-400 MB, por debajo del
limite de 1 GB del artefacto de GitLab Pages.

Uso:
    python tools/preparar-fotos.py "D:\\fotos\\vacaciones" --album "Viajes" --tags "paisaje, mar"

Opciones:
    --ancho 1920        ancho maximo de la version completa (px)
    --thumb 480         ancho maximo de la miniatura (px)
    --calidad 82        calidad WebP (1-100)
    --salida assets/fotos
    --manifiesto data/galeria.json
    --titulo            texto para "descripcion" (opcional)
    --sin-manifiesto    no tocar data/galeria.json
    --forzar            reprocesar aunque ya exista en cache
    --dry-run           muestra lo que haria sin escribir nada

Requiere: pip install Pillow
"""

import argparse
import json
import os
import re
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
EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
CACHE = RAIZ / ".cache" / "preparado.json"


def slug(texto):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto or "foto"


def fecha_exif(ruta):
    try:
        with Image.open(ruta) as im:
            exif = im.getexif()
            raw = exif.get(306) or exif.get(36867)  # DateTime / DateTimeOriginal
            if raw:
                return datetime.strptime(raw[:10], "%Y:%m:%d").date().isoformat()
    except Exception:
        pass
    return datetime.fromtimestamp(Path(ruta).stat().st_mtime).date().isoformat()


def titulo_limpio(nombre):
    nombre = Path(nombre).stem
    nombre = re.sub(r"[_-]+", " ", nombre)
    return nombre.strip().capitalize() or "Sin titulo"


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


def cargar_manifiesto(ruta):
    if ruta.exists():
        try:
            return json.loads(ruta.read_text(encoding="utf-8"))
        except Exception as exc:
            print("Manifiesto ilegible, se creara uno nuevo:", exc, file=sys.stderr)
    return {"version": 1, "fotos": []}


def guardar_manifiesto(ruta, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def procesar(ruta, ancho, ancho_thumb, calidad):
    with Image.open(ruta) as im:
        im = ImageOps.exif_transpose(im)
        tiene_alfa = im.mode in ("RGBA", "LA", "P")
        im = im.convert("RGBA" if tiene_alfa else "RGB")

        full = im.copy()
        full.thumbnail((ancho, ancho * 4), Image.LANCZOS)

        thumb = im.copy()
        thumb.thumbnail((ancho_thumb, ancho_thumb * 4), Image.LANCZOS)

        return full, thumb


def main():
    ap = argparse.ArgumentParser(description="Prepara fotos para la galeria JENNIPER")
    ap.add_argument("origen", help="carpeta con las fotos")
    ap.add_argument("--album", default="General", help="nombre del album")
    ap.add_argument("--tags", default="", help="etiquetas separadas por comas")
    ap.add_argument("--ancho", type=int, default=1920)
    ap.add_argument("--thumb", type=int, default=480)
    ap.add_argument("--calidad", type=int, default=82)
    ap.add_argument("--salida", default="assets/fotos")
    ap.add_argument("--manifiesto", default="data/galeria.json")
    ap.add_argument("--titulo", default="", help="texto de la descripcion")
    ap.add_argument("--sin-manifiesto", action="store_true")
    ap.add_argument("--forzar", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    origen = Path(args.origen).expanduser()
    if not origen.is_dir():
        print("No existe la carpeta:", origen, file=sys.stderr)
        raise SystemExit(1)

    salida = (RAIZ / args.salida).resolve()
    manifiesto_path = (RAIZ / args.manifiesto).resolve()
    etiquetas = [t.strip() for t in args.tags.split(",") if t.strip()]

    archivos = sorted(p for p in origen.rglob("*") if p.is_file() and p.suffix.lower() in EXT)
    if not archivos:
        print("No hay imagenes en", origen, file=sys.stderr)
        raise SystemExit(1)

    cache = cargar_cache()
    entradas = []
    procesadas = 0
    saltadas = 0

    for ruta in archivos:
        clave = str(ruta.resolve())
        estampa = [ruta.stat().st_size, int(ruta.stat().st_mtime)]
        if not args.forzar and cache.get(clave) == estampa:
            info = cache.get("__info__" + clave)
            if info:
                entradas.append(info)
                saltadas += 1
                continue

        base = slug(ruta.stem)
        id_foto = base
        n = 2
        while any(e["id"] == id_foto for e in entradas):
            id_foto = "%s-%d" % (base, n)
            n += 1

        destino_full = salida / ("%s-full.webp" % id_foto)
        destino_thumb = salida / ("%s-thumb.webp" % id_foto)

        try:
            full, thumb = procesar(ruta, args.ancho, args.thumb, args.calidad)
        except Exception as exc:
            print("ERROR %s: %s" % (ruta.name, exc), file=sys.stderr)
            continue

        if not args.dry_run:
            salida.mkdir(parents=True, exist_ok=True)
            full.save(destino_full, "WEBP", quality=args.calidad, method=5)
            thumb.save(destino_thumb, "WEBP", quality=args.calidad, method=5)

        rel_full = "%s/%s" % (Path(args.salida).as_posix(), destino_full.name)
        rel_thumb = "%s/%s" % (Path(args.salida).as_posix(), destino_thumb.name)

        entrada = {
            "id": id_foto,
            "thumb": rel_thumb,
            "url": rel_full,
            "titulo": titulo_limpio(ruta.name),
            "descripcion": args.titulo,
            "etiquetas": etiquetas,
            "album": args.album,
            "fecha": fecha_exif(ruta),
            "bytes": destino_full.stat().st_size if destino_full.exists() else 0,
        }
        entradas.append(entrada)
        cache[clave] = estampa
        cache["__info__" + clave] = entrada
        procesadas += 1
        print("%-44s -> %s" % (ruta.name, rel_full))

    if not args.sin_manifiesto and not args.dry_run:
        datos = cargar_manifiesto(manifiesto_path)
        fotos = [f for f in datos.get("fotos", []) if f.get("id") not in {e["id"] for e in entradas}]
        fotos.extend(entradas)
        datos["fotos"] = fotos
        datos["version"] = 1
        datos["actualizado"] = datetime.now().date().isoformat()
        guardar_manifiesto(manifiesto_path, datos)
        guardar_cache(cache)

    total = sum(e.get("bytes", 0) for e in entradas)
    peso = "%.1f MB" % (total / 1048576) if total >= 1048576 else "%.0f KB" % (total / 1024)
    print("\n%d procesadas, %d sin cambios, %d entradas. Peso de las nuevas: %s"
          % (procesadas, saltadas, len(entradas), peso))


if __name__ == "__main__":
    main()
