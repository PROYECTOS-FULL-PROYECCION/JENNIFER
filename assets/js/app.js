/* =========================================================
   JENNIPER · app.js
   Modo GitLab Pages: las fotos "publicadas" vienen de
   data/galeria.json (rutas relativas al repo o URLs externas
   tipo Cloudflare R2 / Backblaze B2).
   Modo local: las subidas desde la UI viven en IndexedDB
   y NO se comparten con nadie (solo en este navegador).
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- utilidades ---------------- */
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtBytes(b) {
    if (!b) return '0 MB';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function fmtFecha(f) {
    if (!f) return '';
    var d = new Date(f.length === 10 ? f + 'T12:00:00' : f);
    if (isNaN(d)) return f;
    return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtDur(seg) {
    if (!seg) return '';
    var m = Math.floor(seg / 60), s = Math.round(seg % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function toast(msg, tipo) {
    var t = document.createElement('div');
    t.className = 'toast' + (tipo ? ' ' + tipo : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- estado ---------------- */
  var state = {
    fotos: [],
    meta: {},
    filtro: { q: '', album: '', tag: '', soloFavs: false, orden: 'antiguas' },
    vista: 'masonry',
    lb: { abierto: false, indice: 0 }
  };
  var objetosURL = {};      // id -> blob URL
  var staging = [];         // archivos pendientes de publicar
  var comentariosLocales = JSON.parse(localStorage.getItem('jenniper.comentarios') || '{}');

  /* ---------------- carga de datos ---------------- */
  function normaliza(f, i) {
    var etiquetas = f.etiquetas || f.tags || [];
    if (typeof etiquetas === 'string') etiquetas = etiquetas.split(',').map(function (s) { return s.trim(); });
    return {
      id: f.id || 'm' + i,
      src: f.url || f.archivo || f.src || '',
      thumb: f.thumb || '',
      tipo: f.tipo === 'video' ? 'video' : 'foto',
      poster: f.poster || '',
      duracion: f.duracion || 0,
      titulo: f.titulo || f.title || 'Sin título',
      descripcion: f.descripcion || f.description || '',
      etiquetas: etiquetas.filter(Boolean),
      album: f.album || 'Sin álbum',
      fecha: f.fecha || (f.createdAt ? new Date(f.createdAt).toISOString().slice(0, 10) : ''),
      bytes: f.bytes || 0,
      local: false,
      favoritos: false,
      comentarios: (comentariosLocales[f.id] || []).slice(),
      blob: null
    };
  }

  function cargarManifiesto() {
    return fetch('data/galeria.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { return { fotos: (d.fotos || []).map(normaliza), meta: d || {} }; })
      .catch(function (e) {
        console.warn('No se pudo leer data/galeria.json:', e.message);
        return { fotos: [], meta: {} };
      });
  }

  function cargarLocales() {
    if (!window.GaleriaDB) return Promise.resolve([]);
    return GaleriaDB.safeAll().then(function (rows) {
      return rows.map(function (r) {
        var url = URL.createObjectURL(r.blob);
        objetosURL[r.id] = url;
        return {
          id: r.id,
          src: url,
          thumb: r.thumb || '',
          titulo: r.titulo || 'Sin título',
          descripcion: r.descripcion || '',
          etiquetas: r.etiquetas || [],
          album: r.album || 'Sin álbum',
          fecha: r.fecha || new Date(r.createdAt || Date.now()).toISOString().slice(0, 10),
          bytes: (r.blob && r.blob.size) || 0,
          local: true,
          favoritos: !!r.favoritos,
          comentarios: r.comentarios || [],
          blob: r.blob
        };
      });
    });
  }

  function init() {
    Promise.all([cargarManifiesto(), cargarLocales()]).then(function (res) {
      state.fotos = res[0].fotos.concat(res[1]);
      state.meta = res[0].meta || {};
      aplicarCaducidad();
      aplicarIdentidad();
      renderTodo();
      abrirPorHash();
    });
  }

  /* Título y subtítulo vienen del manifiesto: así la web se adapta al álbum. */
  function aplicarIdentidad() {
    var m = state.meta || {};
    if (m.titulo) {
      document.title = m.titulo + ' · ' + (m.subtitulo || 'Galería');
      var t = $('#tituloWeb'); if (t) t.textContent = m.titulo;
    }
    if (m.subtitulo) {
      var s = $('#subtituloWeb'); if (s) s.textContent = m.subtitulo;
    }
  }

  /* Cierre programado: la web avisa hasta que se cumple el plazo y, pasada la
     fecha, oculta la galeria. El cierre real lo hace GitLab (expire_in) y,
     si las fotos viven en un bucket, tools/purgar-bucket.py. */
  function aplicarCaducidad() {
    var exp = state.meta && state.meta.expira;
    if (!exp) return;
    var fin = new Date(exp + 'T23:59:59');
    if (isNaN(fin)) return;
    var aviso = $('#aviso');
    aviso.hidden = false;
    if (Date.now() > fin.getTime()) {
      aviso.classList.add('is-cerrada');
      aviso.textContent = 'Esta galería ya no está disponible: se cerró el ' + fmtFecha(exp) + '.';
      document.body.classList.add('galeria-cerrada');
    } else {
      aviso.textContent = 'Nuestra clase de infantil · disponible hasta el ' + fmtFecha(exp) + '.';
    }
  }

  /* ---------------- filtrado y orden ---------------- */
  function filtrar() {
    var f = state.filtro, q = f.q.trim().toLowerCase();
    var out = state.fotos.filter(function (x) {
      if (f.album && x.album !== f.album) return false;
      if (f.tag && x.etiquetas.indexOf(f.tag) === -1) return false;
      if (f.soloFavs && !x.favoritos) return false;
      if (q) {
        var hay = (x.titulo + ' ' + x.descripcion + ' ' + x.etiquetas.join(' ') + ' ' + x.album).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var orden = f.orden;
    out.sort(function (a, b) {
      if (orden === 'titulo') return a.titulo.localeCompare(b.titulo, 'es');
      if (orden === 'tamano') return b.bytes - a.bytes;
      var fa = a.fecha || '', fb = b.fecha || '';
      if (fa === fb) return 0;
      return orden === 'antiguas' ? (fa < fb ? -1 : 1) : (fa > fb ? -1 : 1);
    });
    return out;
  }

  /* ---------------- render ---------------- */
  function renderTodo() {
    renderGaleria();
    renderTags();
    renderAlbums();
    renderStats();
  }

  var STICKERS = ['🐝', '🌸', '⭐', '🦋', '🎨', '🎈', '🌈', '🐣'];

  function renderGaleria() {
    var lista = filtrar();
    var cont = $('#galeria');
    cont.innerHTML = lista.map(function (f, idx) {
      var esVideo = f.tipo === 'video';
      var img = esVideo ? (f.poster || f.thumb || '') : (f.thumb || f.src);
      var sticker = esVideo ? '🎬 Vídeo' : (STICKERS[idx % STICKERS.length] + ' ' + f.album);
      var medio = img
        ? '<img loading="lazy" decoding="async" src="' + esc(img) + '" alt="' + esc(f.titulo) + '">'
        : '<div class="thumb-vacio"></div>';
      return '<figure class="card' + (esVideo ? ' card-video' : '') + '" data-id="' + esc(f.id) + '" tabindex="0" role="button">' +
        '<div class="card-marco">' +
          medio +
          '<span class="card-sticker">' + esc(sticker) + '</span>' +
          (f.favoritos ? '<span class="fav-flag" title="Favorita">★</span>' : '') +
          (f.local ? '<span class="card-sticker card-local">📌 Nueva</span>' : '') +
          (esVideo ? '<span class="play-badge" aria-hidden="true">▶</span>' : '') +
          (esVideo && f.duracion ? '<span class="dur">' + esc(fmtDur(f.duracion)) + '</span>' : '') +
        '</div>' +
        '<figcaption class="card-body">' +
          '<div><h3>' + esc(f.titulo) + '</h3>' +
          '<p>' + esc(fmtFecha(f.fecha)) + '</p></div>' +
          '<span class="pagina-num" title="Página ' + (idx + 1) + '">' + (idx + 1) + '</span>' +
        '</figcaption>' +
        '</figure>';
    }).join('');
    $('#vacio').hidden = lista.length > 0;
    cont.hidden = lista.length === 0;
  }

  function renderTags() {
    var cuenta = {};
    state.fotos.forEach(function (f) {
      f.etiquetas.forEach(function (t) { cuenta[t] = (cuenta[t] || 0) + 1; });
    });
    var tags = Object.keys(cuenta).sort();
    $('#fTags').innerHTML = tags.map(function (t) {
      return '<button class="chip chip-tag' + (state.filtro.tag === t ? ' is-on' : '') + '" data-tag="' + esc(t) + '">' +
        esc(t) + ' <span class="muted">' + cuenta[t] + '</span></button>';
    }).join('');
  }

  function renderAlbums() {
    var albums = [];
    state.fotos.forEach(function (f) { if (albums.indexOf(f.album) === -1) albums.push(f.album); });
    albums.sort();
    var sel = $('#fAlbum'), actual = state.filtro.album;
    sel.innerHTML = '<option value="">Todos</option>' + albums.map(function (a) {
      return '<option value="' + esc(a) + '"' + (a === actual ? ' selected' : '') + '>' + esc(a) + '</option>';
    }).join('');
  }

  function renderStats() {
    var locales = state.fotos.filter(function (f) { return f.local; });
    var peso = locales.reduce(function (s, f) { return s + (f.bytes || 0); }, 0);
    $('#statFotos').textContent = '📖 ' + state.fotos.length + (state.fotos.length === 1 ? ' página' : ' páginas');
    if ($('#statPeso')) {
      $('#statPeso').textContent = peso ? fmtBytes(peso) + ' en este navegador' : 'sin subidas locales';
    }
  }

  /* ---------------- lightbox ---------------- */
  function listaActual() { return filtrar(); }

  function abrirLightbox(id) {
    var lista = listaActual();
    var i = lista.findIndex(function (f) { return f.id === id; });
    if (i === -1) { var todos = state.fotos; i = todos.findIndex(function (f) { return f.id === id; }); if (i === -1) return; lista = todos; }
    state.lb.abierto = true;
    state.lb.indice = i;
    state.lb.lista = lista;
    $('#lb').hidden = false;
    document.body.style.overflow = 'hidden';
    renderLightbox();
  }

  function cerrarLightbox() {
    state.lb.abierto = false;
    $('#lb').hidden = true;
    var vid = $('#lbVideo');
    if (vid) { vid.pause(); }
    document.body.style.overflow = '';
    if (location.hash.indexOf('#foto=') === 0) history.replaceState(null, '', location.pathname + location.search);
  }

  function renderLightbox() {
    var lista = state.lb.lista, f = lista[state.lb.indice];
    if (!f) return;
    var esVideo = f.tipo === 'video';
    var img = $('#lbImg'), vid = $('#lbVideo');
    if (esVideo) {
      img.hidden = true; img.removeAttribute('src');
      vid.hidden = false; vid.src = f.src; vid.poster = f.poster || '';
    } else {
      vid.hidden = true; vid.pause(); vid.removeAttribute('src');
      img.hidden = false; img.src = f.src; img.alt = f.titulo;
    }
    $('#lbTitle').textContent = f.titulo;
    $('#lbMeta').textContent = [
      f.album,
      fmtFecha(f.fecha),
      esVideo ? fmtDur(f.duracion) : null,
      f.bytes ? fmtBytes(f.bytes) : null,
      f.local ? 'subida local' : 'publicada'
    ].filter(Boolean).join(' · ');
    $('#lbFavIcon').textContent = f.favoritos ? '♥' : '♡';
    $('#lbFavTxt').textContent = f.favoritos ? 'Favorita' : 'Marcar favorita';
    $('#lbBorrar').style.display = f.local ? '' : 'none';
    $('#lbTags').innerHTML = f.etiquetas.map(function (t) {
      return '<button class="chip chip-tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
    $('#lbComments').innerHTML = f.comentarios.length ? f.comentarios.map(function (c) {
      return '<li><div class="c-head"><span>' + esc(c.autor || 'Anónimo') + '</span><span>' + esc(fmtFecha(c.fecha)) + '</span></div>' +
        '<p class="c-text">' + esc(c.texto) + '</p></li>';
    }).join('') : '<li class="muted">Sin comentarios todavía.</li>';
    $('#lbNumComments').textContent = f.comentarios.length ? '(' + f.comentarios.length + ')' : '';
    $('#lbAutor').value = localStorage.getItem('jenniper.autor') || '';
  }

  function moverLightbox(delta) {
    var lista = state.lb.lista;
    if (!lista || !lista.length) return;
    state.lb.indice = (state.lb.indice + delta + lista.length) % lista.length;
    renderLightbox();
  }

  function fotoActual() { return state.lb.lista && state.lb.lista[state.lb.indice]; }

  /* ---------------- persistencia de cambios ---------------- */
  function persistir(f) {
    if (f.local) {
      return GaleriaDB.put({
        id: f.id, blob: f.blob, titulo: f.titulo, descripcion: f.descripcion,
        etiquetas: f.etiquetas, album: f.album, fecha: f.fecha,
        createdAt: f.fecha, favoritos: f.favoritos, comentarios: f.comentarios
      });
    }
    comentariosLocales[f.id] = f.comentarios;
    localStorage.setItem('jenniper.comentarios', JSON.stringify(comentariosLocales));
    return Promise.resolve();
  }

  /* ---------------- acciones ---------------- */
  function alternarFavorita(f) {
    f.favoritos = !f.favoritos;
    persistir(f);
    renderTodo();
    renderLightbox();
  }

  function eliminarFoto(f) {
    if (!f.local) { toast('Solo se pueden eliminar las subidas locales.', 'err'); return; }
    if (!confirm('¿Eliminar "' + f.titulo + '"? Esta acción no se puede deshacer.')) return;
    GaleriaDB.del(f.id).then(function () {
      if (objetosURL[f.id]) { URL.revokeObjectURL(objetosURL[f.id]); delete objetosURL[f.id]; }
      state.fotos = state.fotos.filter(function (x) { return x.id !== f.id; });
      cerrarLightbox();
      renderTodo();
      toast('Foto eliminada.', 'ok');
    });
  }

  function descargar(f) {
    if (f.blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(f.blob);
      a.download = (f.titulo || 'foto').replace(/[^\w\-. ]+/g, '_') + '.jpg';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return;
    }
    var link = document.createElement('a');
    link.href = f.src;
    link.download = (f.titulo || 'foto').replace(/[^\w\-. ]+/g, '_');
    link.target = '_blank';
    link.rel = 'noopener';
    link.click();
  }

  function copiarEnlace(f) {
    var url = location.origin + location.pathname + '#foto=' + encodeURIComponent(f.id);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        toast('Enlace copiado: ' + url, 'ok');
      }, function () { toast(url); });
    } else {
      toast(url);
    }
  }

  function añadirComentario(f, texto, autor) {
    f.comentarios.push({ id: uid(), autor: autor || 'Anónimo', texto: texto, fecha: new Date().toISOString().slice(0, 10) });
    persistir(f);
    renderLightbox();
  }

  /* ---------------- subida ---------------- */
  function prepararSubida(files) {
    var lista = Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type); });
    if (!lista.length) { toast('Solo se aceptan archivos de imagen.', 'err'); return; }
    $('#uploader').hidden = false;
    lista.forEach(function (file) {
      staging.push({ file: file, titulo: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), preview: URL.createObjectURL(file) });
    });
    renderStaging();
    $('#uploader').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderStaging() {
    var album = $('#upAlbum').value.trim();
    var tags = $('#upTags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    $('#upList').innerHTML = staging.map(function (s, i) {
      return '<li class="up-item" data-i="' + i + '">' +
        '<img src="' + esc(s.preview) + '" alt="">' +
        '<div style="flex:1;min-width:0">' +
        '<p class="up-name">' + esc(s.file.name) + ' · ' + fmtBytes(s.file.size) + '</p>' +
        '<input type="text" value="' + esc(s.titulo) + '" data-titulo="' + i + '" aria-label="Título de la foto">' +
        '</div>' +
        '<button class="btn icon" data-quitar="' + i + '" aria-label="Quitar">✕</button>' +
        '</li>';
    }).join('');
    var total = staging.reduce(function (a, s) { return a + s.file.size; }, 0);
    $('#upResumen').textContent = staging.length + (staging.length === 1 ? ' archivo · ' : ' archivos · ') + fmtBytes(total);
  }

  function publicar() {
    if (!staging.length) return;
    var album = $('#upAlbum').value.trim() || 'Sin álbum';
    var tags = $('#upTags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var fecha = $('#upFecha').value || new Date().toISOString().slice(0, 10);
    var n = staging.length;
    Promise.all(staging.map(function (s) {
      var id = uid();
      var rec = {
        id: id, blob: s.file, titulo: (s.titulo || s.file.name).trim(),
        descripcion: '', etiquetas: tags, album: album, fecha: fecha,
        createdAt: Date.now(), favoritos: false, comentarios: []
      };
      return GaleriaDB.put(rec).then(function () {
        var url = URL.createObjectURL(s.file);
        objetosURL[id] = url;
        state.fotos.push(normalizaLocal(rec, url));
      });
    })).then(function () {
      staging.forEach(function (s) { URL.revokeObjectURL(s.preview); });
      staging = [];
      $('#uploader').hidden = true;
      $('#upList').innerHTML = '';
      renderTodo();
      toast(n + (n === 1 ? ' foto guardada' : ' fotos guardadas') + ' en este navegador. Para compartirlas, publícalas en assets/fotos/ y añádelas a data/galeria.json.', 'ok');
    }).catch(function (e) {
      console.error(e);
      toast('No se pudieron guardar: ' + (e && e.message ? e.message : e) + ' (¿almacenamiento lleno?)', 'err');
    });
  }

  function normalizaLocal(rec, url) {
    return {
      id: rec.id, src: url, thumb: '', titulo: rec.titulo, descripcion: rec.descripcion || '',
      etiquetas: rec.etiquetas || [], album: rec.album, fecha: rec.fecha,
      bytes: rec.blob.size, local: true, favoritos: !!rec.favoritos,
      comentarios: rec.comentarios || [], blob: rec.blob
    };
  }

  /* =========================================================
     Música de fondo (ver assets/js/musica.js)
     ========================================================= */
  function sincronizarMusica() {
    var sonando = !!(window.Musica && Musica.sonando);
    var ic = $('#iconoMusica'); if (ic) ic.textContent = sonando ? '🎵' : '🔇';
    var tx = $('#textoMusica'); if (tx) tx.textContent = sonando ? 'Sonando' : 'Música';
    var bm = $('#btnMusica'); if (bm) bm.classList.toggle('is-on', sonando);
    var ib = $('#bmIconoMusica'); if (ib) ib.textContent = sonando ? '🎵' : '🔇';
    var tb = $('#bmTextoMusica'); if (tb) tb.textContent = sonando ? 'Sonando' : 'Música';
    var bb = $('#bmMusica'); if (bb) bb.classList.toggle('is-on', sonando);
    var ip = $('#presentMusica'); if (ip) ip.textContent = sonando ? '🎵' : '🔇';
    localStorage.setItem('jenniper.musica', sonando ? '1' : '0');
  }
  function alternarMusica() {
    if (!window.Musica) { toast('Este navegador no permite música de fondo.', 'err'); return; }
    Musica.alternar();
    sincronizarMusica();
    toast(Musica.sonando ? 'Música activada 🎵' : 'Música silenciada 🔇');
  }
  /* =========================================================
     Modo presentación: una foto por pantalla, transiciones
     suaves (crossfade + zoom tipo Ken Burns) y autoavance.
     ========================================================= */
  var pres = {
    activa: false, lista: [], indice: 0, timer: null,
    pausada: false, intervalo: 8000, oculto: false
  };

  function animar(el, clase) {
    el.classList.remove(clase);
    void el.offsetWidth;              // reinicia la animación CSS
    el.classList.add(clase);
  }

  function presMostrar(primera) {
    var f = pres.lista[pres.indice];
    if (!f) return;
    var esVideo = f.tipo === 'video';
    var img = $('#presentImg'), vid = $('#presentVideo');
    var prevImg = $('#presentImgPrev'), prevVid = $('#presentVideoPrev');

    // lo que estaba pasa a la capa de salida
    if (!primera) {
      if (!img.hidden) {
        prevImg.src = img.src;
        prevImg.hidden = false;
        animar(prevImg, 'capa-salida');
      } else if (!vid.hidden) {
        prevVid.src = vid.currentSrc || vid.src;
        prevVid.poster = vid.poster || '';
        prevVid.muted = true;
        prevVid.hidden = false;
        animar(prevVid, 'capa-salida');
      }
      setTimeout(function () {
        prevImg.hidden = true;
        prevVid.hidden = true;
        try { prevVid.pause(); } catch (e) {}
      }, 1100);
    }

    if (esVideo) {
      img.hidden = true;
      img.removeAttribute('src');
      vid.hidden = false;
      vid.src = f.src;
      vid.poster = f.poster || '';
      vid.muted = false;
      animar(vid, 'capa-entrada');
      var p = vid.play();
      if (p && p.catch) {
        p.catch(function () {            // el navegador bloquea sonido: seguimos en mudo
          vid.muted = true;
          var p2 = vid.play();
          if (p2 && p2.catch) p2.catch(function () {});
        });
      }
    } else {
      vid.hidden = true;
      try { vid.pause(); } catch (e) {}
      vid.removeAttribute('src');
      img.hidden = false;
      img.src = f.src;
      img.alt = f.titulo;
      animar(img, 'capa-entrada');
    }

    $('#presentTitulo').textContent = f.titulo;
    $('#presentMeta').textContent = [
      f.album,
      fmtFecha(f.fecha),
      esVideo ? fmtDur(f.duracion) : null
    ].filter(Boolean).join(' · ');
    var num = $('#presentNum');
    if (num) num.textContent = (pres.indice + 1) + ' / ' + pres.lista.length;
  }

  function presBarra(ms) {
    var barra = $('#presentBarra');
    barra.style.transition = 'none';
    barra.style.width = '0%';
    void barra.offsetWidth;
    if (pres.pausada) return;
    barra.style.transition = 'width ' + ms + 'ms linear';
    barra.style.width = '100%';
  }

  function presArrancar() {
    clearTimeout(pres.timer);
    if (pres.pausada || !pres.activa) return;
    var f = pres.lista[pres.indice];
    var espera = pres.intervalo;
    if (f && f.tipo === 'video') {
      espera = Math.min(60000, Math.max(5000, ((f.duracion || 10) + 2) * 1000));
    }
    presBarra(espera);
    pres.timer = setTimeout(presSiguiente, espera);
  }

  function presSiguiente() {
    if (!pres.activa) return;
    pres.indice = (pres.indice + 1) % pres.lista.length;
    presMostrar(false);
    presArrancar();
  }
  function presAnterior() {
    if (!pres.activa) return;
    pres.indice = (pres.indice - 1 + pres.lista.length) % pres.lista.length;
    presMostrar(false);
    presArrancar();
  }
  function presPausa() {
    pres.pausada = !pres.pausada;
    $('#presentPlay').textContent = pres.pausada ? '▶' : '⏸';
    $('#presentPlay').setAttribute('aria-label', pres.pausada ? 'Reanudar' : 'Pausar');
    var vid = $('#presentVideo');
    if (!vid.hidden) {
      if (pres.pausada) { try { vid.pause(); } catch (e) {} }
      else { var p = vid.play(); if (p && p.catch) p.catch(function () {}); }
    }
    if (pres.pausada) {
      clearTimeout(pres.timer);
      var barra = $('#presentBarra');
      var w = barra.getBoundingClientRect().width;
      var total = $('#presentBarra').parentElement.getBoundingClientRect().width;
      barra.style.transition = 'none';
      barra.style.width = (total ? (w / total) * 100 : 0) + '%';
    } else {
      presArrancar();
    }
  }

  function abrirPresentacion() {
    var lista = filtrar();
    if (!lista.length) { toast('No hay nada que presentar: cambia los filtros.', 'err'); return; }
    pres.lista = lista;
    pres.indice = 0;
    pres.activa = true;
    pres.pausada = false;
    $('#presentPlay').textContent = '⏸';
    $('#present').hidden = false;
    document.body.style.overflow = 'hidden';
    presMostrar(true);
    presArrancar();
    var p = $('#present');
    try {
      if (p.requestFullscreen) p.requestFullscreen();
      else if (p.webkitRequestFullscreen) p.webkitRequestFullscreen();
    } catch (e) {}
    presMostrarControles();
  }

  function cerrarPresentacion() {
    pres.activa = false;
    clearTimeout(pres.timer);
    $('#present').hidden = true;
    document.body.style.overflow = '';
    var vid = $('#presentVideo');
    try { vid.pause(); } catch (e) {}
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (e) {}
  }

  function presMostrarControles() {
    var c = $('#presentControles');
    if (!c) return;
    c.classList.remove('ocultos');
    clearTimeout(pres._t);
    pres._t = setTimeout(function () {
      if (pres.activa && !pres.pausada) c.classList.add('ocultos');
    }, 3200);
  }

  /* ---------------- intro de estrellitas ---------------- */
  function iniciarIntro() {
    var intro = $('#intro');
    if (!intro) return;
    // ?intro=0 la desactiva, ?intro=1 la fuerza (útil para probarla)
    var q = location.search;
    if (/[?&]intro=0/.test(q)) { intro.remove(); return; }
    var forzada = /[?&]intro=1/.test(q);
    var reducido = !forzada && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducido) { intro.remove(); return; }

    document.body.classList.add('intro-abierta');
    var cielo = $('#introCielo');
    var i, el, tam;

    for (i = 0; i < 90; i++) {
      el = document.createElement('span');
      el.className = 'intro-punto';
      tam = 2 + Math.random() * 4.5;
      el.style.width = tam + 'px';
      el.style.height = tam + 'px';
      el.style.left = (Math.random() * 100).toFixed(2) + '%';
      el.style.top = (Math.random() * 100).toFixed(2) + '%';
      el.style.animationDelay = (Math.random() * 1.8).toFixed(2) + 's';
      el.style.animationDuration = (1.4 + Math.random() * 1.8).toFixed(2) + 's';
      cielo.appendChild(el);
    }
    for (i = 0; i < 7; i++) {
      el = document.createElement('span');
      el.className = 'intro-destello';
      el.textContent = i % 2 ? '✦' : '✧';
      el.style.left = (6 + Math.random() * 88).toFixed(2) + '%';
      el.style.top = (4 + Math.random() * 80).toFixed(2) + '%';
      el.style.fontSize = (14 + Math.random() * 16).toFixed(0) + 'px';
      el.style.animationDelay = (0.4 + Math.random() * 1.3).toFixed(2) + 's';
      cielo.appendChild(el);
    }

    var cerrada = false;
    var cerrar = function () {
      if (cerrada) return;
      cerrada = true;
      document.body.classList.remove('intro-abierta');
      intro.classList.add('saliendo');
      setTimeout(function () { if (intro.parentNode) intro.remove(); }, 900);
    };
    setTimeout(cerrar, 2700);
    intro.addEventListener('click', cerrar);
    intro.addEventListener('touchstart', cerrar, { passive: true });
  }

  /* ---------------- gestos de deslizar ---------------- */
  function permitirDeslizar(el, alIzquierda, alDerecha) {
    if (!el) return;
    var x0 = null, y0 = null, t0 = 0;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0, dt = Date.now() - t0;
      x0 = null;
      if (dt > 800) return;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      if (dx < 0) alIzquierda(); else alDerecha();
    }, { passive: true });
  }

  /* ---------------- tema día / "antes de dormir" ---------------- */
  function aplicarTema(t) {
    document.documentElement.setAttribute('data-theme', t);
    var noche = t === 'dark';
    if ($('#iconoTema')) $('#iconoTema').textContent = noche ? '☀️' : '🌙';
    if ($('#textoTema')) $('#textoTema').textContent = noche ? 'Salir el sol' : 'Antes de dormir';
    if ($('#bmIconoTema')) $('#bmIconoTema').textContent = noche ? '☀️' : '🌙';
    if ($('#bmTextoTema')) $('#bmTextoTema').textContent = noche ? 'Día' : 'Noche';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', noche ? '#0d1b3e' : '#9be2ff');
    localStorage.setItem('jenniper.tema', t);
  }
  function alternarTema() {
    aplicarTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  /* ---------------- eventos ---------------- */
  function wire() {
    // tema
    aplicarTema(localStorage.getItem('jenniper.tema') || 'light');
    $('#btnTema').addEventListener('click', alternarTema);
    $('#bmTema').addEventListener('click', alternarTema);

    // música de fondo
    $('#btnMusica').addEventListener('click', alternarMusica);
    $('#bmMusica').addEventListener('click', alternarMusica);
    $('#presentMusica').addEventListener('click', alternarMusica);
    if (localStorage.getItem('jenniper.musica') === '1') {
      // los navegadores exigen un gesto previo: arranca al primer clic/tecla,
      // pero solo si el usuario no ha apagado la música mientras tanto.
      var arranque = function (e) {
        document.removeEventListener('click', arranque);
        document.removeEventListener('keydown', arranque);
        var enBotonMusica = e && e.target && e.target.closest &&
          e.target.closest('#btnMusica, #bmMusica, #presentMusica');
        if (enBotonMusica) return;                       // ese botón ya decide
        if (localStorage.getItem('jenniper.musica') !== '1') return;
        if (window.Musica && !Musica.sonando) { Musica.iniciar(); sincronizarMusica(); }
      };
      document.addEventListener('click', arranque);
      document.addEventListener('keydown', arranque);
    }
    sincronizarMusica();

    // modo presentación
    $('#btnPresentar').addEventListener('click', abrirPresentacion);
    $('#bmCuento').addEventListener('click', abrirPresentacion);
    $('#presentSalir').addEventListener('click', cerrarPresentacion);
    $('#presentNext').addEventListener('click', function () { presSiguiente(); presMostrarControles(); });
    $('#presentPrev').addEventListener('click', function () { presAnterior(); presMostrarControles(); });
    $('#presentPlay').addEventListener('click', function () { presPausa(); presMostrarControles(); });
    $('#presentVel').addEventListener('change', function () {
      pres.intervalo = +this.value || 8000;
      if (pres.activa) presArrancar();
    });
    $('#presentVideo').addEventListener('ended', function () { if (pres.activa) presSiguiente(); });
    $('#present').addEventListener('mousemove', presMostrarControles);
    $('#present').addEventListener('click', presMostrarControles);
    permitirDeslizar($('#present'),
      function () { presSiguiente(); presMostrarControles(); },
      function () { presAnterior(); presMostrarControles(); });
    permitirDeslizar($('#lb'), function () { moverLightbox(1); }, function () { moverLightbox(-1); });

    // filtros plegables (móvil)
    $('#bmFiltros').addEventListener('click', function () {
      var tb = $('#toolbar');
      var abierto = tb.classList.toggle('abierto');
      this.classList.toggle('is-on', abierto);
      if (abierto) tb.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && pres.activa && !$('#present').hidden) {
        // se salió de pantalla completa (Esc del navegador): cerramos la presentación
        cerrarPresentacion();
      }
    });

    // filtros
    var t;
    $('#q').addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { state.filtro.q = $('#q').value; renderGaleria(); }, 160);
    });
    $('#fAlbum').addEventListener('change', function () { state.filtro.album = this.value; renderGaleria(); });
    $('#fOrden').addEventListener('change', function () { state.filtro.orden = this.value; renderGaleria(); });
    $('#fFavs').addEventListener('change', function () { state.filtro.soloFavs = this.checked; renderGaleria(); });

    $('#fTags').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tag]');
      if (!b) return;
      state.filtro.tag = state.filtro.tag === b.dataset.tag ? '' : b.dataset.tag;
      renderTags(); renderGaleria();
    });

    $$('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.seg-btn').forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        state.vista = b.dataset.view;
        var g = $('#galeria');
        g.classList.toggle('masonry', state.vista === 'masonry');
        g.classList.toggle('grid', state.vista === 'grid');
      });
    });

    // galería
    $('#galeria').addEventListener('click', function (e) {
      var c = e.target.closest('.card');
      if (c) abrirLightbox(c.dataset.id);
    });
    $('#galeria').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var c = e.target.closest('.card');
      if (c) { e.preventDefault(); abrirLightbox(c.dataset.id); }
    });

    // lightbox
    $('#lbClose').addEventListener('click', cerrarLightbox);
    $('#lbPrev').addEventListener('click', function () { moverLightbox(-1); });
    $('#lbNext').addEventListener('click', function () { moverLightbox(1); });
    $('#lb').addEventListener('click', function (e) { if (e.target === this) cerrarLightbox(); });
    $('#lbFav').addEventListener('click', function () { alternarFavorita(fotoActual()); });
    $('#lbCopiar').addEventListener('click', function () { copiarEnlace(fotoActual()); });
    $('#lbDescargar').addEventListener('click', function () { descargar(fotoActual()); });
    $('#lbBorrar').addEventListener('click', function () { eliminarFoto(fotoActual()); });
    $('#lbTags').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tag]');
      if (!b) return;
      state.filtro.tag = b.dataset.tag;
      renderTags(); renderGaleria(); cerrarLightbox();
    });
    $('#lbForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var texto = $('#lbTexto').value.trim();
      if (!texto) return;
      var autor = $('#lbAutor').value.trim();
      localStorage.setItem('jenniper.autor', autor);
      $('#lbTexto').value = '';
      añadirComentario(fotoActual(), texto, autor);
    });

    document.addEventListener('keydown', function (e) {
      if (pres.activa) {
        if (e.key === 'Escape') cerrarPresentacion();
        else if (e.key === 'ArrowLeft') { presAnterior(); presMostrarControles(); }
        else if (e.key === 'ArrowRight') { presSiguiente(); presMostrarControles(); }
        else if (e.key === ' ') { e.preventDefault(); presPausa(); presMostrarControles(); }
        return;
      }
      if (!state.lb.abierto) return;
      if (e.key === 'Escape') cerrarLightbox();
      if (e.key === 'ArrowLeft') moverLightbox(-1);
      if (e.key === 'ArrowRight') moverLightbox(1);
    });

    // subida
    $('#btnSubir').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function () { prepararSubida(this.files); this.value = ''; });
    $('#btnCancelarSubida').addEventListener('click', function () {
      staging.forEach(function (s) { URL.revokeObjectURL(s.preview); });
      staging = [];
      $('#uploader').hidden = true;
      $('#upList').innerHTML = '';
    });
    $('#upAlbum').addEventListener('input', renderStaging);
    $('#upTags').addEventListener('input', renderStaging);
    $('#upList').addEventListener('input', function (e) {
      var i = e.target.dataset.titulo;
      if (i != null && staging[i]) staging[i].titulo = e.target.value;
    });
    $('#upList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-quitar]');
      if (!b) return;
      var i = +b.dataset.quitar;
      URL.revokeObjectURL(staging[i].preview);
      staging.splice(i, 1);
      renderStaging();
    });
    $('#btnPublicar').addEventListener('click', publicar);

    // drag & drop global
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) prepararSubida(e.dataTransfer.files);
    });

    window.addEventListener('hashchange', abrirPorHash);
  }

  function abrirPorHash() {
    var m = location.hash.match(/^#foto=(.+)$/);
    if (m) abrirLightbox(decodeURIComponent(m[1]));
  }

  document.addEventListener('DOMContentLoaded', function () {
    iniciarIntro();
    wire();
    init();
  });
})();
