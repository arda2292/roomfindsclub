#!/usr/bin/env node
/*
 * RoomFindsClub — static site generator (no dependencies).
 *
 *   node scripts/build.js          -> builds the site into ./_site
 *
 * Every page is pre-rendered HTML so search engines and AI crawlers
 * (which usually don't run JavaScript) see the full content.
 * Runs automatically on GitHub Actions on every push to main.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "_site");

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "data/config.json"), "utf8"));
const productsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data/products.json"), "utf8"));
const SITE = config.site;
const CATS = config.categories;
const GROUPS = config.groups;
const CAT = Object.fromEntries(CATS.map((c) => [c.slug, c]));
const YEAR = new Date().getFullYear();
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Validation — a broken product stops the build instead of the site  */
/* ------------------------------------------------------------------ */

function validate(products) {
  const errors = [];
  const ids = new Set();
  const asins = new Map();
  products.forEach((p, i) => {
    const where = `products[${i}] (${p && p.id ? p.id : "no id"})`;
    if (!p || typeof p !== "object") return errors.push(`${where}: not an object`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id || "")) errors.push(`${where}: id must be lowercase-with-dashes`);
    if (ids.has(p.id)) errors.push(`${where}: duplicate id`);
    ids.add(p.id);
    if (!p.name || !String(p.name).trim()) errors.push(`${where}: missing name`);
    if (!/^https:\/\//.test(p.image || "")) errors.push(`${where}: image must be an https URL`);
    if (!CAT[p.category]) errors.push(`${where}: unknown category "${p.category}"`);
    let link;
    try { link = new URL(p.affiliateLink); } catch (e) { errors.push(`${where}: affiliateLink is not a valid URL`); }
    if (link) {
      if (!/(^|\.)amazon\./.test(link.hostname)) errors.push(`${where}: affiliateLink is not an Amazon URL`);
      if (!link.searchParams.get("tag")) errors.push(`${where}: affiliateLink has no affiliate tag`);
      const m = link.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
      if (m) {
        const asin = m[1].toUpperCase();
        if (asins.has(asin)) errors.push(`${where}: duplicate product — ASIN ${asin} is already used by "${asins.get(asin)}"`);
        else asins.set(asin, p.id);
      }
    }
  });
  if (errors.length) {
    console.error("\nBuild stopped — fix these product errors in data/products.json:\n");
    errors.forEach((e) => console.error("  • " + e));
    console.error("");
    process.exit(1);
  }
}
validate(productsRaw);

const PRODUCTS = productsRaw
  .map((p, i) => ({ ...p, _i: i }))
  .sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || "") || b._i - a._i);
const byCat = (slug) => PRODUCTS.filter((p) => p.category === slug);

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const abs = (p) => SITE.url + p;

function plain(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function metaDescription(text, max = 155) {
  const t = plain(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,.;:\s]+$/, "") + "…";
}

/* Amazon copy often labels bullets as 【Label】 — show them as "Label: ". */
function tidy(text) {
  return String(text || "").replace(/【\s*([^】]*?)\s*】\s*/g, "$1: ");
}

/* Amazon titles run 100–200 characters. For <title> and cards in search results keep the
   first clause (up to the first comma, dash or bracket) and cap it at ~55 characters. */
