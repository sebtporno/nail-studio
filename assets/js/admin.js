/* =========================================================
   admin.js — логика панели мастера.
   Два режима:
     • онлайн  — сайт работает с сервером (Node.js + PostgreSQL),
                 вход по логину/паролю, изменения сразу в интернете;
     • офлайн  — сервера нет: данные хранятся в браузере (как раньше).
   ========================================================= */
(function () {
  "use strict";

  var MODE = "local";        // "local" | "online"
  var TOKEN = null;
  var API = "api/";
  var D = null;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var saveEl = $("#saveStatus");
  var statusTimer = null;
  function status(msg) { if (saveEl) saveEl.textContent = msg || ""; }
  function flashLater() {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { status(""); }, 2400);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function find(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* =========================================================
     Работа с сервером
     ========================================================= */
  function apiUrl(p) { return API + p; }

  async function apiFetch(p, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body && typeof opts.body !== "string") { opts.body = JSON.stringify(opts.body); }
    if (opts.body) headers["Content-Type"] = "application/json";
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    var res = await fetch(apiUrl(p), Object.assign({}, opts, { headers: headers }));
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || ("Ошибка " + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function detectApi() {
    if (location.protocol === "file:") return false; // открыто как файл — сервера нет
    try {
      var res = await fetch(apiUrl("health"), { cache: "no-store" });
      if (!res.ok) return false;
      var d = await res.json();
      return !!(d && d.ok);
    } catch (e) { return false; }
  }

  // Сохраняет фото: на сервер (онлайн) или в браузер (офлайн). Возвращает ссылку.
  async function saveImageBlob(blob) {
    if (MODE === "online") {
      var fd = new FormData();
      fd.append("image", blob, "photo.jpg");
      var headers = TOKEN ? { Authorization: "Bearer " + TOKEN } : {};
      var res = await fetch(apiUrl("admin/upload"), { method: "POST", headers: headers, body: fd });
      var data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) {
        var err = new Error((data && data.error) || "Не удалось загрузить фото");
        err.status = res.status;
        throw err;
      }
      return data.url;
    }
    return await Store.putImage(blob);
  }

  /* =========================================================
     Сохранение
     ========================================================= */
  var remoteTimer = null;
  function persist() {
    if (MODE === "online") { scheduleRemote(); return; }
    var ok = Store.save(D);
    status(ok ? "Сохранено ✓" : "Ошибка сохранения!");
    flashLater();
  }
  function saveLocal() { if (MODE === "local") Store.save(D); }

  function scheduleRemote() {
    status("Сохраняем…");
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteTimer = setTimeout(async function () {
      try {
        await apiFetch("admin/data", {
          method: "PUT",
          body: { profile: D.profile, prices: D.prices, works: D.works, news: D.news }
        });
        status("Сохранено на сервере ✓");
        flashLater();
      } catch (e) {
        if (e.status === 401) return handleUnauthorized();
        status("Ошибка сохранения!");
      }
    }, 700);
  }

  /* =========================================================
     Вход / выход
     ========================================================= */
  function showLogin(msg) {
    var gate = $("#loginGate"); if (gate) gate.hidden = false;
    var m = $("#loginMsg");
    if (m) { m.textContent = msg || ""; m.classList.remove("ok"); }
    var p = $("#loginPass"); if (p) p.value = "";
    var u = $("#loginUser"); if (u && !u.value) u.value = "admin";
  }
  function hideLogin() { var gate = $("#loginGate"); if (gate) gate.hidden = true; }

  function handleUnauthorized() {
    TOKEN = null;
    try { localStorage.removeItem("nail_token"); } catch (e) {}
    showLogin("Сеанс истёк — войдите заново.");
  }

  function bindLogin() {
    var form = $("#loginForm");
    if (form) form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var msg = $("#loginMsg"), btn = $("#loginBtn");
      var u = ($("#loginUser") || {}).value || "";
      var p = ($("#loginPass") || {}).value || "";
      if (msg) { msg.textContent = ""; msg.classList.remove("ok"); }
      if (btn) { btn.disabled = true; btn.textContent = "Входим…"; }
      try {
        var res = await fetch(apiUrl("auth/login"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: u, password: p })
        });
        var data = null;
        try { data = await res.json(); } catch (e) {}
        if (!res.ok) throw new Error((data && data.error) || "Не удалось войти");
        TOKEN = data.token;
        try { localStorage.setItem("nail_token", TOKEN); } catch (e) {}
        hideLogin();
        await enterOnline();
      } catch (err) {
        if (msg) msg.textContent = err.message || "Не удалось войти";
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Войти"; }
      }
    });

    var out = $("#logoutBtn");
    if (out) out.addEventListener("click", function () {
      TOKEN = null;
      try { localStorage.removeItem("nail_token"); } catch (e) {}
      location.reload();
    });
  }

  /* =========================================================
     Обработка фото
     ========================================================= */
  function compressImage(file, maxDim) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width, h = img.height, scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (blob) { resolve(blob || file); }, "image/jpeg", 0.82);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Не удалось прочитать фото")); };
      img.src = url;
    });
  }

  function dataURLtoBlob(dataURL) {
    var parts = dataURL.split(","), mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
    var raw = atob(parts[1]), n = raw.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
  }

  async function refreshThumb(imgEl, ref) {
    var url = await Store.getImageURL(ref);
    if (url) { imgEl.src = url; imgEl.removeAttribute("hidden"); }
    else { imgEl.removeAttribute("src"); imgEl.setAttribute("hidden", ""); }
  }

  /* =========================================================
     Табы
     ========================================================= */
  function initTabs() {
    $$(".adm-tab").forEach(function (t) {
      t.addEventListener("click", function () {
        $$(".adm-tab").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        var name = t.getAttribute("data-tab");
        $$(".adm-panel").forEach(function (p) { p.hidden = p.id !== "tab-" + name; });
        window.scrollTo({ top: 0 });
        if (name === "bookings" && MODE === "online") loadBookings();
        if (name === "notify" && MODE === "online") loadNotify();
      });
    });
  }

  /* =========================================================
     Профиль
     ========================================================= */
  var PROFILE_FIELDS = ["brand", "brandSub", "master", "heroEyebrow", "heroTitle", "heroAccent", "tagline", "aboutTitle", "about", "city", "address", "phone", "phoneRaw", "hours", "mapUrl", "telegram", "instagram", "email"];

  function renderProfile() {
    var p = D.profile || {};
    PROFILE_FIELDS.forEach(function (f) {
      var el = document.getElementById("pf-" + f);
      if (el) el.value = p[f] || "";
    });
    refreshThumb($("#pf-heroImage"), p.heroImage);
    refreshThumb($("#pf-aboutImage"), p.aboutImage);
    $("#pf-heroImageRemove").hidden = !p.heroImage;
    $("#pf-aboutImageRemove").hidden = !p.aboutImage;
  }

  function bindProfile() {
    PROFILE_FIELDS.forEach(function (f) {
      var el = document.getElementById("pf-" + f);
      if (!el) return;
      el.addEventListener("input", function () { D.profile[f] = el.value; persist(); });
    });
    bindImageField("heroImage", "#pf-heroImageBtn", "#pf-heroImageFile", "#pf-heroImage", "#pf-heroImageRemove");
    bindImageField("aboutImage", "#pf-aboutImageBtn", "#pf-aboutImageFile", "#pf-aboutImage", "#pf-aboutImageRemove");
  }

  function bindImageField(field, btnSel, fileSel, imgSel, removeSel) {
    var btnEl = $(btnSel), fileEl = $(fileSel), imgEl = $(imgSel), rmEl = $(removeSel);
    if (btnEl && fileEl) btnEl.addEventListener("click", function () { fileEl.click(); });
    if (fileEl) fileEl.addEventListener("change", async function () {
      var file = fileEl.files[0]; if (!file) return;
      fileEl.value = "";
      status("Обработка фото…");
      try {
        var blob = await compressImage(file, 1500);
        var ref = await saveImageBlob(blob);
        var old = D.profile[field];
        if (old) await Store.removeImage(old);
        D.profile[field] = ref;
        persist();
        await refreshThumb(imgEl, ref);
        if (rmEl) rmEl.hidden = false;
      } catch (e) { alert("Не удалось загрузить фото: " + (e.message || "ошибка")); status(""); }
    });
    if (rmEl) rmEl.addEventListener("click", async function () {
      var old = D.profile[field];
      if (old) await Store.removeImage(old);
      D.profile[field] = "";
      persist();
      await refreshThumb(imgEl, "");
      rmEl.hidden = true;
    });
  }

  /* ---------- цифры на главном ---------- */
  function renderStats() {
    var el = $("#statsEditor"); if (!el) return;
    var list = Array.isArray(D.profile.stats) ? D.profile.stats : [];
    el.innerHTML = list.map(function (s, i) {
      return '<div class="kv-row"><input class="v" data-k="value" data-i="' + i + '" value="' + esc(s.value || "") + '" placeholder="5+"><input class="l" data-k="label" data-i="' + i + '" value="' + esc(s.label || "") + '" placeholder="лет опыта"><button class="icon-btn" data-del="' + i + '" type="button">✕</button></div>';
    }).join("") || '<p class="adm-note">Пока ничего нет.</p>';
  }
  function bindStats() {
    var el = $("#statsEditor"); if (!el) return;
    el.addEventListener("input", function (e) {
      var t = e.target;
      if (!t.dataset.k) return;
      var i = parseInt(t.dataset.i, 10);
      if (isNaN(i) || !D.profile.stats[i]) return;
      D.profile.stats[i][t.dataset.k] = t.value;
      persist();
    });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-del]");
      if (!b) return;
      var i = parseInt(b.dataset.del, 10);
      if (isNaN(i)) return;
      D.profile.stats.splice(i, 1);
      saveLocal();
      renderStats();
      persist();
    });
    $("#statsAdd").addEventListener("click", function () {
      if (!Array.isArray(D.profile.stats)) D.profile.stats = [];
      D.profile.stats.push({ value: "", label: "" });
      saveLocal();
      renderStats();
    });
  }

  /* ---------- преимущества ---------- */
  var FEATURE_ICONS = ["sparkle", "heart", "clock", "shield", "star", "gift", "leaf"];
  var FEATURE_ICON_LABELS = { sparkle: "Блеск", heart: "Сердце", clock: "Часы", shield: "Щит", star: "Звезда", gift: "Подарок", leaf: "Лист" };

  function renderFeatures() {
    var el = $("#featuresEditor"); if (!el) return;
    var list = Array.isArray(D.profile.features) ? D.profile.features : [];
    el.innerHTML = list.map(function (f, i) {
      var opts = FEATURE_ICONS.map(function (ic) {
        return '<option value="' + ic + '"' + (f.icon === ic ? " selected" : "") + ">" + FEATURE_ICON_LABELS[ic] + "</option>";
      }).join("");
      return '<div class="kv-row"><select data-k="icon" data-i="' + i + '">' + opts + '</select><input class="l" data-k="title" data-i="' + i + '" value="' + esc(f.title || "") + '" placeholder="Название"><input class="l" data-k="text" data-i="' + i + '" value="' + esc(f.text || "") + '" placeholder="Описание"><button class="icon-btn" data-del="' + i + '" type="button">✕</button></div>';
    }).join("") || '<p class="adm-note">Пока ничего нет.</p>';
  }
  function bindFeatures() {
    var el = $("#featuresEditor"); if (!el) return;
    el.addEventListener("input", function (e) {
      var t = e.target;
      if (!t.dataset.k) return;
      var i = parseInt(t.dataset.i, 10);
      if (isNaN(i) || !D.profile.features[i]) return;
      D.profile.features[i][t.dataset.k] = t.value;
      persist();
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (!t.dataset.k) return;
      var i = parseInt(t.dataset.i, 10);
      if (isNaN(i) || !D.profile.features[i]) return;
      D.profile.features[i][t.dataset.k] = t.value;
      persist();
    });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-del]");
      if (!b) return;
      var i = parseInt(b.dataset.del, 10);
      if (isNaN(i)) return;
      D.profile.features.splice(i, 1);
      saveLocal();
      renderFeatures();
      persist();
    });
    $("#featuresAdd").addEventListener("click", function () {
      if (!Array.isArray(D.profile.features)) D.profile.features = [];
      D.profile.features.push({ icon: "sparkle", title: "", text: "" });
      saveLocal();
      renderFeatures();
    });
  }

  /* =========================================================
     Прайс
     ========================================================= */
  function renderPrices() {
    var rowsEl = $("#priceRows"); if (!rowsEl) return;
    var list = Array.isArray(D.prices) ? D.prices : [];
    rowsEl.innerHTML = list.map(function (it) {
      return '<div class="price-row-adm" data-id="' + esc(it.id) + '">' +
        '<input class="c" data-f="category" value="' + esc(it.category || "") + '" placeholder="Категория">' +
        '<input class="n" data-f="name" value="' + esc(it.name || "") + '" placeholder="Название услуги">' +
        '<input class="p" data-f="price" value="' + esc(it.price || "") + '" placeholder="1500 ₽">' +
        '<input class="o" data-f="note" value="' + esc(it.note || "") + '" placeholder="Примечание">' +
        '<button class="icon-btn" data-del="' + esc(it.id) + '" type="button">✕</button>' +
        "</div>";
    }).join("") || '<p class="adm-note">Услуг пока нет — нажмите «Добавить услугу».</p>';
  }
  function bindPrices() {
    var rowsEl = $("#priceRows"); if (!rowsEl) return;
    rowsEl.addEventListener("input", function (e) {
      var t = e.target;
      if (!t.dataset.f) return;
      var row = t.closest(".price-row-adm"); if (!row) return;
      var it = find(D.prices, row.dataset.id); if (!it) return;
      it[t.dataset.f] = t.value;
      persist();
    });
    rowsEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-del]");
      if (!b) return;
      D.prices = D.prices.filter(function (x) { return x.id !== b.dataset.del; });
      saveLocal();
      renderPrices();
      persist();
    });
    $("#priceAdd").addEventListener("click", function () {
      D.prices.push({ id: Store.uid("p"), category: "", name: "", price: "", note: "" });
      saveLocal();
      renderPrices();
      persist();
      var last = $$(".price-row-adm", rowsEl).pop();
      if (last) { var inp = last.querySelector("input.n"); if (inp) inp.focus(); }
    });
  }

  /* =========================================================
     Работы
     ========================================================= */
  function renderWorks() {
    var grid = $("#workGrid"); if (!grid) return;
    var list = Array.isArray(D.works) ? D.works : [];
    grid.innerHTML = list.map(function (w) {
      return '<div class="media-card" data-id="' + esc(w.id) + '">' +
        '<div class="media-thumb' + (w.image ? "" : " empty") + '">' +
        '<img data-role="img" alt=""' + (w.image ? "" : " hidden") + ">" +
        '<button class="photo-btn" data-role="photo" type="button">📷 Фото работы</button>' +
        '<input type="file" data-role="file" accept="image/*" hidden>' +
        "</div>" +
        '<div class="field"><label>Название</label><input data-f="title" value="' + esc(w.title || "") + '"></div>' +
        '<div class="field"><label>Категория</label><input data-f="category" value="' + esc(w.category || "") + '" placeholder="Маникюр / Наращивание / Дизайн"></div>' +
        '<div class="field"><label>Дата (гггг-мм-дд)</label><input data-f="date" value="' + esc(w.date || "") + '" placeholder="2026-10-01"></div>' +
        '<div class="field"><label>Описание (необязательно)</label><textarea data-f="description" rows="2">' + esc(w.description || "") + "</textarea></div>" +
        '<button class="btn btn-ghost danger media-del" data-del="' + esc(w.id) + '" type="button">Удалить работу</button>' +
        "</div>";
    }).join("") || '<p class="adm-note">Работ ещё нет — нажмите «Добавить работу».</p>';

    list.forEach(function (w) {
      var card = grid.querySelector('[data-id="' + esc(w.id) + '"]');
      if (!card || !w.image) return;
      var img = card.querySelector('img[data-role="img"]');
      Store.getImageURL(w.image).then(function (url) {
        if (!url || !img) return;
        img.src = url;
        img.removeAttribute("hidden");
        var t = card.querySelector(".media-thumb");
        if (t) t.classList.remove("empty");
      });
    });
  }
  function bindWorks() {
    var grid = $("#workGrid"); if (!grid) return;

    grid.addEventListener("input", function (e) {
      var t = e.target;
      if (!t.dataset.f) return;
      var card = t.closest(".media-card"); if (!card) return;
      var w = find(D.works, card.dataset.id); if (!w) return;
      w[t.dataset.f] = t.value;
      persist();
    });

    grid.addEventListener("change", handleWorkFile);

    grid.addEventListener("click", function (e) {
      var b = e.target.closest("[data-role=photo], [data-del]");
      if (!b) return;
      var card = b.closest(".media-card"); if (!card) return;
      if (b.dataset.role === "photo") {
        var file = card.querySelector('input[data-role="file"]');
        if (file) file.click();
        return;
      }
      if (b.dataset.del) {
        if (!confirm("Удалить эту работу?")) return;
        var w = find(D.works, b.dataset.del);
        if (w && w.image) Store.removeImage(w.image);
        D.works = D.works.filter(function (x) { return x.id !== b.dataset.del; });
        saveLocal();
        renderWorks();
        persist();
      }
    });

    $("#workAdd").addEventListener("click", function () {
      D.works.push({ id: Store.uid("w"), title: "Новая работа", category: "", image: "", date: "", description: "" });
      saveLocal();
      renderWorks();
      persist();
      var last = $$(".media-card", grid).pop();
      if (last) { window.scrollTo({ top: last.offsetTop - 160, behavior: "smooth" }); }
    });
  }

  async function handleWorkFile(e) {
    var input = e.target;
    if (input.dataset.role !== "file") return;
    var file = input.files[0]; if (!file) return;
    input.value = "";
    var card = input.closest(".media-card"); if (!card) return;
    var w = find(D.works, card.dataset.id); if (!w) return;
    status("Обработка фото…");
    try {
      var blob = await compressImage(file, 1400);
      var ref = await saveImageBlob(blob);
      if (w.image) await Store.removeImage(w.image);
      w.image = ref;
      saveLocal();
      var img = card.querySelector('img[data-role="img"]');
      var url = await Store.getImageURL(ref);
      if (url && img) { img.src = url; img.removeAttribute("hidden"); }
      var t = card.querySelector(".media-thumb");
      if (t) t.classList.remove("empty");
      persist();
    } catch (err) { alert("Не удалось загрузить фото: " + (err.message || "ошибка")); status(""); }
  }

  /* =========================================================
     Новости
     ========================================================= */
  function renderNews() {
    var listEl = $("#newsList"); if (!listEl) return;
    var list = Array.isArray(D.news) ? D.news : [];
    listEl.innerHTML = list.map(function (n) {
      return '<div class="news-adm" data-id="' + esc(n.id) + '">' +
        '<div class="thumb-col"><img class="thumb" data-role="img" alt=""' + (n.image ? "" : " hidden") + ">" +
        '<button class="btn btn-ghost" data-role="photo" type="button" style="padding:9px 14px">📷 Фото</button>' +
        '<input type="file" data-role="file" accept="image/*" hidden></div>' +
        '<div class="fields">' +
        '<div class="field"><label>Заголовок</label><input data-f="title" value="' + esc(n.title || "") + '"></div>' +
        '<div class="field"><label>Дата (гггг-мм-дд)</label><input data-f="date" value="' + esc(n.date || "") + '" placeholder="2026-10-01"></div>' +
        '<div class="field full"><label>Текст новости</label><textarea data-f="text" rows="3">' + esc(n.text || "") + "</textarea></div>" +
        '<div class="field full"><button class="btn btn-ghost danger" data-del="' + esc(n.id) + '" type="button">Удалить новость</button></div>' +
        "</div></div>";
    }).join("") || '<p class="adm-note">Новостей пока нет.</p>';

    list.forEach(function (n) {
      var item = listEl.querySelector('[data-id="' + esc(n.id) + '"]');
      if (!item || !n.image) return;
      var img = item.querySelector('img[data-role="img"]');
      Store.getImageURL(n.image).then(function (url) {
        if (url && img) { img.src = url; img.removeAttribute("hidden"); }
      });
    });
  }
  function bindNews() {
    var listEl = $("#newsList"); if (!listEl) return;

    listEl.addEventListener("input", function (e) {
      var t = e.target;
      if (!t.dataset.f) return;
      var item = t.closest(".news-adm"); if (!item) return;
      var n = find(D.news, item.dataset.id); if (!n) return;
      n[t.dataset.f] = t.value;
      persist();
    });

    listEl.addEventListener("change", handleNewsFile);

    listEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-role=photo], [data-del]");
      if (!b) return;
      var item = b.closest(".news-adm"); if (!item) return;
      if (b.dataset.role === "photo") {
        var file = item.querySelector('input[data-role="file"]');
        if (file) file.click();
        return;
      }
      if (b.dataset.del) {
        if (!confirm("Удалить эту новость?")) return;
        var n = find(D.news, b.dataset.del);
        if (n && n.image) Store.removeImage(n.image);
        D.news = D.news.filter(function (x) { return x.id !== b.dataset.del; });
        saveLocal();
        renderNews();
        persist();
      }
    });

    $("#newsAdd").addEventListener("click", function () {
      D.news.push({ id: Store.uid("n"), title: "Новая новость", date: "", image: "", text: "" });
      saveLocal();
      renderNews();
      persist();
    });
  }

  async function handleNewsFile(e) {
    var input = e.target;
    if (input.dataset.role !== "file") return;
    var file = input.files[0]; if (!file) return;
    input.value = "";
    var item = input.closest(".news-adm"); if (!item) return;
    var n = find(D.news, item.dataset.id); if (!n) return;
    status("Обработка фото…");
    try {
      var blob = await compressImage(file, 1400);
      var ref = await saveImageBlob(blob);
      if (n.image) await Store.removeImage(n.image);
      n.image = ref;
      saveLocal();
      var img = item.querySelector('img[data-role="img"]');
      var url = await Store.getImageURL(ref);
      if (url && img) { img.src = url; img.removeAttribute("hidden"); }
      persist();
    } catch (err) { alert("Не удалось загрузить фото: " + (err.message || "ошибка")); status(""); }
  }

  /* =========================================================
     Заявки (онлайн)
     ========================================================= */
  function setBadge(n) {
    var b = $("#bookingsBadge");
    if (!b) return;
    if (n > 0) { b.hidden = false; b.textContent = n; } else { b.hidden = true; }
  }

  function renderBookings(list) {
    var el = $("#bookingsList"); if (!el) return;
    setBadge(list.length);
    if (!list.length) { el.innerHTML = '<p class="booking-empty">Заявок пока нет.</p>'; return; }
    el.innerHTML = list.map(function (b) {
      var when = "";
      try { when = b.created_at ? new Date(b.created_at).toLocaleString("ru-RU") : ""; } catch (e) {}
      return '<div class="booking-item">' +
        '<div class="b-main">' +
        '<div class="b-name">' + esc(b.name || "Без имени") + "</div>" +
        (when ? '<div class="b-when">' + esc(when) + "</div>" : "") +
        (b.phone ? '<div class="b-line"><b>Телефон:</b> ' + esc(b.phone) + "</div>" : "") +
        (b.service ? '<div class="b-line"><b>Услуга:</b> ' + esc(b.service) + "</div>" : "") +
        (b.date_text ? '<div class="b-line"><b>Удобное время:</b> ' + esc(b.date_text) + "</div>" : "") +
        (b.comment ? '<div class="b-line"><b>Комментарий:</b> ' + esc(b.comment) + "</div>" : "") +
        "</div>" +
        '<div class="b-actions"><button class="btn btn-ghost danger" data-del-booking="' + esc(b.id) + '" type="button">Удалить</button></div>' +
        "</div>";
    }).join("");
  }

  async function loadBookings() {
    var el = $("#bookingsList"); if (!el || MODE !== "online") return;
    try {
      var d = await apiFetch("admin/bookings");
      renderBookings(d.bookings || []);
    } catch (e) {
      if (e.status === 401) return handleUnauthorized();
      el.innerHTML = '<p class="booking-empty">Не удалось загрузить заявки.</p>';
    }
  }

  function bindBookings() {
    var el = $("#bookingsList"); if (!el) return;
    el.addEventListener("click", async function (e) {
      var b = e.target.closest("[data-del-booking]");
      if (!b) return;
      if (!confirm("Удалить эту заявку?")) return;
      try {
        await apiFetch("admin/bookings/" + encodeURIComponent(b.dataset.delBooking), { method: "DELETE" });
        await loadBookings();
      } catch (err) {
        if (err.status === 401) return handleUnauthorized();
        alert("Не удалось удалить заявку");
      }
    });
  }

  /* =========================================================
     Уведомления в Telegram (онлайн)
     ========================================================= */
  function tgMsg(text, ok) {
    var m = $("#tgMsg"); if (!m) return;
    if (!text) { m.hidden = true; m.textContent = ""; return; }
    m.hidden = false;
    m.textContent = text;
    m.classList.toggle("ok", !!ok);
  }

  function renderNotifyStatus(t) {
    var el = $("#tgStatus");
    if (el) {
      if (!t || !t.configured) el.textContent = "Статус: не подключено.";
      else if (t.enabled) el.textContent = "Статус: подключено ✓ Уведомления приходят в Telegram.";
      else el.textContent = "Статус: подключено, но уведомления выключены.";
    }
    var toggle = $("#tgToggle");
    if (toggle) toggle.textContent = t && t.enabled ? "Выключить" : "Включить";
    var input = $("#tgToken");
    if (input && t && t.token) input.placeholder = "Подключено: " + t.token + " (введите новый, чтобы заменить)";
  }

  async function loadNotify() {
    if (MODE !== "online") return;
    try {
      var d = await apiFetch("admin/notify");
      renderNotifyStatus(d && d.telegram);
    } catch (e) {
      if (e.status === 401) return handleUnauthorized();
    }
  }

  function bindNotify() {
    var connect = $("#tgConnect");
    if (connect) connect.addEventListener("click", async function () {
      var tokenEl = $("#tgToken");
      var tokenValue = tokenEl ? tokenEl.value.trim() : "";
      connect.disabled = true;
      tgMsg("Проверяем…");
      try {
        var r = await apiFetch("admin/notify/connect", { method: "POST", body: { token: tokenValue } });
        if (r && r.ok) {
          tgMsg("Подключено ✓ " + (r.chatName ? "Чат: " + r.chatName : ""), true);
          if (tokenEl) tokenEl.value = "";
        } else {
          tgMsg((r && r.message) || "Не удалось подключить");
        }
        await loadNotify();
      } catch (e) {
        if (e.status === 401) return handleUnauthorized();
        tgMsg(e.message || "Не удалось подключить");
      } finally { connect.disabled = false; }
    });

    var test = $("#tgTest");
    if (test) test.addEventListener("click", async function () {
      test.disabled = true;
      tgMsg("Отправляем тестовое сообщение…");
      try {
        var r = await apiFetch("admin/notify/test", { method: "POST" });
        if (r && r.ok) tgMsg("Готово ✓ Проверьте Telegram — сообщение должно прийти.", true);
        else tgMsg((r && r.message) || "Не удалось отправить");
      } catch (e) {
        if (e.status === 401) return handleUnauthorized();
        tgMsg(e.message || "Не удалось отправить");
      } finally { test.disabled = false; }
    });

    var toggle = $("#tgToggle");
    if (toggle) toggle.addEventListener("click", async function () {
      var enable = /Включить/.test(toggle.textContent || "");
      toggle.disabled = true;
      try {
        var r = await apiFetch("admin/notify", { method: "PUT", body: { enabled: enable } });
        renderNotifyStatus(r && r.telegram);
        tgMsg(enable ? "Уведомления включены ✓" : "Уведомления выключены", true);
      } catch (e) {
        if (e.status === 401) return handleUnauthorized();
        tgMsg(e.message || "Не удалось сохранить");
      } finally { toggle.disabled = false; }
    });
  }

  /* =========================================================
     Смена пароля (онлайн)
     ========================================================= */
  function bindPassword() {
    var btn = $("#pwSave"); if (!btn) return;
    btn.addEventListener("click", async function () {
      var m = $("#pwMsg");
      var p1 = ($("#pwNew") || {}).value || "";
      var p2 = ($("#pwNew2") || {}).value || "";
      var set = function (t, ok) { if (m) { m.textContent = t; m.classList.toggle("ok", !!ok); } };
      if (p1.length < 6) return set("Пароль должен быть не короче 6 символов");
      if (p1 !== p2) return set("Пароли не совпадают");
      btn.disabled = true;
      try {
        await apiFetch("admin/password", { method: "POST", body: { password: p1 } });
        set("Пароль изменён ✓", true);
        if ($("#pwNew")) $("#pwNew").value = "";
        if ($("#pwNew2")) $("#pwNew2").value = "";
      } catch (err) {
        if (err.status === 401) return handleUnauthorized();
        set(err.message || "Не удалось сменить пароль");
      } finally { btn.disabled = false; }
    });
  }

  /* =========================================================
     Публикация (офлайн): экспорт / импорт / сброс
     ========================================================= */
  async function exportData() {
    status("Готовим файл…");
    var out = Store.normalize(JSON.parse(JSON.stringify(D)));
    var refs = [];
    if (out.profile.heroImage) refs.push({ o: out.profile, k: "heroImage" });
    if (out.profile.aboutImage) refs.push({ o: out.profile, k: "aboutImage" });
    (out.works || []).forEach(function (w) { if (w.image) refs.push({ o: w, k: "image" }); });
    (out.news || []).forEach(function (n) { if (n.image) refs.push({ o: n, k: "image" }); });
    for (var i = 0; i < refs.length; i++) {
      refs[i].o[refs[i].k] = await Store.exportImageDataURL(refs[i].o[refs[i].k]);
    }
    var content = "/* Данные сайта. Менять вручную не нужно — используйте панель admin.html. */\nwindow.DEFAULT_DATA = " + JSON.stringify(out, null, 2) + ";\n";
    download("data.js", content, "text/javascript;charset=utf-8");
    status("Файл скачан ✓");
    flashLater();
  }

  async function handleImport(e) {
    var file = e.target.files[0]; if (!file) return;
    e.target.value = "";
    try {
      var text = await file.text();
      text = text.replace(/^\uFEFF/, "");
      var jsonText = text;
      if (/window\.DEFAULT_DATA\s*=/.test(text)) {
        var s = text.indexOf("{");
        var eIdx = text.lastIndexOf("}");
        if (s === -1 || eIdx === -1 || eIdx < s) { alert("Не удалось разобрать файл данных"); return; }
        jsonText = text.slice(s, eIdx + 1);
      }
      var parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object") throw new Error("файл пустой");
      parsed = Store.normalize(parsed);

      status("Импортируем фото…");
      var refs = [];
      if (parsed.profile.heroImage) refs.push({ o: parsed.profile, k: "heroImage" });
      if (parsed.profile.aboutImage) refs.push({ o: parsed.profile, k: "aboutImage" });
      (parsed.works || []).forEach(function (w) { if (w.image) refs.push({ o: w, k: "image" }); });
      (parsed.news || []).forEach(function (n) { if (n.image) refs.push({ o: n, k: "image" }); });
      for (var i = 0; i < refs.length; i++) {
        var ref = refs[i].o[refs[i].k];
        if (typeof ref === "string" && ref.indexOf("data:") === 0) {
          refs[i].o[refs[i].k] = await Store.putImage(dataURLtoBlob(ref));
        }
      }
      Store.clear();
      Store.save(parsed);
      alert("Данные успешно импортированы! Страница обновится.");
      location.reload();
    } catch (err) {
      alert("Не удалось импортировать файл: " + (err.message || "ошибка"));
      status("");
    }
  }

  function bindPublish() {
    var exp = $("#exportBtn");
    if (exp) exp.addEventListener("click", exportData);
    var imp = $("#importBtn");
    if (imp) imp.addEventListener("click", function () { $("#importFile").click(); });
    var impFile = $("#importFile");
    if (impFile) impFile.addEventListener("change", handleImport);
    var reset = $("#resetAll");
    if (reset) reset.addEventListener("click", function () {
      if (!confirm("Сбросить ВСЕ данные (работа не обратно)? Удалятся и все ваши фото.")) return;
      Store.clear();
      Store.clearAllImages().then(function () { location.reload(); });
    });
  }

  /* =========================================================
     Режим (онлайн / офлайн)
     ========================================================= */
  function setModeUi() {
    var pill = $("#modePill");
    if (pill) {
      pill.hidden = false;
      pill.textContent = MODE === "online" ? "Онлайн-режим" : "Офлайн-режим";
      pill.className = "mode-pill " + (MODE === "online" ? "online" : "local");
    }
    var out = $("#logoutBtn"); if (out) out.hidden = MODE !== "online";
    var bTab = $("#bookingsTab"); if (bTab) bTab.hidden = MODE !== "online";
    var nTab = $("#notifyTab"); if (nTab) nTab.hidden = MODE !== "online";
    var intro = $("#publishIntro");
    if (intro) intro.textContent = MODE === "online"
      ? "Изменения сохраняются на сервере автоматически — сайт обновляется сразу."
      : "Все изменения автоматически сохраняются на этом компьютере. Чтобы их увидели посетители сайта в интернете, выполните два шага ниже.";
    $$(".online-only").forEach(function (el) { el.hidden = MODE !== "online"; });
    $$(".local-only").forEach(function (el) { el.hidden = MODE !== "local"; });
  }

  function renderAll() {
    renderProfile();
    renderStats();
    renderFeatures();
    renderPrices();
    renderWorks();
    renderNews();
  }

  function bindAll() {
    bindProfile();
    bindStats();
    bindFeatures();
    bindPrices();
    bindWorks();
    bindNews();
    bindPublish();
    bindBookings();
    bindNotify();
    bindPassword();
  }

  async function enterOnline() {
    setModeUi();
    var d = await apiFetch("admin/data");
    D = Store.normalize(d);
    renderAll();
    await loadBookings();
    status("Изменения сохраняются автоматически ✓");
    flashLater();
  }

  /* =========================================================
     Запуск
     ========================================================= */
  async function init() {
    initTabs();
    bindAll();
    bindLogin();

    var online = await detectApi();
    if (online) {
      MODE = "online";
      setModeUi();
      try { TOKEN = localStorage.getItem("nail_token"); } catch (e) { TOKEN = null; }
      if (TOKEN) {
        try { await apiFetch("auth/me"); }
        catch (e) { TOKEN = null; try { localStorage.removeItem("nail_token"); } catch (_) {} }
      }
      if (!TOKEN) { showLogin(""); return; }
      try { await enterOnline(); }
      catch (e) { handleUnauthorized(); }
    } else {
      MODE = "local";
      D = Store.load();
      setModeUi();
      renderAll();
      status(Store.hasLocal() ? "Ваши данные сохранены ✓" : "Сайт показывает стандартные данные");
    }
  }

  init();
})();
