# RoomFindsClub

Catálogo de afiliados de Amazon para setups de escritorio, gaming y habitación. Público: US/UK (web en inglés).
Web: https://roomfindsclub.com

## Cómo funciona

- **`data/products.json`** — el catálogo. Es lo único que cambia en el día a día.
- **`data/config.json`** — nombre, tags de afiliado, redes y las 18 categorías (con sus consejos de compra).
- **`scripts/build.js`** — genera la web completa en `_site/` como HTML estático (cada producto y categoría tiene su propia página, visible para Google y para los crawlers de IA sin ejecutar JavaScript). Sin dependencias: `node scripts/build.js`.
- **`.github/workflows/deploy.yml`** — en cada push a `main`, GitHub Actions ejecuta el build y publica en GitHub Pages. Si un producto tiene datos inválidos, el build se para y la web publicada no se toca.
- **`assets/`** — CSS, JS, fuentes (alojadas aquí, sin Google Fonts) e imágenes.
- **`assets/img/categories/<slug>.webp`** (o `.jpg`/`.png`) — foto de cada tarjeta de categoría (cuadrada, producto sobre fondo negro). Si falta, se muestra el icono.

## Añadir productos (panel admin: `/admin/`)

1. En Amazon, en la ficha del producto, pulsa el marcador **RFC Grab** (se instala arrastrándolo desde el admin). Abre el admin con nombre, descripción, foto y enlace de afiliado ya rellenos.
   - Alternativa: pega el enlace en el admin y pulsa *Autorrellenar* (Amazon suele bloquearlo) o rellena a mano.
2. Elige categoría y pulsa **Guardar ficha**. Se queda en tu navegador como borrador.
3. Pulsa **Publicar**: hace commit de `data/products.json` en GitHub y la web se reconstruye sola en 1–2 minutos.

El botón Publicar necesita un token *fine-grained* de GitHub (solo este repo, permiso *Contents: Read and write*), que se guarda únicamente en tu navegador.

## Seguridad del admin

El código no contiene ninguna contraseña. `/admin/` se protege con **Cloudflare Access** delante del dominio. El panel por sí solo no puede modificar nada sin tu token de GitHub.

## Reglas del catálogo

- Las categorías sin productos no muestran "Coming soon": llevan `noindex` y no entran en el sitemap hasta tener su primera ficha.

- Las fichas muestran solo **nombre, descripción y foto**. Nunca precios ni estrellas.
- Aviso de afiliado obligatorio en todas las páginas: "As an Amazon Associate I earn from qualifying purchases."