function shortName(name, max = 55) {
  const full = plain(name);
  const first = full.split(/\s*(?:[,，]|\s[-–—|]\s|\(|【)\s*/)[0].trim();
  const base = first.length >= 20 ? first : full;
  if (base.length <= max) return base;
  const words = base.slice(0, max + 1).split(" ").slice(0, -1);
  // don't end on a connector ("… Keyboard with", "… Desk for")
  while (words.length > 3 && /^(with|for|and|or|the|of|to|in|on|a|an|&|-|–|\+)$/i.test(words[words.length - 1])) words.pop();
  return words.join(" ").replace(/[,.;:&\-–\s]+$/, "");
}

/* First bullet of a description, without the list marker. */
function firstLine(text) {
  return tidy(text).split(/\r?\n/).map((l) => l.replace(/^[-•*]\s+/, "").trim()).filter(Boolean)[0] || "";
}

/* Descriptions: blank-line paragraphs; lines starting with -, • or * become a list. */
function renderDescription(text) {
  const lines = tidy(text).split(/\r?\n/);
  let html = "", para = [], list = [];
  const flushPara = () => { if (para.length) { html += `<p>${esc(para.join(" "))}</p>`; para = []; } };
  const flushList = () => { if (list.length) { html += `<ul>${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`; list = []; } };
  lines.forEach((raw) => {
    const line = raw.trim();
    const m = line.match(/^[-•*]\s+(.*)$/);
    if (m) { flushPara(); list.push(m[1]); }
    else if (!line) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  });
  flushPara(); flushList();
  return html;
}

function asinFromLink(link) {
  const m = String(link).match(/\/dp\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

/* ------------------------------------------------------------------ */
/* Icons                                                              */
/* ------------------------------------------------------------------ */

const ICON_PATHS = {
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  external: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  desk: '<path d="M3 8h18M5 8v11M19 8v11M5 13h6"/>',
  chair: '<path d="M7 3h10v9H7z"/><path d="M5 12h14M12 12v5M7 21l5-4 5 4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17.5 10h.01M7 14h10"/>',
  mouse: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3"/>',
  mat: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M14 10.5h3.5"/>',
  headphones: '<path d="M3 14a9 9 0 0 1 18 0"/><path d="M21 14v4a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 1Z"/><path d="M3 14v4a2 2 0 0 0 2 2h1v-7H5a2 2 0 0 0-2 1Z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>',
  speaker: '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14.5" r="3.5"/><path d="M12 6.5h.01"/>',
  webcam: '<circle cx="12" cy="10" r="6"/><circle cx="12" cy="10" r="2"/><path d="M8 21h8M12 16v5"/>',
  light: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>',
  arm: '<path d="M5 21V10a2 2 0 0 1 2-2h4"/><rect x="11" y="3" width="10" height="8" rx="1"/><path d="M3 21h4"/>',
  cable: '<path d="M4 3v6a4 4 0 0 0 4 4h8a4 4 0 0 1 4 4v4"/><path d="M2 3h4M18 21h4"/>',
  storage: '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M10 6.5h4M10 17.5h4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  gamepad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.2 2.2L9 15h6l1.8 2.2A3 3 0 0 0 22 15l-.7-6.4A4 4 0 0 0 17.3 5Z"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/>'
};

function icon(name, cls) {
  return `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ""}</svg>`;
}

/* The primary badge from the brand sheet, as inline SVG. */
function badge() {
  return `<svg viewBox="0 0 400 400" role="img" aria-labelledby="badge-title">
  <title id="badge-title">RoomFindsClub — Room &amp; Setup Finds</title>
  <defs>
    <path id="badge-top" d="M 51,200 A 149,149 0 0 1 349,200"/>
    <path id="badge-bottom" d="M 33,200 A 167,167 0 0 0 367,200"/>
  </defs>
  <circle cx="200" cy="200" r="196" fill="#121317"/>
  <circle cx="200" cy="200" r="182" fill="none" stroke="#c3ff3a" stroke-width="7"/>
  <circle cx="200" cy="200" r="134" fill="none" stroke="#c3ff3a" stroke-width="2"/>
  <circle cx="42" cy="200" r="5" fill="#c3ff3a"/>
  <circle cx="358" cy="200" r="5" fill="#c3ff3a"/>
  <g font-family="'JetBrains Mono', ui-monospace, monospace" font-weight="700" font-size="27" fill="#f1ede4" letter-spacing="7">
    <text text-anchor="middle"><textPath href="#badge-top" startOffset="50%">ROOMFINDS CLUB</textPath></text>
    <text text-anchor="middle"><textPath href="#badge-bottom" startOffset="50%">ROOM &amp; SETUP FINDS</textPath></text>
  </g>
  <path d="M142 204 200 153l58 51v58H142z" fill="none" stroke="#c3ff3a" stroke-width="14" stroke-linejoin="round"/>
  <rect x="174" y="207" width="52" height="33" rx="4" fill="#f1ede4"/>
  <rect x="196" y="240" width="8" height="22" fill="#f1ede4"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Components                                                         */
/* ------------------------------------------------------------------ */

function productCard(p) {
  const cat = CAT[p.category];
  const url = `/product/${p.id}/`;
  const searchText = esc(`${p.name} ${cat.name}`.toLowerCase());
  return `<article class="card" data-search-text="${searchText}">
  <button class="fav-btn" type="button" data-fav="${esc(p.id)}" aria-pressed="false" aria-label="Save to favorites">${icon("heart")}</button>
  <a class="card-media" href="${url}" tabindex="-1" aria-hidden="true"><img src="${esc(p.image)}" alt="${esc(shortName(p.name))}" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="400" height="400"></a>
  <div class="card-body">
    <span class="card-cat">${esc(cat.name)}</span>
    <h3 class="card-title"><a href="${url}">${esc(p.name)}</a></h3>
  </div>
</article>`;
}

/* Category photo: assets/img/categories/<slug>.(webp|jpg|png). Falls back to the icon until one is added. */
function categoryImage(slug) {
  const ext = ["webp", "jpg", "png"].find((e) => fs.existsSync(path.join(ROOT, "assets/img/categories", `${slug}.${e}`)));
  return ext ? `/assets/img/categories/${slug}.${ext}` : null;
}

function categoryCard(c) {
  const img = categoryImage(c.slug);
  return `<a class="cat-card" href="/category/${c.slug}/">
  <span class="cat-media">${img ? `<img src="${img}" alt="" loading="lazy" decoding="async" width="600" height="600">` : icon(c.icon)}</span>
  <span class="cat-label"><h3>${esc(c.name)}</h3>${icon("arrow")}</span>
</a>`;
}

function categoryGroups(headingTag = "h3") {
  return GROUPS.map((g) => {
    const cats = CATS.filter((c) => c.group === g.id);
    if (!cats.length) return "";
    return `<${headingTag} class="group-title">${esc(g.name)}</${headingTag}>
<div class="cat-grid">${cats.map(categoryCard).join("\n")}</div>`;
  }).join("\n");
}

function breadcrumbs(items) {
  const html = `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items
    .map((it, i) => (i === items.length - 1 ? `<li><span aria-current="page">${esc(it.name)}</span></li>` : `<li><a href="${it.path}">${esc(it.name)}</a></li>`))
    .join("")}</ol></nav>`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) }))
  };
  return { html, ld };
}

function itemListLd(products) {
  return {
    "@type": "ItemList",
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: abs(`/product/${p.id}/`), name: p.name }))
  };
}

function emptyState(title, text, cta) {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p>${cta || ""}</div>`;
}

/* ------------------------------------------------------------------ */
/* Layout                                                             */
/* ------------------------------------------------------------------ */

/* Cache-busting version for CSS/JS: changes whenever those files change. */
const ASSET_V = require("crypto").createHash("md5")
  .update(["assets/css/site.css", "assets/js/site.js", "assets/js/admin.js"].map((f) => fs.readFileSync(path.join(ROOT, f))).join(""))
  .digest("hex").slice(0, 8);

function layout({ title, description, path: pagePath, body, jsonld = [], ogType = "website", ogImage, noindex = false, active = "", scripts = [] }) {
  const canonical = abs(pagePath);
  const image = ogImage || abs("/assets/img/og.png");
  const nav = (href, label, key) => `<a href="${href}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="${SITE.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${canonical}">`}
<meta name="theme-color" content="#0c0d10">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:locale" content="${SITE.locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<link rel="preload" href="/assets/fonts/saira.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css?v=${ASSET_V}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/" aria-label="${esc(SITE.name)} home"><img src="/favicon.svg" alt="" width="34" height="34">${esc(SITE.name)}</a>
    <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav"><span class="visually-hidden">Menu</span>${icon("menu")}</button>
    <nav class="nav" id="site-nav" aria-label="Main">
      ${nav("/", "Home", "home")}
      ${nav("/catalog/", "Catalog", "catalog")}
      ${nav("/#categories", "Categories", "categories")}
      <a class="nav-fav" href="/favorites/"${active === "favorites" ? ' aria-current="page"' : ""}>${icon("heart")}Favorites<span class="fav-count" data-fav-count hidden>0</span></a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="brand" href="/"><img src="/favicon.svg" alt="" width="34" height="34">${esc(SITE.name)}</a>
        <p style="max-width:42ch;margin:14px 0 0;">${esc(SITE.tagline)} — curated desk, gaming and room setup picks, organized by category.</p>
      </div>
      <div>
        <h2>Explore</h2>
        <ul>
          <li><a href="/catalog/">All finds</a></li>
          <li><a href="/#categories">Categories</a></li>
          <li><a href="/favorites/">Your favorites</a></li>
        </ul>
      </div>
      <div>
        <h2>Follow</h2>
        <ul>
          <li><a href="${SITE.social.instagram}" rel="noopener" target="_blank">Instagram</a></li>
          <li><a href="${SITE.social.tiktok}" rel="noopener" target="_blank">TikTok</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-note">
      <span>© ${YEAR} ${esc(SITE.name)}</span>
      <span>${esc(SITE.affiliate.disclosure)}</span>
    </div>
  </div>
</footer>
<script src="/assets/js/site.js?v=${ASSET_V}" defer></script>
${scripts.map((s) => `<script src="${s}?v=${ASSET_V}" defer></script>`).join("\n")}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* Pages                                                              */
/* ------------------------------------------------------------------ */

const ORG_LD = {
  "@type": "Organization",
  "@id": abs("/#organization"),
  name: SITE.name,
  url: abs("/"),
  logo: abs("/assets/img/apple-touch-icon.png"),
  description: SITE.description,
  sameAs: Object.values(SITE.social)
};

const HOME_FAQ = [
  ["What is RoomFindsClub?", "RoomFindsClub is a curated catalog of desk, gaming and room setup products — desks, chairs, monitors, keyboards, audio, lighting, decor and collectibles — organized by category so you can find what you need without endless scrolling."],
  ["Why don't you show prices or star ratings?", "Prices and ratings on Amazon change constantly, sometimes several times a day. Instead of showing numbers that go stale, every find links straight to its Amazon page, where you always see the current price and reviews."],
  ["How does RoomFindsClub make money?", "Links to Amazon are affiliate links. As an Amazon Associate, RoomFindsClub earns from qualifying purchases, at no extra cost to you."],
  ["How do favorites work?", "Tap the heart on any find to save it. Favorites are stored in your browser — no account needed. Clearing your browser data or switching devices will reset them."],
  ["Do you sell or ship products?", "No. RoomFindsClub only curates and links to products. Orders, shipping and returns are handled by Amazon."]
];

function faqLd(pairs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } }))
  };
}

