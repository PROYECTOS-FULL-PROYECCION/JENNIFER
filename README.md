# 🐝 El cuento de la profe JENNIFFER

Galería web de las actividades de una clase de **Educación Infantil**, con estética de
**libro de cuentos ilustrado**. Estática, sin backend y sin build: HTML + CSS + JavaScript.

**Web publicada:** https://proyectos-full-proyeccion.github.io/JENNIFER/

---

## Índice

1. [Qué incluye](#qué-incluye)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Ver en local](#ver-en-local)
4. [Añadir fotos y vídeos](#añadir-fotos-y-vídeos)
5. [El manifiesto `data/galeria.json`](#el-manifiesto-datagaleriajson)
6. [Publicación en GitHub Pages](#publicación-en-github-pages)
7. [Cierre automático a los 4 meses](#cierre-automático-a-los-4-meses)
8. [Móvil](#móvil)
9. [Música de fondo](#música-de-fondo)
10. [Modo Cuento (presentación)](#modo-cuento-presentación)
11. [Accesibilidad y rendimiento](#accesibilidad-y-rendimiento)
12. [Herramientas (`tools/`)](#herramientas-tools)
13. [Problemas conocidos y soluciones](#problemas-conocidos-y-soluciones)
14. [Créditos y mantenimiento](#créditos-y-mantenimiento)

---

## Qué incluye

### Galería
- **Los vídeos van siempre los primeros**, en una fila destacada arriba del todo (en móvil y
  en escritorio), para que sea lo primero que ve quien entra.
- Después, **24 fotos** en muro (masonry) o en rejilla uniforme.
- Cada foto es una **página del cuento**: tarjeta crema con cinta adhesiva de color, marco
  pastel, pegatina (🐝 🌸 ⭐ 🦋 🎨 🎈), título y **número de página**.
- **Buscador** y filtros por capítulo, etiqueta, favoritas y 4 órdenes (vídeos siempre primero).
- **Visor** con favoritos, copiar enlace directo (`#foto=<id>`), descarga y comentarios.
- **Comentarios**: se guardan en el navegador de cada visitante (`localStorage`), sin servidor.
- **Subida local** de fotos de prueba (IndexedDB): solo en ese navegador, no se publican.

### Diseño de cuento
- Portada de cierre con la lámina de **colores y formas** (círculo, estrella, triángulo,
  cuadrado) y la **abejita con estela punteada** y tres flores.
- Fondo ilustrado: cielo celeste, **sol sonriente**, nubes, pradera verde.
- **Modo "Antes de dormir"**: cielo nocturno con **luna dormida**, estrellas y colores fríos.
- Tipografías redondeadas de cuento (Baloo 2, Fredoka, Patrick Hand).

### Animación de entrada
- **Intro de estrellitas** al abrir o recargar: 90 puntos brillando, 7 destellos, luna con
  halo, estrella fugaz y globo; se cierra sola a los 2,7 s (o al tocar).
- Parámetros: `?intro=1` la fuerza, `?intro=0` la desactiva.
- Se **omite automáticamente** si el sistema tiene activado "reducir movimiento".

### Música
- **Caja de música** suave generada con Web Audio (sin archivos de audio).
- Botón para encender/apagar en la cabecera y en la barra móvil; recuerda la preferencia.

### Modo Cuento
- Presentación a pantalla completa con **transición 3D de pasar página** + zoom Ken Burns.
- Autoavance configurable (4/6/9/14 s), pausa, anterior/siguiente, y **swipe** en móvil.
- Los vídeos se reproducen solos y al terminar pasan a la siguiente página.

---

## Estructura del proyecto

```
JENNIPER-PAGE/
├─ index.html                  # página única
├─ cerrar.html                 # página que se publica al cerrar la galería
├─ manifest.json               # PWA (nombre, iconos, color)
├─ .github/workflows/
│  ├─ pages.yml                # despliegue + autocierre por fecha
│  └─ cerrar-galeria.yml       # cierre programado (21 feb) + repo privado opcional
├─ assets/
│  ├─ css/styles.css           # tema "libro de cuentos" (día / noche)
│  ├─ js/db.js                 # IndexedDB para subidas locales
│  ├─ js/musica.js             # caja de música con Web Audio
│  ├─ js/app.js                # galería, filtros, visor, presentación, intro
│  ├─ img/                     # favicon + iconos PWA
│  ├─ fotos/                   # 24 fotos optimizadas (WebP full + thumb)
│  └─ videos/                  # 2 vídeos MP4 + portadas JPG
├─ data/galeria.json           # manifiesto (título, fecha de cierre, 26 entradas)
├─ tools/
│  ├─ preparar-album.py        # optimiza fotos/vídeos y genera el manifiesto
│  ├─ subir-r2.py              # alternativa: subir a Cloudflare R2 / B2
│  ├─ purgar-bucket.py         # vaciar bucket al cerrar (simulacro por defecto)
│  └─ requirements.txt
└─ docs/CAMBIOS.md             # registro de todo lo hecho (decisiones y fallos)
```

---

## Ver en local

```bash
cd JENNIPER-PAGE
python -m http.server 8000
# abre http://localhost:8000
```

> Ábrelo por `http://`, no con doble clic: el navegador bloquea `fetch()` del manifiesto
> cuando la página se carga con `file://`.

---

## Añadir fotos y vídeos

```bash
pip install -r tools/requirements.txt        # Pillow (y boto3 si usas R2)
python tools/preparar-album.py "fotos y videos" --album "Juegos en el parque" ^
       --tags "infantil, juegos, dibujos, parque"
```

Qué hace:

- **Fotos** → `assets/fotos/<slug>-full.webp` (máx. 1920 px) y `-thumb.webp` (máx. 480 px).
- **Vídeos** → `assets/videos/<slug>.mp4` (H.264/AAC, máx. 1280 px, `faststart`) +
  `<slug>-poster.jpg` y duración vía `ffprobe`.
- Fecha: EXIF → nombre del archivo (`YYYYMMDD[_HHMMSS]`) → fecha del archivo.
- Actualiza `data/galeria.json` **sin duplicar** y ordena por fecha.
- Cachea lo procesado (`.cache/album.json`, ignorado por git): la segunda pasada solo añade
  lo nuevo. Usa `--forzar` para reprocesar todo.

Opciones útiles: `--ancho`, `--thumb`, `--calidad`, `--video-ancho`, `--crf`, `--dry-run`.

> Los archivos originales (`fotos y videos/`) están en `.gitignore`: al repo solo entran las
> versiones optimizadas.

---

## El manifiesto `data/galeria.json`

```json
{
  "version": 1,
  "titulo": "Profe JENNIFFER",
  "subtitulo": "Un día de juegos y colores 🌈",
  "expira": "2027-02-21",
  "fotos": [
    {
      "id": "la-profe-nos-explica-el-juego",
      "tipo": "video",
      "url": "assets/videos/vid-20261017-wa0221.mp4",
      "thumb": "assets/videos/vid-20261017-wa0221-poster.jpg",
      "poster": "assets/videos/vid-20261017-wa0221-poster.jpg",
      "duracion": 23.9,
      "titulo": "La profe nos explica el juego",
      "etiquetas": ["video", "juegos"],
      "album": "Juegos en el parque",
      "fecha": "2026-10-17T12:00:00",
      "bytes": 3663
    }
  ]
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `id` | sí | único; se usa en `#foto=<id>` |
| `tipo` | no | `"video"` o ausente (= foto) |
| `url` | sí | ruta relativa o URL absoluta (CDN) |
| `thumb` | no | miniatura; si falta se usa `url` |
| `poster` | no | portada del vídeo |
| `duracion` | no | segundos (para el contador y el autoavance) |
| `fecha` | no | ISO; ordena y se muestra |
| `expira` | no | fecha de cierre de la galería (nivel raíz) |
| `titulo` / `subtitulo` | no | cabecera de la web (nivel raíz) |

---

## Publicación en GitHub Pages

Repo: `PROYECTOS-FULL-PROYECCION/JENNIFER` (público — Pages en repos privados requiere GitHub Pro).

- El workflow `.github/workflows/pages.yml` se dispara en cada push a `main`:
  1. comprueba la fecha de cierre,
  2. prepara `_site/` (o `cerrar.html` si ya expiró),
  3. sube el artefacto y despliega con `actions/deploy-pages`.
- Pages debe estar en **Settings → Pages → Source: GitHub Actions**.
- URL resultante: `https://<usuario>.github.io/<repo>/`.

Límites relevantes (verificados, oct 2026): sitio publicado **1 GB**, archivo suelto en el
repo **100 MiB** (aviso a 50), ancho de banda 100 GB/mes, despliegue con timeout de 10 min.

---

## Cierre automático a los 4 meses

Tres capas, todas activas:

1. **Autocierre por fecha** — `"expira": "2027-02-21"`. Cualquier despliegue posterior a esa
   fecha publica `cerrar.html` en vez de la galería. Para reabrir a mano: *Actions → Desplegar
   en GitHub Pages → Run workflow* con `forzar_abierta`.
2. **Cierre programado** — `.github/workflows/cerrar-galeria.yml` (cron `0 5 21 2 *`): publica
   la página de cierre y, opcionalmente, pasa el repo a privado y borra el sitio de Pages.
3. **Aviso en la web** — muestra "disponible hasta el 21 feb 2027" y oculta la galería al
   llegar la fecha (es informativo, **no** un control de acceso).

Para el paso a privado automático hace falta un **PAT** guardado como secreto `PAT_ADMIN`
(*Settings → Secrets and variables → Actions*). Sin él, el sitio se cierra igual pero el
repositorio seguiría público.

> Si algún día el álbum crece por encima de ~800 MB, mueve las imágenes a un bucket
> (Cloudflare R2, 10 GB gratis y egress gratuito) con `tools/subir-r2.py` y vacíalo al cerrar
> con `tools/purgar-bucket.py` (tiene guarda de fecha y simulacro por defecto).

---

## Móvil

- **Barra inferior tipo app**: Filtros · Música · Noche · Cuento (con `safe-area` de iOS).
- **Filtros en una sola barra** de 53 px: buscador + capítulo + orden + vista + ⚙️; los
  extras (favoritas y etiquetas) se despliegan solo al pulsar.
- Muro a **1 columna** (2 en tablet), visor a **pantalla completa** (`100dvh`).
- **Deslizar** izquierda/derecha en el visor y en el Modo Cuento.
- Inputs a 16 px para evitar el zoom automático de iOS; sin efectos hover pegajosos.
- **PWA**: `manifest.json` + iconos 192/512 y `apple-touch-icon` → "Añadir a pantalla de inicio".

---

## Música de fondo

`assets/js/musica.js` sintetiza una nana con Web Audio: melodía pentatónica de Do mayor a
tempo lento (caja de música) + pad suave, filtro paso bajo y fundidos de entrada/salida.

- Sin archivos de audio: no pesa y no hay problemas de licencias ni de carga.
- Los navegadores exigen un gesto para sonar: se enciende con el botón (o al primer clic si
  estaba activada de antes).
- **Corregido**: el listener de "primer gesto" se autoeliminaba mal y **volvía a encender la
  música al pulsar apagar**; ahora se retira al primer gesto y respeta la preferencia.

---

## Modo Cuento (presentación)

- Abre a pantalla completa (si el navegador lo permite) y avanza sola.
- Transiciones: **giro de página en 3D** (`rotateY`) + **Ken Burns** (zoom lento).
- Controles: anterior, pausa, siguiente, velocidad, música y salir.
- Teclado: `←` `→` `Espacio` `Esc`. Móvil: swipe.
- Los vídeos se reproducen (con sonido si el navegador lo permite; si no, en mudo) y al
  terminar continúan la presentación.

---

## Accesibilidad y rendimiento

- **Lighthouse: 100 accesibilidad · 100 buenas prácticas · 100 SEO**.
- Contraste verificado en tema día y noche; foco visible; `aria-label` en iconos.
- Encabezados en orden (h1 → h2 → h3); sin `aria-label` que contradiga el texto visible.
- `prefers-reduced-motion`: desactiva animaciones e intro.
- Imágenes con `loading="lazy"` y `decoding="async"`; miniaturas WebP de 480 px en el muro.

---

## Herramientas (`tools/`)

| Script | Para qué |
|---|---|
| `preparar-album.py` | Optimiza fotos y vídeos, genera portadas y actualiza el manifiesto |
| `subir-r2.py` | Alternativa: sube a R2/B2 y genera URLs públicas en el manifiesto |
| `purgar-bucket.py` | Vacía el bucket al cerrar (simulacro por defecto; no borra antes de `expira`) |

---

## Problemas conocidos y soluciones

| Síntoma | Causa / solución |
|---|---|
| La música no se apaga | Corregido: el listener global de autoplay la reactivaba. Ver `docs/CAMBIOS.md` |
| "This run likely failed because of a workflow file issue" | YAML no admitido por GitHub. Dos causas encontradas: `if: ${{ secrets.X != '' }}` y `permissions: administration: write` |
| Push rechazado por `workflow` scope | El token OAuth necesita el scope `workflow` para subir `.github/workflows/*` |
| `403` al hacer push | La cuenta autenticada no tiene permiso: usa la cuenta dueña (`gh auth login`) |
| `fetch` del manifiesto falla | Abriste con `file://`; usa un servidor local |
| Los vídeos no salían arriba | El muro en columnas llena en vertical: los vídeos van en una fila destacada aparte |
| El sitio no se actualiza | Caché del navegador (Ctrl+F5). GitHub Pages cachea 10 min; los `assets` llevan `?v=` en el HTML para forzar la recarga tras un despliegue |

---

## Créditos y mantenimiento

- Fotos y vídeos: clase de Educación Infantil de la **profe JENNIFFER** (octubre 2026).
- Diseño y código: adaptado a partir de la referencia de libro de cuentos infantil.
- Publicación: GitHub Pages + GitHub Actions.
- Cierre previsto: **21 de febrero de 2027**.
