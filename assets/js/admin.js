/* RoomFindsClub — admin panel.
 *
 * Access control is NOT done here: /admin/ is protected at the edge (Cloudflare Access).
 * Nothing secret lives in this file. The GitHub token is typed by the owner and kept
 * only in this browser's localStorage.
 */
(function () {
  "use strict";

  var STATE_KEY = "rfc_admin_changes";   // { upserts: {id: product}, deleted: [id] }
  var TOKEN_KEY = "rfc_admin_gh_token";
  var QUEUE_KEY = "rfc_admin_queue";     // [{ asin, link, category }] waiting for RFC Grab
  var DATA_PATH = "data/products.json";

  var CFG, CATS = {}, published = [], publishedSha = null;

  /* ---------------- utils ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function store(key, val) { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val)); } catch (e) {} }
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
  function loadStr(key) { try { return localStorage.getItem(key) || ""; } catch (e) { return ""; } }
  function today() { return new Date().toISOString().slice(0, 10); }
  function setStatus(el, msg, kind) { el.textContent = msg || ""; el.dataset.kind = kind || ""; }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(b64.replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function slugify(text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/&/g, " and ").replace(/[^a-z0-9\s-]/g, " ").trim()
      .split(/\s+/).slice(0, 8).join("-").replace(/-+/g, "-").slice(0, 60).replace(/-$/, "");
  }

  /* ---------------- affiliate links ---------------- */
  var ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|\/exec\/obidos\/asin\/|[?&]asin=)([A-Z0-9]{10})(?:[/?&#]|$)/i;

  function tagFor(hostname) {
    var tags = CFG.site.affiliate.tags, best = null;
    Object.keys(tags).forEach(function (domain) {
      if (hostname === domain || hostname.slice(-(domain.length + 1)) === "." + domain) {
        if (!best || domain.length > best.length) best = domain;
      }
    });
    return best ? { domain: best, tag: tags[best] } : null;
  }

  function convert(raw) {
    raw = String(raw || "").trim();
    if (!raw) return null;
    var url;
    try { url = new URL(raw); } catch (e) { return { ok: false, input: raw, error: "No es una URL válida" }; }
    var host = url.hostname.toLowerCase();
    if (/^(amzn\.to|a\.co|amzn\.eu|amzn\.asia)$/.test(host)) {
      return { ok: false, input: raw, error: "Enlace corto: ábrelo y copia la URL completa de la ficha" };
    }
    if (!/(^|\.)amazon\./.test(host)) return { ok: false, input: raw, error: "No es un enlace de Amazon" };
    var t = tagFor(host);
    if (!t) return { ok: false, input: raw, error: "No hay tag configurado para " + host.replace(/^www\./, "") };
    var m = (url.pathname + url.search).match(ASIN_RE);
    if (!m) return { ok: false, input: raw, error: "No encuentro el ASIN — ¿es la ficha de un producto?" };
    var asin = m[1].toUpperCase();
    return { ok: true, input: raw, asin: asin, output: "https://www." + t.domain + "/dp/" + asin + "?tag=" + t.tag };
  }

  /* The site is in English: always read Amazon pages in English, whatever language the account uses. */
  function englishUrl(link) { return link.split("?")[0] + "?language=en_US"; }

  /* ---------------- catalog state ---------------- */
  function changes() { return load(STATE_KEY, { upserts: {}, deleted: [] }); }
  function saveChanges(c) { store(STATE_KEY, c); }

  function applyChanges(base, c) {
    var out = base.filter(function (p) { return c.deleted.indexOf(p.id) === -1; }).map(function (p) {
      return c.upserts[p.id] ? c.upserts[p.id] : p;
    });
    Object.keys(c.upserts).forEach(function (id) {
      if (!out.some(function (p) { return p.id === id; }) && c.deleted.indexOf(id) === -1) out.push(c.upserts[id]);
    });
    return out;
  }
  function current() { return applyChanges(published, changes()); }
  function statusOf(id) {
    var c = changes();
    if (c.deleted.indexOf(id) !== -1) return "deleted";
    if (c.upserts[id]) return published.some(function (p) { return p.id === id; }) ? "edited" : "new";
    return "published";
  }
  function pendingCount() { var c = changes(); return Object.keys(c.upserts).length + c.deleted.length; }

  /* ---------------- GitHub ---------------- */
  function token() { return loadStr(TOKEN_KEY); }
  function ghUrl() { return "https://api.github.com/repos/" + CFG.site.repo + "/contents/" + DATA_PATH; }
  function ghHeaders() {
    return { "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  }
  function ghGet() {
    return fetch(ghUrl() + "?ref=main&t=" + Date.now(), { headers: ghHeaders(), cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 401 ? "Token no válido o caducado" : r.status === 404 ? "El token no tiene acceso al repo" : "GitHub respondió " + r.status);
      return r.json();
    }).then(function (j) { return { sha: j.sha, items: JSON.parse(b64decode(j.content)) }; });
  }
  function ghPut(items, sha, message) {
    return fetch(ghUrl(), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify({ message: message, content: b64encode(JSON.stringify(items, null, 2) + "\n"), sha: sha, branch: "main" })
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(r.status === 409 ? "Alguien cambió el catálogo a la vez — vuelve a pulsar Publicar" : r.status === 403 ? "El token no tiene permiso de escritura (Contents: Read and write)" : (j.message || "GitHub respondió " + r.status));
      });
      return r.json();
    });
  }

  function loadPublished() {
    if (token()) {
      return ghGet().then(function (res) { published = res.items; publishedSha = res.sha; }).catch(function (e) {
        setStatus($("gh-status"), e.message, "error");
        return loadPublicFile();
      });
    }
    return loadPublicFile();
  }
  function loadPublicFile() {
    return fetch("/data/products.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (items) { published = items; publishedSha = null; });
  }

  /* ---------------- validation ---------------- */
  // A product is identified by its ASIN: the same ASIN can never be in the catalog twice.
  function asinOf(link) {
    var m = String(link || "").match(/\/dp\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }
  function findByAsin(asin, items, exceptId) {
    if (!asin) return null;
    return items.filter(function (x) { return x.id !== exceptId && asinOf(x.affiliateLink) === asin; })[0] || null;
  }

  function validate(p, allItems, editingId) {
    if (!p.name) return "Falta el nombre.";
    if (!p.affiliateLink) return "Falta un enlace de Amazon válido.";
    if (!/^https:\/\//.test(p.image)) return "La imagen tiene que ser una URL https.";
    if (!CATS[p.category]) return "Elige una categoría.";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) return "El ID solo puede tener minúsculas, números y guiones.";
    if (p.id !== editingId && allItems.some(function (x) { return x.id === p.id; })) return "Ya existe un producto con ese ID.";
    var dup = findByAsin(asinOf(p.affiliateLink), allItems, editingId || p.id);
    if (dup) return "Este producto ya está en el catálogo: “" + dup.name + "”.";
    return null;
  }

  /* ---------------- form ---------------- */
  var editingId = null, idTouched = false;

  function formProduct() {
    var conv = convert($("f-link").value);
    return {
      id: $("f-id").value.trim(),
      name: $("f-name").value.trim(),
      description: $("f-desc").value.trim(),
      image: $("f-image").value.trim(),
      category: $("f-cat").value,
      affiliateLink: conv && conv.ok ? conv.output : ""
    };
  }

  function uniqueId(base) {
    if (!base) return "";
    var items = current(), id = base, n = 2;
    while (items.some(function (p) { return p.id === id && p.id !== editingId; })) id = base + "-" + n++;
    return id;
  }

  function onLinkInput() {
    var out = $("f-link-out"), conv = convert($("f-link").value);
    var dup = conv && conv.ok ? findByAsin(conv.asin, current(), editingId) : null;
    if (!conv) { out.textContent = ""; out.dataset.kind = ""; }
    else if (dup) { out.textContent = "⚠ Este producto ya está en el catálogo: “" + dup.name + "”. No se puede añadir otra vez."; out.dataset.kind = "error"; }
    else if (conv.ok) { out.textContent = "→ " + conv.output; out.dataset.kind = "ok"; }
    else { out.textContent = conv.error; out.dataset.kind = "error"; }
    $("f-save").disabled = !!dup;
    renderPreview();
  }

  function onNameInput() {
    if (!idTouched && !editingId) $("f-id").value = uniqueId(slugify($("f-name").value));
    renderPreview();
  }

  function fillForm(p, isEdit) {
    editingId = isEdit ? p.id : null;
    idTouched = !!isEdit;
    $("f-link").value = p.affiliateLink || p.url || "";
    $("f-name").value = p.name || "";
    $("f-desc").value = p.description || "";
    $("f-image").value = p.image || "";
    if (p.category && CATS[p.category]) $("f-cat").value = p.category;
    $("f-id").value = isEdit ? p.id : uniqueId(slugify(p.name || ""));
    $("f-id").readOnly = !!(isEdit && published.some(function (x) { return x.id === p.id; }));
    $("form-mode").textContent = isEdit ? "Editando ficha" : "Nueva ficha de producto";
    $("f-save").textContent = isEdit ? "Guardar cambios" : "Guardar ficha";
    $("f-error").hidden = true;
    onLinkInput();
  }

  function resetForm() {
    fillForm({}, false);
    $("f-id").readOnly = false;
    setStatus($("f-autofill-status"), "");
  }

  function saveForm() {
    var p = formProduct(), err = validate(p, current(), editingId), errEl = $("f-error");
    if (err) { errEl.textContent = err; errEl.hidden = false; return; }
    errEl.hidden = true;
    var existing = current().filter(function (x) { return x.id === (editingId || p.id); })[0];
    p.dateAdded = existing && existing.dateAdded ? existing.dateAdded : today();
    if (existing) p.dateUpdated = today();
    var c = changes();
    if (editingId && editingId !== p.id) { delete c.upserts[editingId]; }
    c.upserts[p.id] = p;
    c.deleted = c.deleted.filter(function (id) { return id !== p.id; });
    saveChanges(c);
    resetForm();
    renderList();
    flash("Ficha guardada. Pulsa Publicar cuando quieras subirla a la web.");
  }

  function renderPreview() {
    var p = formProduct(), cat = CATS[p.category];
    if (!p.name && !p.image) {
      $("preview").innerHTML = '<p class="hint">Aquí verás cómo queda la tarjeta en la web.</p>';
      return;
    }
    $("preview").innerHTML =
      '<article class="card" style="max-width:280px;">' +
      '<div class="card-media">' + (p.image ? '<img src="' + esc(p.image) + '" alt="" referrerpolicy="no-referrer">' : "") + "</div>" +
      '<div class="card-body"><span class="card-cat">' + esc(cat ? cat.name : "") + '</span><h3 class="card-title">' + esc(p.name || "Sin nombre") + "</h3></div></article>" +
      (p.id ? '<p class="hint" style="margin-top:10px;">roomfindsclub.com/product/' + esc(p.id) + "/</p>" : "");
  }

  /* ---------------- autofill ---------------- */
  function parseAmazonHtml(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var q = function (sel) { return doc.querySelector(sel); };
    if (q("form[action*='validateCaptcha']")) throw new Error("captcha");
    if (!/^en/i.test(doc.documentElement.getAttribute("lang") || "en")) throw new Error("lang");
    var name = q("#productTitle") ? q("#productTitle").textContent.trim() : "";
    var img = q("#landingImage") || q("#imgTagWrapperId img");
    var image = "";
    if (img) {
      image = img.getAttribute("data-old-hires") || "";
      if (!image) {
        try {
          var dyn = JSON.parse(img.getAttribute("data-a-dynamic-image") || "{}");
          image = Object.keys(dyn).sort(function (a, b) { return dyn[b][0] - dyn[a][0]; })[0] || img.getAttribute("src") || "";
        } catch (e) { image = img.getAttribute("src") || ""; }
      }
    }
    var bullets = Array.prototype.map.call(doc.querySelectorAll("#feature-bullets li span.a-list-item"), function (s) { return s.textContent.trim(); }).filter(Boolean);
    var description = bullets.length ? bullets.map(function (b) { return "- " + b; }).join("\n") : (q("#productDescription") ? q("#productDescription").textContent.trim() : "");
    if (!name) throw new Error("empty");
    return { name: name, image: image, description: description };
  }

  /* Amazon blocks direct browser requests (CORS), so we go through public proxies.
     Amazon often answers them with a captcha — then the RFC Grab bookmarklet takes over. */
  var PROXIES = [
    function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
    function (u) { return "https://corsproxy.io/?url=" + encodeURIComponent(u); }
  ];

  function fetchAmazon(pageUrl) {
    var i = 0;
    function attempt() {
      if (i >= PROXIES.length) return Promise.reject(new Error("blocked"));
      var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 12000);
      return fetch(PROXIES[i++](pageUrl), { signal: ctrl.signal })
        .then(function (r) { if (!r.ok) throw new Error("proxy"); return r.text(); })
        .then(function (html) { clearTimeout(timer); return parseAmazonHtml(html); })
        .catch(function () { clearTimeout(timer); return attempt(); });
    }
    return attempt();
  }

  function autofill() {
    var status = $("f-autofill-status"), conv = convert($("f-link").value);
    if (!conv || !conv.ok) { setStatus(status, "Pega antes un enlace de Amazon válido.", "error"); return; }
    setStatus(status, "Leyendo la ficha de Amazon…", "");
    fetchAmazon(englishUrl(conv.output))
      .then(function (d) {
        $("f-name").value = d.name;
        if (d.description) $("f-desc").value = d.description;
        if (d.image) $("f-image").value = d.image;
        onNameInput();
        setStatus(status, "Rellenado. Revisa los campos antes de guardar.", "ok");
      })
      .catch(function () {
        setStatus(status, "Amazon ha bloqueado la lectura automática. Abre la ficha en Amazon y pulsa el botón RFC Grab.", "error");
      });
  }

  /* Save a complete product straight to the local changes (no form). Returns the product or null. */
  function saveDraftDirect(d, link, category) {
    var conv = convert(link);
    if (!conv || !conv.ok) return null;
    var editingBackup = editingId; editingId = null;
    var p = {
      id: uniqueId(slugify(d.name || "")),
      name: (d.name || "").trim(),
      description: (d.description || "").trim(),
      image: (d.image || "").trim(),
      category: category,
      affiliateLink: conv.output,
      dateAdded: today()
    };
    editingId = editingBackup;
    if (validate(p, current(), null)) return null;
    var c = changes();
    c.upserts[p.id] = p;
    saveChanges(c);
    return p;
  }

  /* ---------------- bulk: links → drafts ---------------- */
  function queue() { return load(QUEUE_KEY, []); }
  function saveQueue(q) { store(QUEUE_KEY, q); renderQueue(); }

  function renderQueue() {
    var q = queue();
    $("queue").hidden = q.length === 0;
    $("queue-title").textContent = q.length + " pendiente" + (q.length === 1 ? "" : "s") + " de RFC Grab";
    $("queue-list").innerHTML = q.map(function (it) {
      return '<li class="conv-row"><code>' + esc(it.asin) + " · " + esc(CATS[it.category] ? CATS[it.category].name : it.category) + '</code><span class="row">' +
        '<a class="btn btn-primary btn-sm" href="' + esc(englishUrl(it.link)) + '" target="rfc-amazon">Abrir en Amazon</a>' +
        '<button class="btn btn-ghost btn-sm" data-unqueue="' + esc(it.asin) + '">Quitar</button></span></li>';
    }).join("");
  }

  function bulkRun() {
    var status = $("bulk-status"), category = $("bulk-cat").value;
    var results = $("conv-input").value.split(/\s+/).filter(Boolean).map(convert).filter(Boolean);
    if (!results.length) { setStatus(status, "Pega al menos un enlace.", "error"); return; }
    if (!category) { setStatus(status, "Elige la categoría para estos productos.", "error"); $("bulk-cat").focus(); return; }

    var existing = current().map(function (p) { var m = p.affiliateLink.match(/\/dp\/([A-Z0-9]{10})/); return m ? m[1] : null; });
    var rows = results.map(function (r) {
      if (!r.ok) return { r: r, state: "error", msg: r.error };
      if (existing.indexOf(r.asin) !== -1) return { r: r, state: "skip", msg: "Ya está en tu catálogo" };
      if (queue().some(function (q) { return q.asin === r.asin; })) return { r: r, state: "skip", msg: "Ya está en la cola" };
      return { r: r, state: "pending", msg: "En espera…" };
    });

    function paint() {
      $("conv-results").innerHTML = rows.map(function (x) {
        var cls = x.state === "error" || x.state === "blocked" ? " error" : x.state === "done" ? " done" : "";
        return '<li class="conv-row' + cls + '"><code>' + esc(x.r.ok ? x.r.output : x.r.input) + "</code><span>" + esc(x.msg) + "</span></li>";
      }).join("");
    }
    paint();
    $("bulk-run").disabled = true;

    var todo = rows.filter(function (x) { return x.state === "pending"; });
    var created = 0, blocked = 0, idx = 0;
    function next() {
      if (idx >= todo.length) {
        $("bulk-run").disabled = false;
        renderList();
        var parts = [];
        if (created) parts.push(created + " ficha" + (created === 1 ? "" : "s") + " creada" + (created === 1 ? "" : "s"));
        if (blocked) parts.push(blocked + " a la cola de RFC Grab");
        setStatus(status, parts.length ? parts.join(" · ") + "." + (created ? " Revisa el catálogo y pulsa Publicar." : "") : "Nada nuevo que crear.", created ? "ok" : "");
        return;
      }
      var x = todo[idx++];
      x.msg = "Leyendo ficha…"; paint();
      setStatus(status, "Procesando " + idx + " de " + todo.length + "…", "");
      fetchAmazon(englishUrl(x.r.output)).then(function (d) {
        var p = saveDraftDirect(d, x.r.output, category);
        if (!p) throw new Error("incomplete");
        x.state = "done"; x.msg = "✔ " + p.name; created++;
      }).catch(function () {
        var q = queue();
        q.push({ asin: x.r.asin, link: x.r.output, category: category });
        saveQueue(q);
        x.state = "blocked"; x.msg = "Bloqueado → cola RFC Grab"; blocked++;
      }).then(function () { paint(); next(); });
    }
    next();
  }

  function importFromHash() {
    var m = location.hash.match(/^#import=(.+)$/);
    if (!m) return;
    try {
      var d = JSON.parse(b64decode(decodeURIComponent(m[1])));
      history.replaceState(null, "", location.pathname);

      // Only English data: older bookmarklets don't say which language they read, so ask to reinstall.
      if (!d.lang || !/^en/i.test(d.lang)) {
        var msg = d.lang
          ? "Amazon devolvió la ficha en otro idioma. Cambia el idioma de Amazon a English y vuelve a pulsar RFC Grab."
          : "Tu marcador RFC Grab está desactualizado. Bórralo y arrastra de nuevo el botón de la sección 04.";
        setStatus($("f-autofill-status"), msg, "error");
        setStatus($("bulk-status"), msg, "error");
        flash(msg);
        return;
      }

      var conv = convert(d.url), q = queue();

      // Already in the catalog? Don't import it again.
      var existing = conv && conv.ok ? findByAsin(conv.asin, current(), null) : null;
      if (existing) {
        saveQueue(q.filter(function (it) { return it.asin !== conv.asin; }));
        setStatus($("bulk-status"), "Este producto ya está en el catálogo: “" + existing.name + "”. No se ha añadido otra vez.", "error");
        flash("Ya lo tenías en el catálogo — no se duplica.");
        $("conv-title").scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      // Came from the RFC Grab queue? Save it straight away with the category chosen in bulk.
      var hit = conv && conv.ok ? q.filter(function (it) { return it.asin === conv.asin; })[0] : null;
      if (hit) {
        var p = saveDraftDirect(d, hit.link, hit.category);
        if (p) {
          saveQueue(q.filter(function (it) { return it.asin !== hit.asin; }));
          renderList();
          var left = queue().length;
          setStatus($("bulk-status"), "✔ Guardada: " + p.name + (left ? " · quedan " + left + " en la cola" : " · cola terminada, ya puedes Publicar"), "ok");
          flash(left ? "Guardada. Quedan " + left + " — abre el siguiente." : "¡Cola terminada! Pulsa Publicar.");
          $("conv-title").scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }

      resetForm();
      fillForm({ affiliateLink: d.url, name: d.name, description: d.description, image: d.image }, false);
      onNameInput();
      $("form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus($("f-autofill-status"), "Datos importados desde Amazon. Elige la categoría y guarda.", "ok");
    } catch (e) {
      setStatus($("f-autofill-status"), "No he podido leer los datos del botón RFC Grab.", "error");
    }
  }

  /* ---------------- catalog list ---------------- */
  var confirmTimer = null;

  function renderList() {
    var items = applyChanges(published, { upserts: changes().upserts, deleted: [] });
    var filter = ($("cat-filter").value || "").toLowerCase().trim();
    var pending = pendingCount();
    var live = published.length;

    $("cat-summary").textContent = live + " producto" + (live === 1 ? "" : "s") + " publicados" + (pending ? " · " + pending + " cambio" + (pending === 1 ? "" : "s") + " sin publicar" : "");
    $("publish").disabled = pending === 0;
    $("publish").textContent = pending ? "Publicar " + pending + " cambio" + (pending === 1 ? "" : "s") : "Publicar en la web";
    $("discard").hidden = pending === 0;

    var rows = items.filter(function (p) {
      return !filter || (p.name + " " + (CATS[p.category] ? CATS[p.category].name : "")).toLowerCase().indexOf(filter) !== -1;
    }).sort(function (a, b) { return (b.dateAdded || "").localeCompare(a.dateAdded || ""); });

    if (!rows.length) {
      $("item-list").innerHTML = '<li class="hint">' + (items.length ? "Nada coincide con el filtro." : "Todavía no hay productos. Crea tu primera ficha arriba.") + "</li>";
      return;
    }

    var labels = { "new": "Nuevo", edited: "Editado", deleted: "Se borrará", published: "Publicado" };
    $("item-list").innerHTML = rows.map(function (p) {
      var st = statusOf(p.id);
      return '<li class="item" data-status="' + st + '">' +
        '<img src="' + esc(p.image) + '" alt="" referrerpolicy="no-referrer" loading="lazy">' +
        '<div class="item-body"><strong>' + esc(p.name) + "</strong><span>" + esc(CATS[p.category] ? CATS[p.category].name : p.category) + ' · <em class="tag tag-' + st + '">' + labels[st] + "</em></span></div>" +
        '<div class="item-actions">' +
        (st === "deleted"
          ? '<button class="btn btn-ghost btn-sm" data-undo="' + esc(p.id) + '">Deshacer</button>'
          : '<button class="btn btn-ghost btn-sm" data-edit="' + esc(p.id) + '">Editar</button><button class="btn btn-ghost btn-sm" data-del="' + esc(p.id) + '">Borrar</button>') +
        "</div></li>";
    }).join("");
  }

  function onListClick(e) {
    var b = e.target.closest("button");
    if (!b) return;
    var c = changes();
    if (b.dataset.edit) {
      var p = current().filter(function (x) { return x.id === b.dataset.edit; })[0];
      if (p) { fillForm(p, true); $("form-panel").scrollIntoView({ behavior: "smooth", block: "start" }); }
    } else if (b.dataset.del) {
      if (b.dataset.confirm !== "1") {
        b.dataset.confirm = "1"; b.textContent = "¿Seguro?";
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(function () { b.dataset.confirm = ""; b.textContent = "Borrar"; }, 3000);
        return;
      }
      var id = b.dataset.del;
      if (published.some(function (x) { return x.id === id; })) { if (c.deleted.indexOf(id) === -1) c.deleted.push(id); }
      else { delete c.upserts[id]; }
      saveChanges(c); renderList();
    } else if (b.dataset.undo) {
      c.deleted = c.deleted.filter(function (id) { return id !== b.dataset.undo; });
      saveChanges(c); renderList();
    }
  }

  /* ---------------- publish ---------------- */
  function cleanForPublish(items) {
    return items.map(function (p) {
      var o = { id: p.id, name: p.name, description: p.description || "", image: p.image, category: p.category, affiliateLink: p.affiliateLink, dateAdded: p.dateAdded || today() };
      if (p.dateUpdated) o.dateUpdated = p.dateUpdated;
      return o;
    });
  }

  function publish() {
    var status = $("publish-status");
    if (!token()) { setStatus(status, "Conecta primero tu token de GitHub (sección 05), o descarga el products.json y súbelo a mano.", "error"); return; }
    var c = changes();
    var bad = null;
    Object.keys(c.upserts).some(function (id) { var e = validate(c.upserts[id], [], null); if (e) bad = c.upserts[id].name + ": " + e; return !!e; });
    if (bad) { setStatus(status, bad, "error"); return; }

    $("publish").disabled = true;
    setStatus(status, "Publicando…", "");
    var nNew = 0, nEdit = 0, nDel = c.deleted.length, skipped = [];
    ghGet().then(function (remote) {
      // Last check against the live catalog (it may have changed from another browser):
      // new products whose ASIN is already published are dropped, never duplicated.
      var live = remote.items.filter(function (p) { return c.deleted.indexOf(p.id) === -1; });
      var seen = {};
      live.forEach(function (p) { var a = asinOf(p.affiliateLink); if (a) seen[a] = p.id; });
      Object.keys(c.upserts).forEach(function (id) {
        var a = asinOf(c.upserts[id].affiliateLink);
        if (a && seen[a] && seen[a] !== id) { skipped.push(c.upserts[id].name); delete c.upserts[id]; }
        else if (a) seen[a] = id;
      });
      if (!Object.keys(c.upserts).length && !c.deleted.length) throw new Error("todo lo pendiente ya estaba en el catálogo (" + skipped.length + " duplicado" + (skipped.length === 1 ? "" : "s") + " descartado" + (skipped.length === 1 ? "" : "s") + ")");
      Object.keys(c.upserts).forEach(function (id) { remote.items.some(function (p) { return p.id === id; }) ? nEdit++ : nNew++; });
      var next = cleanForPublish(applyChanges(remote.items, c));
      var parts = [];
      if (nNew) parts.push(nNew + " new");
      if (nEdit) parts.push(nEdit + " edited");
      if (nDel) parts.push(nDel + " removed");
      return ghPut(next, remote.sha, "Catalog: " + parts.join(", ") + " (via admin)").then(function () { return next; });
    }).then(function (next) {
      published = next;
      saveChanges({ upserts: {}, deleted: [] });
      renderList();
      status.innerHTML = "✔ Publicado. La web se reconstruye sola en 1–2 minutos. <a class=\"text-link\" href=\"https://github.com/" + esc(CFG.site.repo) + "/actions\" target=\"_blank\" rel=\"noopener\">Ver progreso →</a>" +
        (skipped.length ? "<br>No se han subido por estar ya en el catálogo: " + skipped.map(esc).join(", ") + "." : "");
      status.dataset.kind = "ok";
    }).catch(function (e) {
      if (skipped.length) { saveChanges(c); renderList(); }
      setStatus(status, "No se ha publicado: " + e.message, "error");
      $("publish").disabled = pendingCount() === 0;
    });
  }

  function download() {
    var data = JSON.stringify(cleanForPublish(current()), null, 2) + "\n";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "products.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------------- converter ---------------- */
  var lastConverted = [];
  function runConverter() {
    var lines = $("conv-input").value.split(/\s+/).filter(Boolean);
    var results = lines.map(convert).filter(Boolean);
    lastConverted = results.filter(function (r) { return r.ok; }).map(function (r) { return r.output; });
    $("conv-copy-all").hidden = lastConverted.length < 2;
    $("conv-results").innerHTML = results.map(function (r, i) {
      if (!r.ok) return '<li class="conv-row error"><span>✕ ' + esc(r.error) + '</span><code>' + esc(r.input) + "</code></li>";
      return '<li class="conv-row"><code>' + esc(r.output) + '</code><span class="row">' +
        '<button class="btn btn-ghost btn-sm" data-copy="' + esc(r.output) + '">Copiar</button>' +
        '<button class="btn btn-ghost btn-sm" data-use="' + esc(r.output) + '">Crear ficha</button></span></li>';
    }).join("");
  }

  function copy(text, btn) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
      if (btn) { var t = btn.textContent; btn.textContent = "¡Copiado!"; setTimeout(function () { btn.textContent = t; }, 1200); }
    }).catch(function () { window.prompt("Copia el enlace:", text); });
  }

  /* ---------------- bookmarklet ---------------- */
  function bookmarkletCode() {
    var origin = location.origin;
    /* Reads the product in English: if the Amazon page is shown in another language,
       it fetches the same product with ?language=en_US (same origin, so no captcha/CORS). */
    var fn = function (ORIGIN) {
      if (!document.querySelector("#productTitle")) { alert("RFC Grab: abre la ficha de un producto de Amazon."); return; }
      var asinEl = document.querySelector("#ASIN") || document.querySelector("input[name='ASIN']");
      var asin = (asinEl && asinEl.value) || ((location.pathname.match(/\/dp\/([A-Z0-9]{10})/i) || [])[1]) || "";
      var grab = function (doc) {
        var $q = function (s) { return doc.querySelector(s); };
        var t = $q("#productTitle");
        if (!t) return null;
        var img = $q("#landingImage") || $q("#imgTagWrapperId img"), image = "";
        if (img) {
          image = img.getAttribute("data-old-hires") || "";
          if (!image) { try { var d = JSON.parse(img.getAttribute("data-a-dynamic-image") || "{}"); image = Object.keys(d).sort(function (a, b) { return d[b][0] - d[a][0]; })[0]; } catch (e) {} }
          if (!image) image = img.getAttribute("src") || "";
        }
        var bl = [].slice.call(doc.querySelectorAll("#feature-bullets li span.a-list-item")).map(function (s) { return s.textContent.trim(); }).filter(Boolean);
        var pd = $q("#productDescription");
        return { v: 2, lang: doc.documentElement.getAttribute("lang") || "", name: t.textContent.trim(), image: image, description: bl.length ? bl.map(function (b) { return "- " + b; }).join("\n") : (pd ? pd.textContent.trim() : ""), url: location.origin + "/dp/" + asin };
      };
      var send = function (data, win) {
        var bytes = new TextEncoder().encode(JSON.stringify(data)), bin = "";
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        var url = ORIGIN + "/admin/#import=" + encodeURIComponent(btoa(bin));
        if (win) win.location.href = url; else if (!window.open(url, "rfc-admin")) location.href = url;
      };
      if (/^en/i.test(document.documentElement.getAttribute("lang") || "")) { send(grab(document)); return; }
      var win = window.open("", "rfc-admin");
      fetch(location.origin + "/dp/" + asin + "?language=en_US", { credentials: "include" })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var data = grab(new DOMParser().parseFromString(html, "text/html"));
          if (!data || !/^en/i.test(data.lang)) throw new Error("lang");
          send(data, win);
        })
        .catch(function () { alert("RFC Grab: no he podido leer la ficha en inglés. Cambia el idioma de Amazon a English (arriba a la derecha) y vuelve a pulsar."); });
    };
    var code = "(" + fn.toString().replace(/\s+/g, " ") + ")(" + JSON.stringify(origin) + ");void 0";
    return "javascript:" + encodeURIComponent(code);
  }

  /* ---------------- flash ---------------- */
  var flashEl, flashTimer;
  function flash(msg) {
    if (!flashEl) { flashEl = document.createElement("div"); flashEl.className = "toast"; flashEl.setAttribute("role", "status"); document.body.appendChild(flashEl); }
    flashEl.textContent = msg; flashEl.classList.add("show");
    clearTimeout(flashTimer); flashTimer = setTimeout(function () { flashEl.classList.remove("show"); }, 2600);
  }

  /* ---------------- init ---------------- */
  function init() {
    fetch("/data/config.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (cfg) {
      CFG = cfg;
      cfg.categories.forEach(function (c) { CATS[c.slug] = c; });
      var catOptions = '<option value="">— Elige categoría —</option>' + cfg.groups.map(function (g) {
        return '<optgroup label="' + esc(g.name) + '">' + cfg.categories.filter(function (c) { return c.group === g.id; }).map(function (c) {
          return '<option value="' + c.slug + '">' + esc(c.name) + "</option>";
        }).join("") + "</optgroup>";
      }).join("");
      $("f-cat").innerHTML = catOptions;
      $("bulk-cat").innerHTML = catOptions;

      // Name this tab so the RFC Grab bookmarklet reuses it instead of opening a new one each time.
      window.name = "rfc-admin";
      $("bulk-run").addEventListener("click", bulkRun);
      $("queue-list").addEventListener("click", function (e) {
        var b = e.target.closest("[data-unqueue]"); if (!b) return;
        saveQueue(queue().filter(function (it) { return it.asin !== b.dataset.unqueue; }));
      });
      $("queue-clear").addEventListener("click", function () {
        if ($("queue-clear").dataset.confirm !== "1") { $("queue-clear").dataset.confirm = "1"; $("queue-clear").textContent = "¿Seguro?"; return; }
        $("queue-clear").dataset.confirm = ""; $("queue-clear").textContent = "Vaciar cola";
        saveQueue([]);
      });
      renderQueue();

      $("bookmarklet").href = bookmarkletCode();
      $("bookmarklet").addEventListener("click", function (e) { e.preventDefault(); flash("Arrástralo a tu barra de marcadores — no hace falta pulsarlo aquí."); });

      if (token()) { $("gh-token").value = token(); setStatus($("gh-status"), "Token guardado en este navegador.", "ok"); }

      $("conv-run").addEventListener("click", runConverter);
      $("conv-copy-all").addEventListener("click", function () { copy(lastConverted.join("\n"), $("conv-copy-all")); });
      $("conv-results").addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        if (b.dataset.copy) copy(b.dataset.copy, b);
        if (b.dataset.use) { resetForm(); $("f-link").value = b.dataset.use; onLinkInput(); $("form-panel").scrollIntoView({ behavior: "smooth" }); autofill(); }
      });

      $("f-link").addEventListener("input", onLinkInput);
      $("f-name").addEventListener("input", onNameInput);
      $("f-id").addEventListener("input", function () { idTouched = true; renderPreview(); });
      ["f-image", "f-cat", "f-desc"].forEach(function (id) { $(id).addEventListener("input", renderPreview); });
      $("f-autofill").addEventListener("click", autofill);
      $("f-save").addEventListener("click", saveForm);
      $("f-reset").addEventListener("click", resetForm);

      $("item-list").addEventListener("click", onListClick);
      $("cat-filter").addEventListener("input", renderList);
      $("publish").addEventListener("click", publish);
      $("download").addEventListener("click", download);
      $("discard").addEventListener("click", function () {
        if ($("discard").dataset.confirm !== "1") { $("discard").dataset.confirm = "1"; $("discard").textContent = "¿Seguro? Pulsa otra vez"; return; }
        $("discard").dataset.confirm = ""; $("discard").textContent = "Descartar cambios locales";
        saveChanges({ upserts: {}, deleted: [] }); renderList();
      });

      $("gh-save").addEventListener("click", function () {
        var v = $("gh-token").value.trim();
        if (!v) { setStatus($("gh-status"), "Pega el token primero.", "error"); return; }
        store(TOKEN_KEY, v);
        setStatus($("gh-status"), "Probando…", "");
        ghGet().then(function (res) {
          published = res.items; publishedSha = res.sha; renderList();
          setStatus($("gh-status"), "✔ Conectado. Puedes publicar desde aquí.", "ok");
        }).catch(function (e) { setStatus($("gh-status"), e.message, "error"); });
      });
      $("gh-clear").addEventListener("click", function () { store(TOKEN_KEY, null); $("gh-token").value = ""; setStatus($("gh-status"), "Token borrado de este navegador.", ""); });

      window.addEventListener("hashchange", importFromHash);
      resetForm();
      return loadPublished();
    }).then(function () {
      renderList();
      importFromHash();
    }).catch(function (e) {
      $("cat-summary").textContent = "Error cargando datos: " + e.message;
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