function faqHtml(pairs) {
  return `<div class="faq">${pairs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>`;
}

function pageHome() {
  const latest = PRODUCTS.slice(0, 8);
  const latestSection = latest.length
    ? `<section class="section" aria-labelledby="latest-title">
  <div class="container">
    <div class="section-head">
      <div><span class="eyebrow">Fresh picks</span><h2 id="latest-title">Latest finds</h2></div>
      <a class="text-link" href="/catalog/">See all finds ${icon("arrow")}</a>
    </div>
    <div class="product-grid">${latest.map(productCard).join("\n")}</div>
  </div>
</section>`
    : "";

  const body = `
<section class="hero">
  <div class="container hero-grid">
    <div>
      <span class="eyebrow">${esc(SITE.tagline)}</span>
      <h1>Build your setup. <em>Skip the scroll.</em></h1>
      <p class="lead">Hand-picked desk, gaming and room finds, sorted into ${CATS.length} categories. No stale prices, no noise — just the products worth a look, one tap from Amazon.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="/catalog/">Browse the catalog ${icon("arrow")}</a>
        <a class="btn btn-ghost" href="/favorites/">${icon("heart")} Your favorites</a>
      </div>
      <div class="hero-stats">
        <div><strong>${CATS.length}</strong>Categories</div>
        ${PRODUCTS.length ? `<div><strong>${PRODUCTS.length}</strong>Finds</div>` : ""}
        <div><strong>0</strong>Accounts needed</div>
      </div>
    </div>
    <div class="hero-badge">${badge()}</div>
  </div>
</section>
${latestSection}
<section class="section" id="categories" aria-labelledby="cat-title">
  <div class="container">
    <div class="section-head">
      <div><span class="eyebrow">Shop by category</span><h2 id="cat-title">Every corner of the setup</h2><p>From the desk itself to the last cable clip — and the stuff that makes the room feel like yours.</p></div>
    </div>
    ${categoryGroups("h3")}
  </div>
</section>
<section class="section" aria-labelledby="how-title">
  <div class="container">
    <div class="section-head"><div><span class="eyebrow">How it works</span><h2 id="how-title">Find it. Save it. Get it.</h2></div></div>
    <div class="steps">
      <div class="step"><h3>Browse by category</h3><p>Every find sits in the category where you'd look for it — desks, audio, lighting, decor and more.</p></div>
      <div class="step"><h3>Save your favorites</h3><p>Tap the heart to build a shortlist. It stays in your browser, no sign-up required.</p></div>
      <div class="step"><h3>Check it on Amazon</h3><p>When you're ready, jump to Amazon for the live price, reviews and delivery options.</p></div>
    </div>
  </div>
</section>
<section class="section" aria-labelledby="faq-title">
  <div class="container">
    <div class="section-head"><div><span class="eyebrow">FAQ</span><h2 id="faq-title">Good questions</h2></div></div>
    ${faqHtml(HOME_FAQ)}
  </div>
</section>`;

  return layout({
    title: `${SITE.name} — Desk, Gaming & Room Setup Finds`,
    description: "Curated desk, gaming and room setup finds: desks, chairs, monitors, keyboards, audio, lighting and decor, sorted into 18 categories and linked to Amazon.",
    path: "/",
    active: "home",
    body,
    jsonld: [
      {
        "@context": "https://schema.org",
        "@graph": [
          ORG_LD,
          {
            "@type": "WebSite",
            "@id": abs("/#website"),
            name: SITE.name,
            url: abs("/"),
            description: SITE.description,
            inLanguage: SITE.language,
            publisher: { "@id": abs("/#organization") },
            potentialAction: {
              "@type": "SearchAction",
              target: { "@type": "EntryPoint", urlTemplate: abs("/catalog/?q={search_term_string}") },
              "query-input": "required name=search_term_string"
            }
          }
        ]
      },
      faqLd(HOME_FAQ)
    ]
  });
}

