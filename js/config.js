/* RoomFindsClub — configuración global de marca, categorías y afiliación */

const SITE = {
  name: "RoomFindsClub",
  tagline: "Room & Setup Finds",
  domain: "https://roomfindsclub.com",
  description:
    "Catálogo curado de mesas, sillas, monitores, teclados y accesorios para montar tu setup ideal. Sin ruido, sin precios que cambian cada día: solo los productos que merecen la pena.",
  affiliateTag: "findsondesk-20",
  social: {
    instagram: "https://instagram.com/roomfindsclub",
    tiktok: "https://tiktok.com/@roomfindsclub"
  }
};

/* Categorías del catálogo. El "slug" se usa en la URL (catalogo.html?cat=slug) */
const CATEGORIES = [
  { slug: "mesas", name: "Mesas y escritorios", icon: "desk", description: "Escritorios fijos, eléctricos y de pie para armar la base de tu setup." },
  { slug: "sillas", name: "Sillas", icon: "chair", description: "Sillas ergonómicas y gaming para las horas largas frente a la pantalla." },
  { slug: "monitores", name: "Monitores", icon: "monitor", description: "Pantallas, monitores curvos y soportes duales para tu escritorio." },
  { slug: "teclados", name: "Teclados", icon: "keyboard", description: "Mecánicos, inalámbricos y de bajo perfil para escribir o jugar mejor." },
  { slug: "ratones", name: "Ratones", icon: "mouse", description: "Ratones ergonómicos, gaming y verticales." },
  { slug: "sonido", name: "Sonido", icon: "speaker", description: "Altavoces de escritorio y barras de sonido compactas." },
  { slug: "auriculares", name: "Auriculares", icon: "headphones", description: "Auriculares con cable, inalámbricos y con cancelación de ruido." },
  { slug: "microfonos", name: "Micrófonos", icon: "mic", description: "Micrófonos USB y XLR para streaming, videollamadas y podcast." },
  { slug: "alfombrillas", name: "Alfombrillas", icon: "mat", description: "Alfombrillas de ratón, deskmats XL y superficies para escritorio." },
  { slug: "iluminacion", name: "Iluminación", icon: "light", description: "Lámparas de escritorio, tiras LED y luces de ambiente para setups." },
  { slug: "soportes-brazos", name: "Soportes y brazos", icon: "arm", description: "Brazos para monitor, soportes de portátil y elevadores." },
  { slug: "cables-organizacion", name: "Organización de cables", icon: "cable", description: "Canaletas, bandejas y clips para un escritorio sin cables a la vista." },
  { slug: "webcams", name: "Webcams", icon: "webcam", description: "Cámaras para videollamadas y streaming en alta calidad." },
  { slug: "almacenamiento", name: "Almacenamiento y organización", icon: "storage", description: "Organizadores, cajoneras y estanterías de escritorio." }
];

function getCategory(slug) {
  return CATEGORIES.find((c) => c.slug === slug);
}
