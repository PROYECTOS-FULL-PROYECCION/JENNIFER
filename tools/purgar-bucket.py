#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vacia un bucket compatible con S3 (Cloudflare R2, Backblaze B2, MinIO).

Se usa para cerrar la galeria publica: cuando la web expira pero las fotos
siguen en el bucket, sus URLs directas continuarian accesibles. Este script
las elimina de verdad.

AVISO: borra objetos de forma irreversible. Por defecto hace un simulacro
(solo lista). Para borrar de verdad hay que pasar --confirmar.

Uso:
    python tools/purgar-bucket.py --bucket fotos-jenniper \
        --endpoint https://<cuenta>.r2.cloudflarestorage.com --confirmar

Opciones:
    --prefijo fotos/   solo borra lo que empiece por este prefijo (recomendado)
    --perfil default   perfil de ~/.aws/credentials
    --endpoint URL     endpoint S3
    --bucket NOMBRE    bucket
    --confirmar        ejecuta el borrado (sin esto, solo simulacro)
    --incluir-version  borra tambien las versions antiguas del versionado
    --manifiesto RUTA  lee la fecha "expira" del manifiesto y no borra antes de ella
    --ignorar-fecha    borra aunque la fecha de cierre aun no haya llegado
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description="Vacia un bucket S3-compatible")
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--endpoint", default=None)
    ap.add_argument("--perfil", default="default")
    ap.add_argument("--prefijo", default="")
    ap.add_argument("--confirmar", action="store_true", help="borra de verdad (sin esto es simulacro)")
    ap.add_argument("--incluir-version", action="store_true", help="borra tambien las versions antiguas")
    ap.add_argument("--manifiesto", default="data/galeria.json", help="manifiesto con la fecha 'expira'")
    ap.add_argument("--ignorar-fecha", action="store_true", help="borra aunque la fecha aun no haya llegado")
    args = ap.parse_args()

    # Guarda de seguridad: no se borra nada antes de la fecha de cierre.
    manifiesto = Path(args.manifiesto)
    if not args.ignorar_fecha and manifiesto.exists():
        try:
            datos = json.loads(manifiesto.read_text(encoding="utf-8"))
            expira = datos.get("expira")
        except Exception:
            expira = None
        if expira:
            try:
                fin = date.fromisoformat(expira)
            except ValueError:
                fin = None
            if fin and date.today() < fin:
                print("La galeria sigue abierta hasta el %s: no se borra nada." % fin.isoformat())
                print("Usa --ignorar-fecha si de verdad quieres borrarla ya.")
                return

    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        print("Falta boto3. Instala con:  pip install boto3", file=sys.stderr)
        raise SystemExit(1)

    s3 = boto3.client(
        "s3",
        endpoint_url=args.endpoint,
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )

    prefijo = args.prefijo
    paginator = s3.get_paginator("list_objects_v2")
    claves = []
    total = 0
    for pag in paginator.paginate(Bucket=args.bucket, Prefix=prefijo):
        for obj in pag.get("Contents", []):
            claves.append(obj["Key"])
            total += obj["Size"]

    print("Bucket : %s" % args.bucket)
    print("Prefijo: %s" % (prefijo or "(todo el bucket)"))
    print("Objetos: %d  (%.1f MB)" % (len(claves), total / 1048576))

    if not claves:
        print("No hay nada que borrar.")
        return

    if not args.confirmar:
        print("\nSIMULACRO: no se borro nada. Anade --confirmar para ejecutar el borrado.")
        for k in claves[:20]:
            print("  -", k)
        if len(claves) > 20:
            print("  ... y %d mas" % (len(claves) - 20))
        return

    print("\nBorrando %d objetos..." % len(claves))
    borrados = 0
    for i in range(0, len(claves), 1000):
        lote = claves[i:i + 1000]
        s3.delete_objects(Bucket=args.bucket, Delete={"Objects": [{"Key": k} for k in lote]})
        borrados += len(lote)
    print("Borrados %d objetos." % borrados)

    if args.incluir_version:
        try:
            versions = s3.list_object_versions(Bucket=args.bucket, Prefix=prefijo)
            vs = [{"Key": v["Key"], "VersionId": v["VersionId"]} for v in versions.get("Versions", [])]
            if vs:
                s3.delete_objects(Bucket=args.bucket, Delete={"Objects": vs})
                print("Borradas %d versiones antiguas." % len(vs))
        except Exception as exc:
            print("No se pudieron borrar las versiones: %s" % exc, file=sys.stderr)


if __name__ == "__main__":
    main()