function chipsRow(activeSlug) {
  return `<nav class="chips" aria-label="Categories">
  <a class="chip" href="/catalog/"${!activeSlug ? ' aria-current="page"' : ""}>All</a>
  ${CATS.map((c) => `<a class="chip" href="/category/${c.slug}/"${c.slug === activeSlug ? ' aria-current="page"' : ""}>${esc(c.name)}</a>`).join("\n  ")}
</nav>`;
}

function pageCatalog() {
  const crumbs = breadcrumbs([{ name: "Home", path: "/" }, { name: "Catalog", path: "/catalog/" }]);
  const grid = PRODUCTS.length
    ? `<p class="result-note" data-search-note aria-live="polite"></p>
<div class="product-grid">${PRODUCTS.map(productCard).join("\n")}</div>
<div class="empty" data-search-empty hidden><h2>No matches</h2><p>Try a different word, or browse by category.</p></div>`
    : emptyState("The first finds are on the way", "We're curating the catalog right now. Follow along on Instagram or TikTok to see new finds as they drop.", `<a class="btn btn-primary" href="${SITE.social.tiktok}" rel="noopener" target="_blank">Follow on TikTok</a>`);

  const body = `
<div class="container">
  <header class="page-head">
    ${crumbs.html}
    <h1>All finds</h1>
    <p class="lead">Every product in the club, newest first. Search by name or jump into a category.</p>
  </header>
  ${PRODUCTS.length ? `<div class="toolbar"><label class="search"><span class="visually-hidden">Search finds</span>${icon("search")}<input type="search" data-search placeholder="Search finds — e.g. desk mat, headset, LED" autocomplete="off"></label></div>` : ""}
  ${chipsRow(null)}
  ${grid}
</div>`;

  return layout({
    title: `All Finds — Desk, Gaming & Room Setup Catalog | ${SITE.name}`,
    description: metaDescription(`Browse all ${PRODUCTS.length} RoomFindsClub finds: desks, chairs, monitors, keyboards, audio, lighting and more for your desk, gaming and room setup.`),
    path: "/catalog/",
    active: "catalog",
    body,
    jsonld: [
      { "@context": "https://schema.org", "@type": "CollectionPage", name: "All finds", url: abs("/catalog/"), isPartOf: { "@id": abs("/#website") }, mainEntity: itemListLd(PRODUCTS) },
      crumbs.ld
    ]
  });
}

