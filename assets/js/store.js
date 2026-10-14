/* =========================================================
   Store — хранилище данных и фотографий.
   Текст/настройки  -> localStorage
   Фотографии       -> IndexedDB (Blob), ссылки вида "idb:<key>"
   ========================================================= */
window.Store = (function () {
  "use strict";

  var LS_KEY = "nail_studio_v1";
  var IDB_NAME = "nail_studio_media";
  var IDB_STORE = "images";

  var dbPromise = null;
  var urlCache = {};   // key -> objectURL
  var blobCache = {};  // key -> Blob

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defaults() {
    var base = window.DEFAULT_DATA || { profile: {}, prices: [], works: [], news: [] };
    var d = clone(base);
    return normalize(d);
  }

  function normalize(d) {
    d = d || {};
    var def = clone(window.DEFAULT_DATA || { profile: {} });
    d.profile = Object.assign({}, def.profile || {}, d.profile || {});
    d.prices = Array.isArray(d.prices) ? d.prices : [];
    d.works = Array.isArray(d.works) ? d.works : [];
    d.news = Array.isArray(d.news) ? d.news : [];
    if (!d.version) d.version = 1;
    return d;
  }

  function hasLocal() {
    try { return !!localStorage.getItem(LS_KEY); } catch (e) { return false; }
  }

  function load() {
    if (hasLocal()) {
      try { return normalize(JSON.parse(localStorage.getItem(LS_KEY))); } catch (e) { /* испорченные данные -> defaults */ }
    }
    return defaults();
  }

  function save(d) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(normalize(d)));
      return true;
    } catch (e) {
      console.warn("Не удалось сохранить данные:", e);
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- ссылки на картинки ---------- */
  function isLocalRef(ref) {
    return typeof ref === "string" && ref.indexOf("idb:") === 0;
  }
  function keyOf(ref) { return ref.slice(4); }

  /* ---------- IndexedDB ---------- */
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        if (!("indexedDB" in window)) return resolve(null);
        var req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }

  function idbPut(key, blob) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve, reject) {
        var t = d.transaction(IDB_STORE, "readwrite");
        t.objectStore(IDB_STORE).put(blob, key);
        t.oncomplete = function () { resolve(key); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function idbGet(key) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        var t = d.transaction(IDB_STORE, "readonly");
        var r = t.objectStore(IDB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      });
    });
  }

  function idbDelete(key) {
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        var t = d.transaction(IDB_STORE, "readwrite");
        t.objectStore(IDB_STORE).delete(key);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { resolve(); };
      });
    });
  }

  function idbClear() {
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        var t = d.transaction(IDB_STORE, "readwrite");
        t.objectStore(IDB_STORE).clear();
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { resolve(); };
      });
    });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  /* ---------- публичный API картинок ---------- */
  // Возвращает ссылку для хранения в данных ("idb:<key>" или data:...)
  async function putImage(blob) {
    var key = uid("img");
    var d = await db();
    if (d) {
      try {
        await idbPut(key, blob);
        urlCache[key] = URL.createObjectURL(blob);
        blobCache[key] = blob;
        return "idb:" + key;
      } catch (e) { /* падаем в data URL */ }
    }
    return await blobToDataURL(blob); // запасной вариант
  }

  // Возвращает URL для <img src>
  async function getImageURL(ref) {
    if (!ref) return "";
    if (!isLocalRef(ref)) return ref;
    var key = keyOf(ref);
    if (urlCache[key]) return urlCache[key];
    var blob = await idbGet(key);
    if (!blob) return "";
    var url = URL.createObjectURL(blob);
    urlCache[key] = url;
    blobCache[key] = blob;
    return url;
  }

  async function removeImage(ref) {
    if (!isLocalRef(ref)) return;
    var key = keyOf(ref);
    if (urlCache[key]) { try { URL.revokeObjectURL(urlCache[key]); } catch (e) {} delete urlCache[key]; }
    delete blobCache[key];
    await idbDelete(key);
  }

  // Для экспорта: превращаем idb-ссылки в data URL (или оставляем путь как есть)
  async function exportImageDataURL(ref) {
    if (!ref) return "";
    if (!isLocalRef(ref)) return ref;
    var key = keyOf(ref);
    var blob = blobCache[key] || await idbGet(key);
    if (!blob) return "";
    return await blobToDataURL(blob);
  }

  async function clearAllImages() {
    for (var k in urlCache) { try { URL.revokeObjectURL(urlCache[k]); } catch (e) {} }
    urlCache = {}; blobCache = {};
    await idbClear();
  }

  return {
    LS_KEY: LS_KEY,
    defaults: defaults,
    normalize: normalize,
    hasLocal: hasLocal,
    load: load,
    save: save,
    clear: clear,
    uid: uid,
    isLocalRef: isLocalRef,
    putImage: putImage,
    getImageURL: getImageURL,
    removeImage: removeImage,
    exportImageDataURL: exportImageDataURL,
    blobToDataURL: blobToDataURL,
    clearAllImages: clearAllImages
  };
})();
