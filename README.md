# JENNIPER · Página de fotos

Galería estática para compartir fotos, pensada para **GitLab Pages**.

- Sin backend, sin build step, sin dependencias en el navegador.
- Las fotos "publicadas" se describen en `data/galeria.json` (rutas del repo **o** URLs de un bucket/CDN).
- Las subidas hechas desde la web quedan solo en el navegador (IndexedDB) y sirven para probar.

## Galería pública durante 4 meses

Caso de uso: álbum de un viaje de amigos, abierto al público y **cerrado solo** 4 meses después.

### 1. Que la web se despublique sola

El job de Pages ya lo hace (`expire_in` en `.gitlab-ci.yml`):

```yaml
  pages:
    expire_in: 4 months
```

Pasada esa fecha GitLab borra el despliegue: la URL pasa a dar 404 y **nadie puede ver las
fotos a través del sitio** (las imágenes siguen en el repo, pero el sitio ya no las sirve;
si quieres borrarlas del todo, quita la carpeta `assets/fotos/` en un commit posterior).

> Si el plazo es concreto, usa `expire_in: 2027-02-21` (GitLab acepta fechas absolutas).

### 2. Que las fotos en sí desaparezcan

Si las imágenes viven en el repo, el punto 1 basta. Si viven en **R2/B2** (recomendado con 1 GB),
el bucket es público y sus URLs seguirían sirviendo fotos aunque la web muera. Dos opciones:

- **Job programado de limpieza** (ya incluido en `.gitlab-ci.yml` como `limpieza-mensual`):
  se ejecuta el día 1 de cada mes y vacía el bucket. Necesita variables de CI:
  `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY` (credenciales de solo
  borrado). En *Settings → CI/CD → Pipeline schedules* crea el schedule mensual.
- **A mano el día del cierre**: `python tools/purgar-bucket.py --bucket fotos-jenniper
  --endpoint https://<cuenta>.r2.cloudflarestorage.com --confirmar` (sin `--confirmar` solo
  hace un simulacro).

### 3. Aviso en la propia web

`data/galeria.json` admite `expira`; la web muestra un aviso con la fecha de cierre y, cuando
llega, oculta la galería:

```json
{ "version": 1, "expira": "2027-02-21", "fotos": [ ... ] }
```

Ojo: este aviso es información para el visitante, **no es un control de acceso**. El cierre
real es el del punto 1 y el 2.

### Resumen de la configuración recomendada

| Pieza | Configuración |
|---|---|
| Visibilidad | Proyecto de GitLab **público** (Pages en gitlab.io es público en el plan Free) |
| Cierre del sitio | `pages.expire_in: 4 months` en `.gitlab-ci.yml` |
| Fotos | R2 (bucket público) + job `limpieza-mensual` que lo vacía |
| Aviso | `"expira": "2027-02-21"` en `data/galeria.json` |
| Enlace para los amigos | `https://<usuario>.gitlab.io/<proyecto>/` |

Si en algún momento quieres cortar la web **ya** (y no esperar al plazo): borra el *deployment*
en *Deploy → Pages → deployments* o simply haz `git push` de una versión sin fotos.

## Estructura

```
JENNIPER-PAGE/
├─ index.html                 # página única
├─ .gitlab-ci.yml             # job de GitLab Pages
├─ assets/
│  ├─ css/styles.css
│  ├─ js/db.js                # IndexedDB (fotos locales)
│  ├─ js/app.js               # galería, filtros, lightbox, comentarios
│  ├─ img/favicon.svg
│  └─ fotos/                  # imágenes en el repo (o no: ver "dónde vivir las fotos")
├─ data/galeria.json          # manifiesto de fotos publicadas
└─ tools/
   ├─ preparar-fotos.py       # optimiza + genera thumbs + actualiza el manifiesto
   ├─ subir-r2.py             # sube a R2/B2 y genera el manifiesto
   └─ requirements.txt
```

## Verlo en local

```bash
cd JENNIPER-PAGE
python -m http.server 8000
# abre http://localhost:8000
```

> Abrelo por `http://`, no con doble clic en `index.html`: el navegador bloquea
> `fetch()` de `data/galeria.json` con el protocolo `file://`.

## Publicar en GitLab Pages

1. Crea un proyecto en GitLab (puede ser un proyecto nuevo solo para esta página).
2. Sube el contenido de `JENNIPER-PAGE/` a la **raíz** del repositorio.
3. Settings → **Pages** → *Deploy from a branch* → rama `main` → carpeta raíz (`/`) o `public`.
4. El `.gitlab-ci.yml` incluido despliega automáticamente en cada push a la rama por defecto.

Si prefieres que `JENNIPER-PAGE/` sea una subcarpeta de un repo mayor, copia el `.gitlab-ci.yml`
a la raíz del repo y cambia el script por:

```yaml
script:
  - mkdir -p public
  - cp -r JENNIPER-PAGE/. public/
```

### Límites de GitLab Pages (verificados, oct 2026)

| Límite | Valor | Nota |
|---|---|---|
| Tamaño del sitio (artefacto) | **1 GB** | no ajustable en gitlab.com |
| Archivos por sitio | 200.000 | |
| Push máximo | 5 GiB | por archivo: 100 MiB (plan Free) |
| Storage del repo | 10 GB (Free) | ampliable |
| Git LFS | 5 GB/archivo | **no sirve**: el artefacto seguiría pasando de 1 GB |