function pageCategory(c) {
  const items = byCat(c.slug);
  const crumbs = breadcrumbs([{ name: "Home", path: "/" }, { name: "Catalog", path: "/catalog/" }, { name: c.name, path: `/category/${c.slug}/` }]);
  const question = `What should I look for when buying ${c.name.toLowerCase()}?`;
  const answer = c.tips.join(" ");

  const body = `
<div class="container">
  <header class="page-head">
    ${crumbs.html}
    <h1>${esc(c.name)}</h1>
    <p class="lead">${esc(c.description)}</p>
  </header>
  ${chipsRow(c.slug)}
  ${items.length
    ? `<div class="product-grid">${items.map(productCard).join("\n")}</div>`
    : emptyState(`Shopping for ${c.name.toLowerCase()}?`, "Start with the buying tips below, then browse the rest of the setup finds.", `<a class="btn btn-ghost" href="/catalog/">Browse all finds</a>`)}
</div>
<section class="section" aria-labelledby="tips-title">
  <div class="container">
    <div class="section-head"><div><span class="eyebrow">Buying tips</span><h2 id="tips-title">${esc(question)}</h2></div></div>
    <ol class="tips">${c.tips.map((t, i) => `<li><strong>TIP 0${i + 1}</strong>${esc(t)}</li>`).join("")}</ol>
  </div>
</section>`;

  return layout({
    title: `${c.name} for Your Setup | ${SITE.name}`,
    description: metaDescription(`${c.description} ${items.length ? `${items.length} curated finds` : "Curated finds"} plus tips on what to look for.`),
    path: `/category/${c.slug}/`,
    noindex: !items.length,
    active: "categories",
    body,
    jsonld: [
      { "@context": "https://schema.org", "@type": "CollectionPage", name: c.name, description: c.description, url: abs(`/category/${c.slug}/`), isPartOf: { "@id": abs("/#website") }, mainEntity: itemListLd(items) },
      crumbs.ld,
      faqLd([[question, answer]])
    ]
  });
}

