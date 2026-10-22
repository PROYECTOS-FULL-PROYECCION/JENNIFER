#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sube un album de fotos a un bucket compatible con S3 (Cloudflare R2, Backblaze B2,
MinIO, Wasabi...) y genera data/galeria.json con las URLs publicas.

Es la "Opcion A": el repo de GitLab solo guarda el codigo y el manifiesto,
las imagenes (1 GB o mas) viven en el bucket, servidas por CDN. El sitio de
GitLab Pages queda por debajo de 1 MB y despliega en segundos.

Uso:
    python tools/subir-r2.py "D:\\fotos\\vacaciones" ^
        --bucket fotos-jenniper ^
        --endpoint https://<cuenta>.r2.cloudflarestorage.com ^
        --public-url https://pub-xxxxxxxx.r2.dev ^
        --album "Viajes" --tags "paisaje, mar"

Opciones:
    --perfil default     perfil de ~/.aws/credentials
    --prefijo fotos/     prefijo dentro del bucket
    --thumb 480          genera y sube tambien miniaturas (requiere Pillow)
    --ancho 1920         ancho maximo de la version subida
    --calidad 82         calidad WebP
    --manifiesto data/galeria.json
    --solo-nuevas        no vuelve a subir archivos ya presentes
    --dry-run            no sube nada, solo muestra el plan

Requiere: pip install boto3 Pillow
"""

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("Falta boto3. Instala con:  pip install boto3", file=sys.stderr)
    raise SystemExit(1)

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None
    ImageOps = None

RAIZ = Path(__file__).resolve().parent.parent
EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def slug(texto):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto or "foto"


def fecha_exif(ruta):
    if Image is None:
        return datetime.fromtimestamp(Path(ruta).stat().st_mtime).date().isoformat()
    try:
        with Image.open(ruta) as im:
            exif = im.getexif()
            raw = exif.get(306) or exif.get(36867)
            if raw:
                return datetime.strptime(raw[:10], "%Y:%m:%d").date().isoformat()
    except Exception:
        pass
    return datetime.fromtimestamp(Path(ruta).stat().st_mtime).date().isoformat()


def sha1(ruta, bloque=1024 * 1024):
    h = hashlib.sha1()
    with open(ruta, "rb") as fh:
        while True:
            b = fh.read(bloque)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def guardar_manifiesto(ruta, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Sube fotos a un bucket S3-compatible y genera el manifiesto")
    ap.add_argument("origen", help="carpeta con las fotos")
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--public-url", required=True, help="URL publica del bucket (sin barra final)")
    ap.add_argument("--endpoint", default=None, help="endpoint S3 (R2: https://<acct>.r2.cloudflarestorage.com)")
    ap.add_argument("--perfil", default="default")
    ap.add_argument("--prefijo", default="fotos/")
    ap.add_argument("--album", default="General")
    ap.add_argument("--tags", default="")
    ap.add_argument("--thumb", type=int, default=480)
    ap.add_argument("--ancho", type=int, default=1920)
    ap.add_argument("--calidad", type=int, default=82)
    ap.add_argument("--manifiesto", default="data/galeria.json")
    ap.add_argument("--solo-nuevas", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    origen = Path(args.origen).expanduser()
    if not origen.is_dir():
        print("No existe la carpeta:", origen, file=sys.stderr)
        raise SystemExit(1)

    manifiesto_path = (RAIZ / args.manifiesto).resolve()
    etiquetas = [t.strip() for t in args.tags.split(",") if t.strip()]
    publico = args.public_url.rstrip("/")
    prefijo = args.prefijo.strip("/")
    if prefijo:
        prefijo += "/"

    s3 = boto3.client(
        "s3",
        endpoint_url=args.endpoint,
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )

    archivos = sorted(p for p in origen.rglob("*") if p.is_file() and p.suffix.lower() in EXT)
    if not archivos:
        print("No hay imagenes en", origen, file=sys.stderr)
        raise SystemExit(1)

    entradas = []
    subidas = 0

    for ruta in archivos:
        base = slug(ruta.stem)
        clave = prefijo + base + ".webp"
        destino = Path(os.environ.get("TEMP", ".")) / (base + ".webp")

        # conversion a webp (opcional si no hay Pillow: se sube el original)
        if Image is not None:
            with Image.open(ruta) as im:
                im = ImageOps.exif_transpose(im)
                alfa = im.mode in ("RGBA", "LA", "P")
                im = im.convert("RGBA" if alfa else "RGB")
                im.thumbnail((args.ancho, args.ancho * 4), Image.LANCZOS)
                im.save(destino, "WEBP", quality=args.calidad, method=5)
            # miniatura
            with Image.open(ruta) as im:
                im = ImageOps.exif_transpose(im)
                alfa = im.mode in ("RGBA", "LA", "P")
                im = im.convert("RGBA" if alfa else "RGB")
                im.thumbnail((args.thumb, args.thumb * 4), Image.LANCZOS)
                destino_thumb = Path(str(destino) + ".thumb.webp")
                im.save(destino_thumb, "WEBP", quality=args.calidad, method=5)
        else:
            destino = ruta
            destino_thumb = None

        existe = False
        if args.solo_nuevas:
            try:
                s3.head_object(Bucket=args.bucket, Key=clave)
                existe = True
            except Exception:
                existe = False

        if not existe and not args.dry_run:
            s3.upload_file(str(destino), args.bucket, clave,
                           ContentType="image/webp",
                           CacheControl="public, max-age=31536000, immutable")
            if destino_thumb:
                s3.upload_file(str(destino_thumb), args.bucket, clave.replace(".webp", "-thumb.webp"),
                               ContentType="image/webp",
                               CacheControl="public, max-age=31536000, immutable")
            subidas += 1

        url = "%s/%s" % (publico, clave)
        url_thumb = "%s/%s" % (publico, clave.replace(".webp", "-thumb.webp")) if destino_thumb else url

        entradas.append({
            "id": base,
            "thumb": url_thumb,
            "url": url,
            "titulo": ruta.stem.replace("_", " ").replace("-", " ").strip().capitalize(),
            "descripcion": "",
            "etiquetas": etiquetas,
            "album": args.album,
            "fecha": fecha_exif(ruta),
            "bytes": destino.stat().st_size if destino.exists() else 0,
        })
        print("%-44s -> %s" % (ruta.name, url))

        if destino != ruta:
            try:
                os.remove(destino)
            except OSError:
                pass
            if destino_thumb:
                try:
                    os.remove(destino_thumb)
                except OSError:
                    pass

    if not args.dry_run:
        datos = json.loads(manifiesto_path.read_text(encoding="utf-8")) if manifiesto_path.exists() else {"version": 1, "fotos": []}
        fotos = [f for f in datos.get("fotos", []) if f.get("id") not in {e["id"] for e in entradas}]
        fotos.extend(entradas)
        datos["fotos"] = fotos
        datos["version"] = 1
        datos["actualizado"] = datetime.now(timezone.utc).date().isoformat()
        guardar_manifiesto(manifiesto_path, datos)

    print("\n%d archivos, %d subidos. Manifiesto: %s" % (len(archivos), subidas, manifiesto_path))


if __name__ == "__main__":
    main()
