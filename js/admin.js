/* RoomFindsClub — panel admin: conversor de enlaces, autofill best-effort, borradores */

/* Cambia esta contraseña. Aviso: es solo una barrera básica en el navegador,
   no seguridad real — cualquiera que vea el código fuente puede leerla.
   Para proteger de verdad /admin.html hay que restringir el acceso a nivel
   de hosting (contraseña de servidor) o mover el panel fuera del repo público. */
const ADMIN_PASSWORD = "roomfinds2026";
const DRAFTS_KEY = "rfc_admin_drafts";

/* ---------- Conversión de enlaces a afiliado ---------- */

function extractASIN(url) {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/product\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i,
    /\/([A-Z0-9]{10})(?:[/?]|$)/i
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function convertToAffiliate(raw) {
  raw = raw.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/amazon\./i.test(url.hostname)) {
      return { ok: false, input: raw, error: "No parece un enlace de Amazon" };
    }
    const asin = extractASIN(url.pathname + url.search);
    if (asin) {
      const clean = `https://${url.hostname}/dp/${asin}?tag=${SITE.affiliateTag}`;
      return { ok: true, input: raw, output: clean, asin };
    }
    // Fallback: no se encontró ASIN, solo sustituimos/añadimos el tag
    url.searchParams.set("tag", SITE.affiliateTag);
    return { ok: true, input: raw, output: url.toString(), asin: null, fallback: true };
  } catch (e) {
    return { ok: false, input: raw, error: "URL no válida" };
  }
}

/* ---------- Borradores (localStorage) ---------- */

function getDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveDrafts(drafts) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

function addDraft(product) {
  const drafts = getDrafts();
  drafts.push(product);
  saveDrafts(drafts);
  return drafts;
}

function removeDraft(id) {
  const drafts = getDrafts().filter((d) => d.id !== id);
  saveDrafts(drafts);
  return drafts;
}

function slugify(text) {
  return text
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/* ---------- Autofill best-effort vía proxy CORS público ----------
   Amazon bloquea peticiones directas desde el navegador (CORS + anti-bot),
   así que esto es un intento best-effort a través de un proxy público y
   puede fallar. Cuando falle, se rellena a mano con los datos de la ficha
   de Amazon (nombre, descripción, foto). */

async function attemptAutofill(amazonUrl) {
  const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(amazonUrl)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(proxied, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("proxy status " + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const ogTitle = doc.querySelector('meta[property="og:image"]');
    const title =
      doc.querySelector("#productTitle")?.textContent.trim() ||
      doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      doc.querySelector("title")?.textContent.replace(/Amazon\.\w+:\s*/i, "").trim();

    const image =
      doc.querySelector("#landingImage")?.getAttribute("src") ||
      doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
      "";

    let description = "";
    const bullets = doc.querySelectorAll("#feature-bullets li span.a-list-item");
    if (bullets.length) {
      description = Array.from(bullets)
        .map((b) => b.textContent.trim())
        .filter(Boolean)
        .slice(0, 5)
        .join(". ");
    } else {
      description = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    }

    if (!title && !image) throw new Error("No se pudo extraer contenido de la página");

    return { ok: true, title: title || "", image: image || "", description: description || "" };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, error: e.message || "Fallo al obtener la página" };
  }
}