function pageProduct(p) {
  const c = CAT[p.category];
  const url = `/product/${p.id}/`;
  const crumbs = breadcrumbs([{ name: "Home", path: "/" }, { name: c.name, path: `/category/${c.slug}/` }, { name: p.name, path: url }]);
  const related = byCat(c.slug).filter((x) => x.id !== p.id).slice(0, 4);
  const asin = asinFromLink(p.affiliateLink);

  const body = `
<div class="container">
  <div class="page-head" style="padding-bottom:12px;">${crumbs.html}</div>
  <article class="product">
    <div class="product-media"><img src="${esc(p.image)}" alt="${esc(p.name)}" referrerpolicy="no-referrer" width="600" height="600" fetchpriority="high"></div>
    <div class="product-info">
      <a class="pill" href="/category/${c.slug}/">${esc(c.name)}</a>
      <h1>${esc(p.name)}</h1>
      <div class="product-desc">${renderDescription(p.description)}</div>
      <div class="product-actions">
        <a class="btn btn-primary" href="${esc(p.affiliateLink)}" rel="sponsored nofollow noopener" target="_blank">Check it on Amazon ${icon("external")}</a>
        <button class="btn btn-ghost" type="button" data-fav="${esc(p.id)}" aria-pressed="false">${icon("heart")}<span data-fav-label>Save for later</span></button>
      </div>
      <p class="disclosure">${esc(SITE.affiliate.disclosure)} Price and availability are shown on Amazon.</p>
    </div>
  </article>
</div>
${related.length ? `<section class="section" aria-labelledby="related-title">
  <div class="container">
    <div class="section-head"><div><span class="eyebrow">More ${esc(c.name.toLowerCase())}</span><h2 id="related-title">You might also like</h2></div><a class="text-link" href="/category/${c.slug}/">All ${esc(c.name.toLowerCase())} ${icon("arrow")}</a></div>
    <div class="product-grid">${related.map(productCard).join("\n")}</div>
  </div>
</section>` : ""}`;

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: plain(tidy(p.description).replace(/^[-•*]\s+/gm, "")),
    image: [p.image],
    url: abs(url),
    category: c.name
  };
  if (asin) productLd.productID = `asin:${asin}`;
  if (p.brand) productLd.brand = { "@type": "Brand", name: p.brand };

  return layout({
    title: `${shortName(p.name)} | ${SITE.name}`,
    description: metaDescription(`${shortName(p.name)}: ${firstLine(p.description) || `a hand-picked ${c.name.toLowerCase()} find for your setup.`}`),
    path: url,
    active: "categories",
    ogType: "product",
    ogImage: p.image,
    body,
    jsonld: [productLd, crumbs.ld]
  });
}

