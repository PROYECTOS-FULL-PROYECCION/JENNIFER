# 📓 Registro de cambios y decisiones

Todo lo hecho en esta web, en orden. Sirve para entender **por qué** está así y qué se
corrigió por el camino.

---

## 1. Origen y primeras versiones

**Petición inicial:** una web para compartir fotos, en la subcarpeta `JENNIPER-PAGE`.

- Se creó una galería estática sin dependencias: muro masonry, rejilla, lightbox, búsqueda,
  filtros por etiqueta/álbum, favoritos, comentarios locales, descarga, copia de enlace y
  subida de prueba con IndexedDB.
- Se verificó en navegador: 4 tarjetas de demo, 8 etiquetas, lightbox, teclado, comentarios,
  deep-link `#foto=<id>` y subida local. Consola limpia.

**Cambio de plataforma (GitLab → GitHub):**
- Se preparó GitLab Pages con `expire_in: 4 months` y un job de limpieza de bucket.
- Al pasar a GitHub se reescribió el despliegue con `actions/deploy-pages` y un workflow de
  cierre programado.
- Se decidió mantener el repo **público** (Pages en repos privados requiere GitHub Pro).

---

## 2. Los 1 GB de fotos

**Dato clave:** el artefacto publicado en GitHub/GitLab Pages tiene un límite de **1 GB**, así
que 1 GB de fotos no cabe (además del límite de 100 MiB por archivo en GitHub).

Se prepararon dos caminos:

1. **Bucket S3-compatible + CDN** (Cloudflare R2: 10 GB gratis, egress gratuito) con
   `tools/subir-r2.py` y `tools/purgar-bucket.py`.
2. **Optimización en el repo** con `tools/preparar-album.py` (WebP + miniaturas).

**Resultado real:** el álbum final pesa **68,6 MB** (26 archivos). Optimizado quedó en
**18,5 MB** (24 fotos WebP + 2 vídeos MP4), así que **entra de sobra en el repo** y R2 quedó
como alternativa documentada, no como necesidad.

---

## 3. Los vídeos

- `ffmpeg`/`ffprobe` disponibles en el equipo → el script reencodea a H.264/AAC 1280 px con
  `faststart`, extrae **portada** a 1 s y lee la **duración**.
- La web se adaptó: tarjeta con ▶ y duración, visor con `<video controls>`, presentación con
  reproducción automática y salto al terminar.
- **Problema detectado:** en el muro con columnas CSS, el segundo vídeo aparecía a mitad de
  columna (las columnas se llenan en vertical). **Solución:** fila destacada de vídeos
  (`#videosDestacados`) siempre arriba, con el resto de fotos debajo.

---

## 4. El rediseño "libro de cuentos"

Referencia aportada: láminas de un libro infantil (abeja con estela punteada, flores, colores
y formas, cielo con sol, cuadro nocturno "Antes de dormir").

Implementado:

- Portada ilustrada con **sol sonriente**, nubes, pradera, **abejita animada** y tres flores.
- Tarjetas convertidas en **páginas de cuento**: cinta adhesiva de color, marco pastel,
  pegatinas y **número de página**.
- **Modo noche** con luna dormida y estrellas.
- Tipografías Baloo 2 / Fredoka / Patrick Hand.
- **Cierre de cuento** al final de la página ("…este cuento se ha acabado") con la lámina de
  colores y formas + la abeja.

**Reordenación posterior:** a petición, **primero las fotos y vídeos** y el bloque decorativo
**al final**, precedido por una intro de estrellitas.

---

## 5. Música, presentación e intro

- **Música**: `assets/js/musica.js` sintetiza una nana con Web Audio (pentatónica de Do mayor,
  tempo lento, pad suave y filtro). Sin archivos de audio.
- **Modo Cuento**: overlay a pantalla completa con transición **3D de pasar página**
  (`rotateY`) + **Ken Burns**, autoavance configurable, pausa y controles que se ocultan.
- **Intro**: cielo nocturno con 90 estrellas, 7 destellos, luna, estrella fugaz y globo;
  fundido de salida a los 2,7 s. Parámetros `?intro=1` / `?intro=0`. Se omite con
  `prefers-reduced-motion`.

**Fallo corregido — la música no se apagaba:**
- Existía un listener en `document` para arrancar la música al primer gesto (política de
  autoplay). Al pulsar el botón de apagar, el mismo clic burbujeaba hasta `document`, veía la
  música parada y **la volvía a encender**.
