/* RoomFindsClub — client-side enhancements (the site works without JS; this adds favorites, search and the mobile menu) */
(function () {
  "use strict";

  var FAV_KEY = "rfc_favorites";

  /* ---------- storage (safe in private mode) ---------- */
  function readFavs() {
    try {
      var v = JSON.parse(localStorage.getItem(FAV_KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writeFavs(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  function isFav(id) { return readFavs().indexOf(id) !== -1; }
  function toggleFav(id) {
    var list = readFavs();
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    writeFavs(list);
    return i === -1;
  }

  /* ---------- toast ---------- */
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  /* ---------- favorites UI ---------- */
  function updateCount() {
    var n = readFavs().length;
    document.querySelectorAll("[data-fav-count]").forEach(function (el) {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  function syncButton(btn) {
    var id = btn.getAttribute("data-fav");
    var on = isFav(id);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = btn.querySelector("[data-fav-label]");
    if (label) label.textContent = on ? "Saved" : "Save for later";
    if (!label) btn.setAttribute("aria-label", on ? "Remove from favorites" : "Save to favorites");
  }

  function bindFavButtons(root) {
    (root || document).querySelectorAll("[data-fav]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      syncButton(btn);
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var added = toggleFav(btn.getAttribute("data-fav"));
        document.querySelectorAll('[data-fav="' + btn.getAttribute("data-fav") + '"]').forEach(syncButton);
        updateCount();
        toast(added ? "Saved to favorites" : "Removed from favorites");
        document.dispatchEvent(new CustomEvent("rfc:favchange"));
      });
    });
  }

  /* ---------- mobile nav ---------- */
  function initNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---------- catalog search ---------- */
  function initSearch() {
    var input = document.querySelector("[data-search]");
    if (!input) return;
    var cards = Array.prototype.slice.call(document.querySelectorAll("[data-search-text]"));
    var note = document.querySelector("[data-search-note]");
    var empty = document.querySelector("[data-search-empty]");
    var q = new URLSearchParams(location.search).get("q");
    if (q) input.value = q;

    // lower-case, no accents; "mice"/"mouse", plurals and word order don't matter
    function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
    var ALIASES = { mice: "mouse", mouses: "mouse", headset: "headphone", headsets: "headphone", lamp: "light", lamps: "light" };
    function stem(w) { w = ALIASES[w] || w; return w.length > 3 ? w.replace(/ies$/, "y").replace(/s$/, "") : w; }
    var texts = cards.map(function (c) { return " " + norm(c.getAttribute("data-search-text")).split(/[^a-z0-9]+/).map(stem).join(" "); });

    function run() {
      var raw = input.value.trim();
      var terms = norm(raw).split(/[^a-z0-9]+/).filter(Boolean).map(stem);
      var shown = 0;
      cards.forEach(function (c, i) {
        var match = terms.every(function (t) { return texts[i].indexOf(" " + t) !== -1; });
        c.hidden = !match;
        if (match) shown++;
      });
      if (note) note.textContent = terms.length ? shown + " result" + (shown === 1 ? "" : "s") + " for “" + raw + "”" : "";
      if (empty) empty.hidden = !(terms.length && shown === 0);
      // keep the URL shareable: /catalog/?q=gaming+mouse
      try { history.replaceState(null, "", raw ? "?q=" + encodeURIComponent(raw).replace(/%20/g, "+") : location.pathname); } catch (e) {}
    }
    // the header box and the catalog box show the same search
    var header = document.getElementById("site-search");
    input.addEventListener("input", function () { if (header) header.value = input.value; run(); });
    if (header) {
      header.value = input.value;
      header.form.addEventListener("submit", function (e) { e.preventDefault(); input.value = header.value; run(); input.scrollIntoView({ block: "center" }); });
      header.addEventListener("input", function () { input.value = header.value; run(); });
    }
    run();
  }

  /* ---------- favorites page ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function initFavoritesPage() {
    var grid = document.querySelector("[data-favorites-grid]");
    if (!grid) return;
    var empty = document.querySelector("[data-favorites-empty]");

    Promise.all([
      fetch("/data/products.json").then(function (r) { return r.json(); }),
      fetch("/data/config.json").then(function (r) { return r.json(); })
    ]).then(function (res) {
      var products = res[0], cats = {};
      res[1].categories.forEach(function (c) { cats[c.slug] = c.name; });

      function render() {
        var favs = readFavs();
        var items = products.filter(function (p) { return favs.indexOf(p.id) !== -1; });
        grid.innerHTML = items.map(function (p) {
          return '<article class="card">' +
            '<button class="fav-btn" type="button" data-fav="' + esc(p.id) + '" aria-pressed="true" aria-label="Remove from favorites">' +
            '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg></button>' +
            '<a class="card-media" href="/product/' + encodeURIComponent(p.id) + '/" tabindex="-1" aria-hidden="true">' +
            '<img src="' + esc(p.image) + '" alt="' + esc(p.displayName || p.name) + '" loading="lazy" referrerpolicy="no-referrer"></a>' +
            '<div class="card-body"><span class="card-cat">' + esc(cats[p.category] || p.category) + '</span>' +
            '<h3 class="card-title"><a href="/product/' + encodeURIComponent(p.id) + '/">' + esc(p.displayName || p.name) + '</a></h3></div>' +
            '</article>';
        }).join("");
        grid.hidden = items.length === 0;
        if (empty) empty.hidden = items.length !== 0;
        bindFavButtons(grid);
      }
      render();
      document.addEventListener("rfc:favchange", render);
    }).catch(function () {
      if (empty) empty.hidden = false;
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    bindFavButtons();
    updateCount();
    initSearch();
    initFavoritesPage();
  });
})();