function pageFavorites() {
  const body = `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Saved in this browser</span>
    <h1>Your favorites</h1>
    <p class="lead">Everything you've hearted, in one place. Come back any time — no account needed.</p>
  </header>
  <div class="product-grid" data-favorites-grid hidden></div>
  <div class="empty" data-favorites-empty hidden>
    <h2>Nothing saved yet</h2>
    <p>Tap the heart on any find to keep it here for later.</p>
    <a class="btn btn-primary" href="/catalog/">Browse the catalog</a>
  </div>
  <noscript><div class="empty"><h2>Favorites need JavaScript</h2><p>Enable JavaScript to see the finds you've saved.</p></div></noscript>
</div>`;
  return layout({
    title: `Your Favorites | ${SITE.name}`,
    description: "The finds you've saved on RoomFindsClub.",
    path: "/favorites/",
    active: "favorites",
    noindex: true,
    body
  });
}

function page404() {
  const body = `
<div class="container">
  <div class="page-head" style="padding:96px 0;">
    <span class="eyebrow">Error 404</span>
    <h1>This find wandered off</h1>
    <p class="lead">The page you're looking for doesn't exist or has moved.</p>
    <div class="hero-actions" style="margin-top:28px;">
      <a class="btn btn-primary" href="/catalog/">Browse the catalog</a>
      <a class="btn btn-ghost" href="/">Go home</a>
    </div>
  </div>
</div>`;
  return layout({ title: `Page not found | ${SITE.name}`, description: "Page not found.", path: "/404.html", noindex: true, body });
}