Conclusión: **1 GB de fotos dentro del repo rompe el despliegue** (y el repo se infla en cada commit).

## Dónde vivir las fotos (3 opciones)

### A. Bucket S3-compatible + CDN — recomendado para 1 GB

Repo mínimo (< 1 MB), despliegue instantáneo, escala a decenas de GB.

| Servicio | Storage gratis | Egress | Notas |
|---|---|---|---|
| **Cloudflare R2** | 10 GB | **gratis** | API S3, mismo proveedor que el CDN |
| Backblaze B2 | 10 GB | gratis hasta 3×/mes | API S3 |
| Bunny Storage | — | ~0,10 €/GB | CDN incluido, muy barato |
| Supabase Storage | 1 GB | 1 GB/mes | |

Pasos con R2:

1. Crea una cuenta en Cloudflare → **R2** → *Create bucket* (p. ej. `fotos-jenniper`).
2. En *Settings → Public access*, habilita el subdominio `r2.dev` (para pruebas) o conecta un
   dominio propio (p. ej. `fotos.tudominio.com`).
3. *Settings → CORS* (necesario para descargas y para leer píxeles):

   ```json
   [{ "AllowedOrigins": ["https://tu-usuario.gitlab.io", "http://localhost:8000"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```

4. *R2 → Manage R2 API Tokens* → *Create API Token* (permisos *Object Read & Write* sobre el bucket).
5. Credenciales en `~/.aws/credentials` (Windows: `C:\Users\<tu-usuario>\.aws\credentials`):

   ```ini
   [default]
   aws_access_key_id = <ACCESS KEY>
   aws_secret_access_key = <SECRET KEY>
   ```

6. Sube el álbum y genera el manifiesto:

   ```bash
   pip install -r tools/requirements.txt
   python tools/subir-r2.py "D:\fotos\vacaciones" ^
       --bucket fotos-jenniper ^
       --endpoint https://<cuenta>.r2.cloudflarestorage.com ^
       --public-url https://pub-xxxxxxxx.r2.dev ^
       --album "Viajes" --tags "paisaje, mar"
   ```

   Las entradas quedan en `data/galeria.json` con URLs absolutas + miniatura (`-thumb.webp`).

7. `git add data/galeria.json && git commit -m "album de vacaciones" && git push` → el sitio ya lo muestra.

### B. Todo en el repo, optimizado (sin servicios externos)

Convierte 1 GB de originales en ~200–400 MB y entra de sobra en el límite de 1 GB:

```bash
python tools/preparar-fotos.py "D:\fotos\vacaciones" --album "Viajes" --tags "paisaje, mar"
```

Genera `<slug>-full.webp` (1920 px) y `<slug>-thumb.webp` (480 px) en `assets/fotos/` y actualiza
`data/galeria.json`. Ojo: cada re-publicación vuelve a crecer el repo; conviene versionar los
originales fuera de git.

### C. Híbrido (recomendada si quieresgallery rápida)

Miniaturas en el repo (o en el bucket) + originales en R2. El muro carga rápido y el visor
descarga el original del CDN. `data/galeria.json` admite `thumb` y `url` por separado:

```json
{ "id": "costa", "thumb": "assets/fotos/costa-thumb.webp", "url": "https://pub-xxx.r2.dev/fotos/costa.webp" }
```

## El manifiesto `data/galeria.json`

```json
{
  "version": 1,
  "fotos": [
    {
      "id": "costa-2026",
      "thumb": "assets/fotos/costa-thumb.webp",
      "url": "assets/fotos/costa-full.webp",
      "titulo": "Atardecer en la costa",
      "descripcion": "La última luz sobre el mar.",
      "etiquetas": ["paisaje", "mar"],
      "album": "Viajes",
      "fecha": "2026-10-12",
      "bytes": 245000
    }
  ]
}
```

- `id` único (se usa en los enlaces `#foto=<id>`).
- `thumb` es opcional: si falta se usa `url`.
- `url` admite ruta relativa (`assets/fotos/x.jpg`) o absoluta (`https://...`).
- Las fotos subidas desde la web se marcan como `local` y no entran en el manifiesto:
  para compartirlas hay que copiar el archivo a `assets/fotos/` (o al bucket) y añadir la entrada.

## Funciones de la web

- Muro (masonry) y rejilla, búsqueda, filtro por álbum / etiqueta / favoritas y 4 ordenaciones.
- Lightbox con navegación por teclado (←/→/Esc), favoritos, descarga, copiar enlace directo
  (`#foto=<id>`) y comentarios.
- Tema claro/oscuro, arrastrar y soltar para subir, arrastrar y soltar alinear.
- Las fotos locales persisten en IndexedDB (`jenniper-galeria`); los comentarios de fotos
  publicadas se guardan en `localStorage` de cada visitante.

## Atajos

| Tecla | Acción |
|---|---|
| `←` / `→` | foto anterior / siguiente |
| `Esc` | cerrar el visor |
| `Enter` | abrir la foto enfocada |
