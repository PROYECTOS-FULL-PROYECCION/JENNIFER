/* =========================================================
   db.js · IndexedDB mínimo para las fotos locales
   (modo "subir desde el navegador"). En GitLab Pages las fotos
   reales viven en assets/fotos/ + data/galeria.json.
   ========================================================= */
(function (global) {
  'use strict';

  var DB_NAME = 'jenniper-galeria';
  var DB_VERSION = 1;
  var STORE = 'fotos';

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var DB = {
    all: function () {
      return tx('readonly', function (s) { return s.getAll(); });
    },
    put: function (record) {
      return tx('readwrite', function (s) { s.put(record); return record; });
    },
    del: function (id) {
      return tx('readwrite', function (s) { s.delete(id); return id; });
    },
    clear: function () {
      return tx('readwrite', function (s) { s.clear(); return true; });
    },
    /** Igual que all() pero nunca lanza: devuelve [] si IndexedDB no está disponible. */
    safeAll: function () {
      return DB.all().catch(function () { return []; });
    }
  };

  global.GaleriaDB = DB;
})(window);