function pageAdmin() {
  const body = fs.readFileSync(path.join(ROOT, "scripts/admin-body.html"), "utf8");
  return layout({
    title: `Admin | ${SITE.name}`,
    description: "Private admin panel.",
    path: "/admin/",
    noindex: true,
    body,
    scripts: ["/assets/js/admin.js"]
  });
}

/* ------------------------------------------------------------------ */
/* SEO / GEO files                                                    */
/* ------------------------------------------------------------------ */

function sitemap() {
  const urls = [
    { loc: "/", priority: "1.0", lastmod: BUILD_DATE },
    { loc: "/catalog/", priority: "0.9", lastmod: BUILD_DATE },
    ...CATS.filter((c) => byCat(c.slug).length).map((c) => ({ loc: `/category/${c.slug}/`, priority: "0.8", lastmod: BUILD_DATE })),
    ...PRODUCTS.map((p) => ({ loc: `/product/${p.id}/`, priority: "0.7", lastmod: p.dateUpdated || p.dateAdded || BUILD_DATE }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${abs(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>
`;
}

function robots() {
  const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended"];
  return `# RoomFindsClub — search engines and AI assistants are welcome.
User-agent: *
Allow: /
Disallow: /admin/

${aiBots.map((b) => `User-agent: ${b}`).join("\n")}
Allow: /
Disallow: /admin/

Sitemap: ${abs("/sitemap.xml")}
`;
}

/* llms.txt — a plain-text map of the site for AI assistants (llmstxt.org). */
function llmsTxt() {
  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    "RoomFindsClub does not list prices or star ratings; each product links to its Amazon page for current price, reviews and availability. " + SITE.affiliate.disclosure,
    "",
    "## Categories",
    "",
    ...CATS.map((c) => `- [${c.name}](${abs(`/category/${c.slug}/`)}): ${c.description}`),
    ""
  ];
  if (PRODUCTS.length) {
    lines.push("## Products", "");
    PRODUCTS.forEach((p) => lines.push(`- [${p.name}](${abs(`/product/${p.id}/`)}): ${CAT[p.category].name}. ${metaDescription(firstLine(p.description), 140)}`));
    lines.push("");
  }
  lines.push("## Optional", "", `- [Full catalog](${abs("/catalog/")})`, `- [Instagram](${SITE.social.instagram})`, `- [TikTok](${SITE.social.tiktok})`, "");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

write("index.html", pageHome());
write("catalog/index.html", pageCatalog());
CATS.forEach((c) => write(`category/${c.slug}/index.html`, pageCategory(c)));
PRODUCTS.forEach((p) => write(`product/${p.id}/index.html`, pageProduct(p)));
write("favorites/index.html", pageFavorites());
write("admin/index.html", pageAdmin());
write("404.html", page404());
write("sitemap.xml", sitemap());
write("robots.txt", robots());
write("llms.txt", llmsTxt());
write("CNAME", fs.readFileSync(path.join(ROOT, "CNAME"), "utf8"));
write(".nojekyll", "");

copyDir(path.join(ROOT, "assets"), path.join(OUT, "assets"));
fs.copyFileSync(path.join(ROOT, "assets/img/favicon.svg"), path.join(OUT, "favicon.svg"));
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "data/config.json"), path.join(OUT, "data/config.json"));
fs.copyFileSync(path.join(ROOT, "data/products.json"), path.join(OUT, "data/products.json"));

console.log(`Built ${SITE.name}: ${CATS.length} categories, ${PRODUCTS.length} products → _site/`);
