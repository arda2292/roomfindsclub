# RoomFindsClub

Catálogo de afiliados de Amazon para setups de escritorio y habitación. Sitio estático, publicado en GitHub Pages.

## Estructura

- `index.html` — portada con categorías y FAQ (SEO/GEO/AEO).
- `catalogo.html` — catálogo filtrable por categoría (`?cat=slug`).
- `producto.html` — ficha de producto (`?id=producto-id`). Sin precios ni estrellas: solo nombre, descripción y foto.
- `favoritos.html` — favoritos guardados en el navegador (localStorage).
- `admin.html` — panel privado (protegido por contraseña básica en el navegador, ver `js/admin.js`):
  1. Convierte enlaces de Amazon en bruto a enlaces de afiliado con el tag `findsondesk-20`.
  2. Formulario de producto con intento de autorrelleno desde el enlace (best-effort: Amazon bloquea el scraping a menudo, así que a veces hay que copiar los datos a mano desde la ficha).
  3. Genera y descarga un `products.json` actualizado con los borradores añadidos.
- `data/products.json` — catálogo de productos.
- `js/config.js` — categorías y ajustes de marca.
- `scripts/generate-sitemap.js` — regenera `sitemap.xml` a partir de `data/products.json`.

## Añadir productos

1. Abre `admin.html` en el sitio publicado (o en local) e introduce la contraseña.
2. Pega el enlace de Amazon, pulsa "Autorrellenar" y revisa/completa nombre, descripción e imagen.
3. Pulsa "Añadir a borradores".
4. Cuando tengas varios, pulsa "Descargar products.json actualizado" y sustituye el archivo `data/products.json` del repositorio (o pide a Claude que lo haga).
5. Ejecuta `node scripts/generate-sitemap.js` para actualizar el sitemap y haz commit.

## Cambiar la contraseña del admin

Edita `ADMIN_PASSWORD` en `js/admin.js`. Es una barrera básica en el navegador, no seguridad real — no subas nada sensible al panel.

## Dominio

El archivo `CNAME` apunta a `roomfindsclub.com`. GitHub Pages sirve el sitio desde la rama configurada en Settings → Pages.
