/* =========================================================
   musica.js · Música de fondo suave, sintetizada con Web Audio
   ---------------------------------------------------------
   No hay archivos de audio: es una "caja de música" generada
   en tiempo real (pentatónica de Do mayor, tempo lento, con
   pad suave). Se activa con un botón porque los navegadores
   no permiten reproducir sonido sin un gesto del usuario.
   ========================================================= */
(function (global) {
  'use strict';

  var ctx = null, master = null, filtro = null, pad = null;
  var timer = null, sonando = false, paso = 0, proximo = 0;
  var VOLUMEN = 0.16;

  // pentatónica de Do mayor (Hz), de grave a agudo
  var NOTAS = [130.81, 196.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
  var PULSO = 0.62;          // segundos por pulso (tempo suave)
  // frase: [nota, pulsos]; -1 = silencio
  var FRASE = [
    [5, 1], [7, 1], [6, 1], [5, 1], [4, 2], [-1, 1], [4, 1],
    [5, 1], [4, 1], [3, 1], [4, 1], [2, 3],
    [4, 1], [5, 1], [7, 1], [8, 1], [7, 2], [-1, 1], [5, 1],
    [6, 1], [5, 1], [4, 1], [3, 1], [4, 3]
  ];

  function crear() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 2200;
    filtro.Q.value = 0.6;

    filtro.connect(master);
    master.connect(ctx.destination);

    // pad suave de fondo: dos senos muy bajos
    pad = ctx.createGain();
    pad.gain.value = 0.035;
    [130.81, 196.00, 329.63].forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (1 + (i - 1) * 0.0015);   // desafinado milimétrico
      var g = ctx.createGain();
      g.gain.value = i === 2 ? 0.18 : 0.5;
      o.connect(g); g.connect(pad);
      o.start();
    });
    pad.connect(filtro);
    return ctx;
  }

  function nota(freq, cuando, dur, volumen) {
    var t = cuando;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volumen, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;

    var brillo = ctx.createOscillator();      // armónico suave tipo caja
    brillo.type = 'sine';
    brillo.frequency.value = freq * 2;
    var bg = ctx.createGain();
    bg.gain.value = 0.12;

    o.connect(g);
    brillo.connect(bg); bg.connect(g);
    g.connect(filtro);

    o.start(t); o.stop(t + dur + 0.05);
    brillo.start(t); brillo.stop(t + dur + 0.05);
  }

  function programar() {
    if (!ctx) return;
    while (proximo < ctx.currentTime + 1.2) {
      var pasoActual = FRASE[paso % FRASE.length];
      var freq = NOTAS[pasoActual[0]];
      if (freq) {
        nota(freq, proximo, Math.min(1.9, pasoActual[1] * PULSO + 0.7), VOLUMEN);
        // nota octava más grave, muy tenue, para dar cuerpo
        if (paso % 4 === 0) nota(freq / 2, proximo, 1.4, VOLUMEN * 0.22);
      }
      proximo += pasoActual[1] * PULSO;
      paso++;
    }
    timer = setTimeout(programar, 400);
  }

  var Musica = {
    iniciar: function () {
      if (sonando) return true;
      if (!crear()) return false;
      if (ctx.state === 'suspended') ctx.resume();
      paso = 0;
      proximo = ctx.currentTime + 0.15;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.6);   // fundido de entrada
      programar();
      sonando = true;
      return true;
    },
    parar: function () {
      if (!ctx || !sonando) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      clearTimeout(timer);
      timer = null;
      sonando = false;
    },
    alternar: function () {
      if (sonando) { Musica.parar(); } else { Musica.iniciar(); }
      return sonando;
    },
    get sonando() { return sonando; }
  };

  global.Musica = Musica;
})(window);
