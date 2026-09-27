/* RoomFindsClub — utilidades compartidas: layout, favoritos, render de productos */

const FAV_KEY = "rfc_favorites";

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function isFavorite(id) {
  return getFavorites().includes(id);
}

function toggleFavorite(id) {
  let favs = getFavorites();
  if (favs.includes(id)) {
    favs = favs.filter((f) => f !== id);
  } else {
    favs.push(id);
  }
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  return favs.includes(id);
}

/* ---------- Layout: header + footer ---------- */

function renderHeader(activePath) {
  const el = document.getElementById("site-header");
  if (!el) return;
  el.innerHTML = `
    <div class="container">
      <a href="index.html" class="brand">
        <span class="brand-mark">${icon("house")}</span>
        ${SITE.name}
      </a>
      <nav class="main-nav" id="main-nav">
        <a href="index.html" ${activePath === "index" ? 'class="active"' : ""}>Inicio</a>
        <a href="catalogo.html" ${activePath === "catalogo" ? 'class="active"' : ""}>Catálogo</a>
        <a href="favoritos.html" class="nav-fav">${icon("heart")} Favoritos</a>
      </nav>
      <button class="nav-toggle" id="nav-toggle" aria-label="Abrir menú">${icon("menu")}</button>
    </div>
  `;
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");
  if (toggle) {
    toggle.addEventListener("click", () => {
      nav.style.display = nav.style.display === "flex" ? "none" : "flex";
      nav.style.cssText += "position:absolute;top:72px;left:0;right:0;background:var(--bg);flex-direction:column;padding:16px 24px;border-bottom:1px solid var(--border);align-items:flex-start;gap:16px;";
    });
  }
}

function renderFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  const year = new Date().getFullYear();
  el.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="brand" style="margin-bottom:10px;">
            <span class="brand-mark">${icon("house")}</span> ${SITE.name}
          </div>
          <p style="max-width:34ch;">${SITE.tagline} — catálogo curado para montar tu escritorio y tu habitación.</p>
        </div>
        <div class="footer-links">
          <a href="index.html">Inicio</a>
          <a href="catalogo.html">Catálogo</a>
          <a href="favoritos.html">Favoritos</a>
          <a href="${SITE.social.instagram}" target="_blank" rel="noopener">Instagram</a>
          <a href="${SITE.social.tiktok}" target="_blank" rel="noopener">TikTok</a>
        </div>
      </div>
      <p class="footer-note">© ${year} ${SITE.name}. Como afiliados de Amazon, obtenemos comisiones por las compras que cumplen los requisitos aplicables, sin coste adicional para ti.</p>
    </div>
  `;
}

/* ---------- Productos ---------- */

async function loadProducts() {
  const res = await fetch("data/products.json");
  return res.json();
}

function productCard(p) {
  const cat = getCategory(p.category);
  const fav = isFavorite(p.id);
  return `
    <article class="product-card" data-id="${p.id}">
      <button class="fav-btn ${fav ? "active" : ""}" data-fav="${p.id}" aria-label="Guardar en favoritos" title="Guardar en favoritos">
        ${icon("heart")}
      </button>
      <a href="producto.html?id=${encodeURIComponent(p.id)}" class="thumb">
        <img src="${p.image}" alt="${p.name}" loading="lazy">
      </a>
      <div class="info">
        <span class="cat-tag">${cat ? cat.name : p.category}</span>
        <h3><a href="producto.html?id=${encodeURIComponent(p.id)}">${p.name}</a></h3>
      </div>
    </article>
  `;
}

function bindFavButtons(root = document) {
  root.querySelectorAll("[data-fav]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute("data-fav");
      const active = toggleFavorite(id);
      btn.classList.toggle("active", active);
    });
  });
}

function renderCategoryGrid(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = CATEGORIES.map(
    (c) => `
    <a class="cat-card" href="catalogo.html?cat=${c.slug}">
      <span class="cat-icon">${icon(c.icon)}</span>
      <h3>${c.name}</h3>
      <p>${c.description}</p>
    </a>
  `
  ).join("");
}
