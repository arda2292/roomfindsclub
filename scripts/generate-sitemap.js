/* Regenera sitemap.xml a partir de data/products.json y las categorías.
   Ejecutar con: node scripts/generate-sitemap.js
   Hazlo cada vez que añadas productos nuevos al catálogo. */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOMAIN = "https://roomfindsclub.com";

const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data/products.json"), "utf8"));

// Categorías (duplicadas aquí en formato simple para no depender del navegador)
const configText = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
const slugs = [...configText.matchAll(/slug:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);

const today = new Date().toISOString().slice(0, 10);

const staticUrls = [
  { loc: `${DOMAIN}/`, priority: "1.0" },
  { loc: `${DOMAIN}/catalogo.html`, priority: "0.9" }
];

const catUrls = slugs.map((slug) => ({
  loc: `${DOMAIN}/catalogo.html?cat=${slug}`,
  priority: "0.7"
}));

const productUrls = products.map((p) => ({
  loc: `${DOMAIN}/producto.html?id=${p.id}`,
  priority: "0.6"
}));

const all = [...staticUrls, ...catUrls, ...productUrls];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml);
console.log(`sitemap.xml generado con ${all.length} URLs.`);