- Solución: el listener se elimina en el primer gesto, ignora los clics en los botones de
  música y comprueba la preferencia guardada.
- Verificado: encender ✓ → apagar ✓ → sigue apagada tras 1,6 s ✓ → botón de la barra móvil ✓.

---

## 6. Optimización móvil

- Barra inferior tipo app (Filtros · Música · Noche · Cuento) con `safe-area` de iOS.
- Filtros en **una sola barra** de 53 px; los extras se pliegan tras ⚙️.
- Muro a 1 columna en teléfono, visor a pantalla completa con `100dvh`, **swipe**.
- Inputs a 16 px (evita el zoom de iOS), objetivos táctiles ≥ 44 px, sin hover pegajoso.
- **PWA**: `manifest.json`, iconos 192/512 y `apple-touch-icon` generados con Pillow.
- Cabecera compacta: iconos en vez de textos largos.

---

## 7. Accesibilidad (Lighthouse 100/100/100)

Avisos encontrados y corregidos:

| Aviso | Arreglo |
|---|---|
| Contraste en `.seg-btn.is-on` | azul más oscuro (`#1c5fc4`) con texto blanco |
| Contraste en `.etiqueta-cuento` (modo noche) | variable `--etiqueta-azul` que cambia con el tema |
| Contraste de `.muted` | `#6f5a4b` |
| Orden de encabezados | `h2` de sección antes de las tarjetas (`h3`) |
| Nombres accesibles | fuera `aria-label` que no coincidía con el texto visible (botones y tarjetas) |

---

## 8. Fallos de GitHub Actions (YAML)

Dos construcciones **no admitidas** que rompían el workflow con
*"This run likely failed because of a workflow file issue"*:

1. `if: ${{ secrets.R2_BUCKET != '' }}` → comparar un secreto con cadena vacía en un `if`
   invalida el archivo. Se sustituyó por una comprobación dentro de `run:` con variables de
   entorno.
2. `permissions: administration: write` → no es un permiso válido del `GITHUB_TOKEN`. Se
   eliminó; el paso a privado usa un **PAT** guardado como secreto `PAT_ADMIN` (opcional).

También se documentó que **subir workflows requiere el scope `workflow`** en el token OAuth
y que un `run:` en estilo plano no puede contener `: ` (hay que usar bloque `|`).

**Método usado:** bisección con workflows de prueba (`t1`…`t10`) en un solo push para aislar
la construcción inválida.

---

## 9. Estado actual

- **Web:** https://proyectos-full-proyeccion.github.io/JENNIFER/
- **Contenido:** 24 fotos + 2 vídeos (18,5 MB), 26 páginas numeradas.
- **Despliegue:** GitHub Actions en cada push a `main`.
- **Cierre:** 21 de febrero de 2027 (autocierre + workflow programado).
- **Calidad:** Lighthouse 100/100/100, consola sin errores.

### Ideas pendientes (no implementadas)

- Comentarios compartidos entre visitantes (requiere backend o un servicio tipo Supabase).
- Descarga del álbum completo en ZIP.
- Contador de visitas.
- Dominio propio (p. ej. `cuento-profejenniffer.com`).

---

## 10. Tercer vídeo y dos correcciones

Se añadió `video_2026-10-21_21-54-29.mp4` (69 s): el script lo recomprimió a 17,4 MB y generó
portada. Total: **27 páginas (3 vídeos + 24 fotos)**.

**Fallos encontrados al probarlo:**

1. **El clic en un vídeo destacado no abría el visor.** El listener de clic estaba solo en
   `#galeria`; al sacar los vídeos a `#videosDestacados` quedaron fuera. Ahora la delegación
   se aplica a los dos contenedores.
2. **Los títulos personalizados se perdían** al volver a ejecutar el script: la caché
   restauraba los títulos originales del nombre del archivo. Ahora `preparar-album.py`
   conserva el `titulo` que ya existe en el manifiesto para cada `id` (salvo con `--forzar`).

También se mejoró el detector de fechas del script: acepta `20261017`, `2026-10-17` y
`2026-10-17_21-54-29`, además de la hora en varios formatos.

**Cache-busting:** los assets pasan a `?v=20261023` para que el navegador no sirva la versión
anterior (GitHub Pages cachea 10 minutos).
