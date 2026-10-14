/* =========================================================
   app.js — отрисовка сайта из данных
   ========================================================= */
(function () {
  "use strict";

  var D = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* Данные грузим с сервера (если он есть), иначе — из файла data.js */
  async function fetchData() {
    if (location.protocol === "file:") return Store.load(); // открыто как файл — сервера нет
    try {
      var r = await fetch("api/data", { cache: "no-store" });
      if (r.ok) {
        var j = await r.json();
        if (j && (j.profile || j.works)) return Store.normalize(j);
      }
    } catch (e) { /* сервера нет — сайт работает на файлах */ }
    return Store.load();
  }

  /* ---------- иконки ---------- */
  var svg = function (inner, filled) {
    return '<svg viewBox="0 0 24 24" ' + (filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') + '>' + inner + '</svg>';
  };
  var ICONS = {
    sparkle: svg('<path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
    heart: svg('<path d="M12 20s-7-4.5-9.3-8.9A5.2 5.2 0 0 1 12 6.6a5.2 5.2 0 0 1 9.3 4.5C19 15.5 12 20 12 20z"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'),
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
    star: svg('<path d="M12 3.2l2.5 5.4 5.9.7-4.4 4.1 1.2 5.9-5.2-2.9-5.2 2.9 1.2-5.9-4.4-4.1 5.9-.7z"/>'),
    gift: svg('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8S9.6 3.2 7.2 4.6C5.2 5.8 6.6 8 12 8zM12 8s2.4-4.8 4.8-3.4C18.8 5.8 17.4 8 12 8z"/>'),
    leaf: svg('<path d="M20 4S8 4 5.5 11c-1.8 4.6 1 8.5 1 8.5S11 9 20 4z"/><path d="M6.5 19.5C10 16 13 14 16 13"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
    pin: svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7.5 9 6 9-6"/>'),
    map: svg('<path d="m9 20-5 2V6l5-2 6 2 5-2v16l-5 2-6-2z"/><path d="M9 4v16M15 6v16"/>'),
    telegram: svg('<path d="M21.8 4.3 19 19c-.2 1-.8 1.2-1.6.8l-4.4-3.3-2.1 2c-.2.2-.4.4-.9.4l.3-4.5 8.2-7.4c.4-.3-.1-.5-.5-.2L7.2 12l-4.3-1.4c-.9-.3-.9-.9.2-1.3l17-6.5c.8-.3 1.4.2 1.2 1.5z"/>', true),
    instagram: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" stroke="none"/>')
  };
  function icon(name) { return ICONS[name] || ICONS.sparkle; }

  var CAT_ICON = { "маникюр": "sparkle", "педикюр": "leaf", "наращивание": "star", "дизайн": "heart", "уход": "gift", "обучение": "star" };
  function catIcon(cat) {
    var c = String(cat || "").toLowerCase();
    for (var k in CAT_ICON) { if (c.indexOf(k) !== -1) return ICONS[CAT_ICON[k]]; }
    return ICONS.sparkle;
  }

  /* ---------- утилиты ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  function formatDate(iso) {
    if (!iso) return "";
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return parseInt(m[3], 10) + " " + MONTHS[parseInt(m[2], 10) - 1] + " " + m[1];
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString("ru-RU");
  }
  function digits(s) { return String(s || "").replace(/[^\d]/g, ""); }
  function tgClean(s) { return String(s || "").replace(/^@/, "").replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/\/.*$/, ""); }
  function igClean(s) { return String(s || "").replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, ""); }
  function tgLink(u) { return "https://t.me/" + tgClean(u); }
  function igLink(u) { return "https://instagram.com/" + igClean(u); }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return true; }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }

  async function applyImage(imgEl, ref, alt) {
    if (!imgEl) return "";
    var url = await Store.getImageURL(ref);
    if (url) {
      imgEl.src = url;
      imgEl.classList.remove("img-loading");
      imgEl.alt = alt || imgEl.alt || "";
    }
    return url;
  }

  /* =========================================================
     Профиль
     ========================================================= */
  function renderProfile() {
    var p = D.profile || {};
    var set = function (sel, val) { var el = $(sel); if (el && val != null) el.textContent = val; };

    document.title = (p.brand || "Маникюр") + (p.brandSub ? " — " + p.brandSub : "");
    set("#brandName", p.brand);
    set("#brandSub", p.brandSub);
    set("#footerBrandName", p.brand);
    set("#footerBrandSub", p.brandSub);
    set("#heroEyebrow", p.heroEyebrow);

    var h1 = $("#heroTitle");
    if (h1) h1.innerHTML = esc(p.heroTitle || "") + (p.heroAccent ? ' <em>' + esc(p.heroAccent) + "</em>" : "");
    set("#heroTagline", p.tagline);

    var stats = $("#heroStats");
    if (stats) {
      stats.innerHTML = (Array.isArray(p.stats) ? p.stats : []).map(function (s) {
        return '<div class="hero-badge"><b>' + esc(s.value) + "</b><span>" + esc(s.label) + "</span></div>";
      }).join("");
    }

    var aboutTitle = $("#aboutTitle"); if (aboutTitle) aboutTitle.textContent = p.aboutTitle || "Обо мне";
    var aboutText = $("#aboutText"); if (aboutText) aboutText.textContent = p.about || "";
    set("#footerAbout", p.tagline || p.about);

    var feats = $("#aboutFeatures");
    if (feats) {
      feats.innerHTML = (Array.isArray(p.features) ? p.features : []).map(function (f) {
        return '<div class="feature"><span class="ico">' + icon(f.icon) + '</span><div><b>' + esc(f.title) + "</b><span>" + esc(f.text) + "</span></div></div>";
      }).join("");
    }

    applyImage($("#heroImage"), p.heroImage, p.brand);
    applyImage($("#aboutImage"), p.aboutImage, p.master);
  }

  /* =========================================================
     Цены
     ========================================================= */
  function renderPrices() {
    var tabsEl = $("#priceTabs");
    var cardsEl = $("#priceCards");
    if (!cardsEl) return;

    var prices = Array.isArray(D.prices) ? D.prices : [];
    if (!prices.length) {
      cardsEl.innerHTML = '<div class="empty" style="grid-column:1/-1">Прайс пока не заполнен. Добавьте услуги в панели управления.</div>';
      if (tabsEl) tabsEl.innerHTML = "";
      return;
    }

    // группируем по категории, сохраняя порядок появления
    var order = [], groups = {};
    prices.forEach(function (it) {
      var cat = it.category || "Услуги";
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(it);
    });

    if (tabsEl) {
      tabsEl.innerHTML = ['<button class="chip active" data-cat="__all">Все услуги</button>'].concat(
        order.map(function (c) { return '<button class="chip" data-cat="' + esc(c) + '">' + esc(c) + "</button>"; })
      ).join("");
      tabsEl.onclick = function (e) {
        var b = e.target.closest(".chip"); if (!b) return;
        $$(".chip", tabsEl).forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        var cat = b.getAttribute("data-cat");
        $$(".price-card", cardsEl).forEach(function (card) {
          card.style.display = (cat === "__all" || card.getAttribute("data-cat") === cat) ? "" : "none";
        });
      };
    }

    cardsEl.innerHTML = order.map(function (cat) {
      var rows = groups[cat].map(function (it) {
        return '<div class="price-row"><div class="price-name">' + esc(it.name) +
          (it.note ? '<span class="price-note">' + esc(it.note) + "</span>" : "") +
          '</div><span class="price-dots"></span><span class="price-val">' + esc(it.price) + "</span></div>";
      }).join("");
      return '<div class="price-card reveal" data-cat="' + esc(cat) + '"><div class="price-cat"><span class="cico">' + catIcon(cat) + "</span>" + esc(cat) + "</div>" + rows + "</div>";
    }).join("");
  }

  /* =========================================================
     Работы (галерея + лайтбокс)
     ========================================================= */
  var workItems = [];

  async function renderWorks() {
    var grid = $("#worksGrid");
    if (!grid) return;
    var works = Array.isArray(D.works) ? D.works : [];

    if (!works.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Здесь скоро появятся работы мастера. Заглядывайте!</div>';
      var f0 = $("#galleryFilters"); if (f0) f0.innerHTML = "";
      return;
    }

    // фильтры по категориям
    var cats = [];
    works.forEach(function (w) { if (w.category && cats.indexOf(w.category) === -1) cats.push(w.category); });
    var filtersEl = $("#galleryFilters");
    if (filtersEl && cats.length) {
      filtersEl.innerHTML = ['<button class="chip active" data-cat="__all">Все работы</button>'].concat(
        cats.map(function (c) { return '<button class="chip" data-cat="' + esc(c) + '">' + esc(c) + "</button>"; })
      ).join("");
    } else if (filtersEl) {
      filtersEl.innerHTML = "";
    }

    grid.innerHTML = works.map(function (w, i) {
      return '<article class="work reveal" data-index="' + i + '" data-cat="' + esc(w.category || "") + '" tabindex="0" role="button" aria-label="' + esc(w.title || "Работа") + '">' +
        '<img class="img-loading" alt="' + esc(w.title || "Работа") + '" data-img="' + i + '">' +
        (w.category ? '<span class="work-tag">' + esc(w.category) + "</span>" : "") +
        '<div class="work-overlay"><div class="work-title">' + esc(w.title || "Работа") + "</div>" +
        (w.category ? '<div class="work-cat">' + esc(w.category) + "</div>" : "") + "</div></article>";
    }).join("");

    workItems = works.map(function (w, i) {
      var el = grid.querySelector('[data-index="' + i + '"]');
      return { work: w, el: el, url: "" };
    });

    // подгружаем картинки
    works.forEach(function (w, i) {
      applyImage(grid.querySelector('img[data-img="' + i + '"]'), w.image, w.title).then(function (url) {
        if (workItems[i]) workItems[i].url = url || "";
      });
    });

    // фильтр
    if (filtersEl) {
      filtersEl.onclick = function (e) {
        var b = e.target.closest(".chip"); if (!b) return;
        $$(".chip", filtersEl).forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        var cat = b.getAttribute("data-cat");
        workItems.forEach(function (it) {
          it.el.style.display = (cat === "__all" || it.el.getAttribute("data-cat") === cat) ? "" : "none";
        });
      };
    }

    // открытие лайтбокса
    grid.addEventListener("click", function (e) {
      var card = e.target.closest(".work"); if (card) openLightbox(card);
    });
    grid.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        var card = e.target.closest(".work");
        if (card) { e.preventDefault(); openLightbox(card); }
      }
    });
  }

  function openLightbox(card) {
    var visible = workItems.filter(function (it) { return it.el.style.display !== "none"; });
    var list = visible.map(function (it) {
      return { url: it.url, title: it.work.title || "Работа", cat: it.work.category || "" };
    });
    var idx = visible.findIndex(function (it) { return it.el === card; });
    if (idx < 0) idx = 0;
    showLightbox(list, idx);
  }

  var lbList = [], lbIdx = 0;
  function showLightbox(list, idx) {
    lbList = list; lbIdx = idx;
    paintLightbox();
    var lb = $("#lightbox"); if (lb) lb.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function paintLightbox() {
    var it = lbList[lbIdx]; if (!it) return;
    var img = $("#lbImg");
    if (it.url) { img.hidden = false; img.src = it.url; }
    else { img.hidden = true; img.removeAttribute("src"); }
    $("#lbTitle").textContent = it.title || "";
    $("#lbCat").textContent = it.cat || "";
    var multi = lbList.length > 1;
    $("#lbPrev").style.display = multi ? "" : "none";
    $("#lbNext").style.display = multi ? "" : "none";
  }
  function closeLightbox() {
    var lb = $("#lightbox"); if (lb) lb.classList.remove("open");
    document.body.style.overflow = "";
  }
  function navLightbox(step) {
    if (lbList.length < 2) return;
    lbIdx = (lbIdx + step + lbList.length) % lbList.length;
    paintLightbox();
  }
  function initLightbox() {
    var lb = $("#lightbox"); if (!lb) return;
    $("#lbClose").onclick = closeLightbox;
    $("#lbPrev").onclick = function () { navLightbox(-1); };
    $("#lbNext").onclick = function () { navLightbox(1); };
    lb.addEventListener("click", function (e) { if (e.target === lb) closeLightbox(); });
    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") navLightbox(-1);
      else if (e.key === "ArrowRight") navLightbox(1);
    });
  }

  /* =========================================================
     Новости
     ========================================================= */
  function renderNews() {
    var grid = $("#newsGrid"); if (!grid) return;
    var news = Array.isArray(D.news) ? D.news : [];
    if (!news.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Новостей пока нет.</div>';
      return;
    }
    grid.innerHTML = news.map(function (n, i) {
      return '<article class="news-card reveal">' +
        (n.image ? '<div class="news-img"><img class="img-loading" alt="' + esc(n.title) + '" data-news-img="' + i + '"></div>' : "") +
        '<div class="news-body">' +
        (n.date ? '<div class="news-date">' + esc(formatDate(n.date)) + "</div>" : "") +
        "<h3>" + esc(n.title) + "</h3>" +
        "<p>" + esc(n.text) + "</p></div></article>";
    }).join("");
    news.forEach(function (n, i) {
      if (n.image) applyImage(grid.querySelector('img[data-news-img="' + i + '"]'), n.image, n.title);
    });
  }

  /* =========================================================
     Контакты + соцсети
     ========================================================= */
  function renderContacts() {
    var p = D.profile || {};
    var list = $("#contactList");
    var items = [];
    if (p.phone) items.push({ icon: "phone", lbl: "Телефон", val: p.phone, href: "tel:" + digits(p.phoneRaw || p.phone) });
    if (p.address) items.push({ icon: "pin", lbl: "Адрес", val: [p.city, p.address].filter(Boolean).join(", "), href: p.mapUrl || "" });
    else if (p.city) items.push({ icon: "pin", lbl: "Город", val: p.city, href: p.mapUrl || "" });
    if (p.hours) items.push({ icon: "clock", lbl: "Часы работы", val: p.hours });
    if (p.email) items.push({ icon: "mail", lbl: "E-mail", val: p.email, href: "mailto:" + p.email });

    if (list) {
      list.innerHTML = items.map(function (it) {
        var val = it.href ? '<a href="' + esc(it.href) + '"' + (/^https?:/.test(it.href) ? ' target="_blank" rel="noopener"' : "") + ">" + esc(it.val) + "</a>" : esc(it.val);
        return '<div class="contact-item"><span class="contact-ico">' + icon(it.icon) + '</span><div><div class="lbl">' + esc(it.lbl) + '</div><div class="val">' + val + "</div></div></div>";
      }).join("") || '<p style="color:#96798a">Контакты пока не заполнены.</p>';
    }

    var sl = [];
    if (p.telegram) sl.push({ icon: "telegram", label: "Telegram", href: tgLink(p.telegram) });
    if (p.instagram) sl.push({ icon: "instagram", label: "Instagram", href: igLink(p.instagram) });
    if (p.phone) sl.push({ icon: "phone", label: "Позвонить", href: "tel:" + digits(p.phoneRaw || p.phone) });

    var socials = $("#socials");
    if (socials) {
      socials.innerHTML = sl.map(function (s) {
        return '<a class="social" href="' + esc(s.href) + '" target="_blank" rel="noopener">' + icon(s.icon) + esc(s.label) + "</a>";
      }).join("");
    }

    var mapBtn = $("#mapBtn");
    if (mapBtn) {
      if (p.mapUrl) { mapBtn.href = p.mapUrl; mapBtn.style.display = ""; }
      else mapBtn.style.display = "none";
    }

    // select услуг для записи
    var sel = $("#bookingService");
    if (sel) {
      var opts = ['<option value="">Выберите услугу</option>'];
      (D.prices || []).forEach(function (it) {
        opts.push('<option value="' + esc(it.name) + '">' + esc((it.category ? it.category + " · " : "") + it.name) + "</option>");
      });
      sel.innerHTML = opts.join("");
    }
  }

  /* =========================================================
     Форма записи -> заявка мастеру
     ========================================================= */
  function initBooking() {
    var form = $("#bookingForm"); if (!form) return;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var p = D.profile || {};
      var name = ($("#bookingName") || {}).value || "";
      var phone = ($("#bookingPhone") || {}).value || "";
      var service = ($("#bookingService") || {}).value || "";
      var date = ($("#bookingDate") || {}).value || "";
      var msg = ($("#bookingMsg") || {}).value || "";
      name = name.trim();
      phone = phone.trim();

      var status = $("#bookingStatus");
      var show = function (t) { if (status) status.textContent = t; };

      var lines = ["Здравствуйте! Хочу записаться на процедуру."];
      if (name) lines.push("Меня зовут: " + name);
      if (phone) lines.push("Телефон: " + phone);
      if (service) lines.push("Услуга: " + service);
      if (date) lines.push("Удобное время: " + date);
      if (msg.trim()) lines.push("Комментарий: " + msg.trim());
      var text = lines.join("\n");

      // 1) Отправляем заявку на сервер (если он есть) — она попадёт в панель мастера.
      var sent = false;
      if (location.protocol !== "file:") {
        try {
          var res = await fetch("api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, phone: phone, service: service, date: date, comment: msg.trim() })
          });
          sent = res.ok;
        } catch (err) { sent = false; }
      }
      if (sent) {
        form.reset();
        show("Заявка отправлена ✓ Мастер свяжется с вами.");
        return;
      }

      // 2) Сервера нет — помогаем связаться напрямую.
      if (p.telegram) {
        window.open(tgLink(p.telegram), "_blank");
        copyText(text);
        show("Открыли Telegram. Текст заявки скопирован — вставьте его в чат.");
      } else if (p.phoneRaw || p.phone) {
        copyText(text);
        show("Заявка скопирована. Позвоните мастеру: " + (p.phone || p.phoneRaw));
      } else {
        copyText(text);
        show("Заявка скопирована. Свяжитесь с мастером удобным способом.");
      }
    });
  }

  /* =========================================================
     Шапка, меню, появление секций
     ========================================================= */
  function initChrome() {
    var header = $("#header");
    var onScroll = function () {
      if (header) header.classList.toggle("scrolled", window.scrollY > 8);
      updateActiveNav();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    var burger = $("#burger"), mnav = $("#mobileNav");
    if (burger && mnav) {
      burger.addEventListener("click", function () {
        var open = mnav.classList.toggle("open");
        burger.classList.toggle("open", open);
        burger.setAttribute("aria-expanded", open ? "true" : "false");
      });
      $$("a", mnav).forEach(function (a) {
        a.addEventListener("click", function () {
          mnav.classList.remove("open"); burger.classList.remove("open");
          burger.setAttribute("aria-expanded", "false");
        });
      });
    }

    var year = $("#year"); if (year) year.textContent = new Date().getFullYear();
    onScroll();
  }

  var NAV_MAP = [["#hero", "#home"], ["#about", "#about-nav"], ["#prices", "#prices-nav"], ["#works", "#works-nav"], ["#news", "#news-nav"], ["#contacts", "#contacts-nav"]];
  function updateActiveNav() {
    var y = window.scrollY + 120, current = null;
    ["hero", "about", "prices", "works", "news", "contacts"].forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec && sec.offsetTop <= y) current = id;
    });
    $$(".nav a, .mobile-nav a").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      a.classList.toggle("active", !!current && href === "#" + current);
    });
  }

  function initReveal() {
    var els = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- запуск ---------- */
  async function init() {
    D = await fetchData();
    renderProfile();
    renderPrices();
    renderNews();
    renderContacts();
    initBooking();
    await renderWorks();
    initLightbox();
    initChrome();
    initReveal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
