/**
 * Made-up fixtures for the translate-and-approve tests (lane D2). Every name, employer and place here is
 * invented; this repo is public.
 */
import type { UnitKind } from "../translate-approve/units";

export interface Pair {
  kind: UnitKind;
  es: string;
  en: string;
}

/** A made-up Spanish work history in the shape the Forge writes, with an English line for every unit. */
export const ES_HISTORY = `Marisol Quintero
(555) 010-0142 | marisol.quintero@example.com | Springfield, OH

RESUMEN PROFESIONAL
Cocinera con 6 años de experiencia en restaurantes de comida rápida.

EXPERIENCIA LABORAL

Cocinera | Café Rosa | Springfield, OH | marzo 2019 - presente
- Preparé 150 platos por turno
- Capacité a cuatro cocineros nuevos
- Lavé platos y limpié la cocina

Ayudante de cocina | Harbor Seafood Company | Dayton, OH | enero 2016 - febrero 2019
- Atendí a 40 clientes por día
- Manejé 1.200 cajas por semana

EDUCACIÓN
Diploma de preparatoria | Escuela Central, 2012

HABILIDADES
Cocina, caja, limpieza`;

/** The English a careful model would write for each unit of ES_HISTORY, keyed by the Spanish line. */
export const EN_FOR: Record<string, string> = {
  "Cocinera con 6 años de experiencia en restaurantes de comida rápida.": "Cook with 6 years of experience in fast food restaurants.",
  "Cocinera | Café Rosa | Springfield, OH | marzo 2019 - presente": "Line Cook | Café Rosa | Springfield, OH | March 2019 - Present",
  "Preparé 150 platos por turno": "Prepared 150 dishes per shift",
  "Capacité a cuatro cocineros nuevos": "Trained four new cooks",
  "Lavé platos y limpié la cocina": "Washed dishes and cleaned the kitchen",
  "Ayudante de cocina | Harbor Seafood Company | Dayton, OH | enero 2016 - febrero 2019": "Kitchen Helper | Harbor Seafood Company | Dayton, OH | January 2016 - February 2019",
  "Atendí a 40 clientes por día": "Served 40 customers per day",
  "Manejé 1.200 cajas por semana": "Handled 1,200 boxes per week",
  "Diploma de preparatoria | Escuela Central, 2012": "High School Diploma | Escuela Central, 2012",
  "Cocina, caja, limpieza": "Cooking, cash register, cleaning",
};

/** Ordinary resume lines in plain Spanish and the plain English a careful translator writes. All of them must pass the checker. */
export const ORDINARY_PAIRS: Pair[] = [
  // duties
  { kind: "duty", es: "Preparé comidas para 80 clientes cada día", en: "Prepared meals for 80 customers each day" },
  { kind: "duty", es: "Serví mesas y tomé pedidos", en: "Served tables and took orders" },
  { kind: "duty", es: "Limpié el comedor y la cocina al cierre", en: "Cleaned the dining room and kitchen at closing" },
  { kind: "duty", es: "Cargué y descargué camiones", en: "Loaded and unloaded trucks" },
  { kind: "duty", es: "Operé un montacargas en el almacén", en: "Operated a forklift in the warehouse" },
  { kind: "duty", es: "Recibí mercancía y revisé las facturas", en: "Received merchandise and checked invoices" },
  { kind: "duty", es: "Atendí llamadas y respondí preguntas de los clientes", en: "Answered phone calls and customer questions" },
  { kind: "duty", es: "Cobré en caja y entregué el cambio", en: "Worked the register and gave change" },
  { kind: "duty", es: "Empaqué pedidos para envío", en: "Packed orders for shipping" },
  { kind: "duty", es: "Pinté paredes y reparé techos en casas", en: "Painted walls and repaired roofs on houses" },
  { kind: "duty", es: "Corté el pasto y podé árboles", en: "Mowed lawns and trimmed trees" },
  { kind: "duty", es: "Ayudé a preparar el desayuno", en: "Helped prepare breakfast" },
  { kind: "duty", es: "Mantuve limpia el área de trabajo", en: "Kept the work area clean" },
  { kind: "duty", es: "Seguí las reglas de seguridad", en: "Followed safety rules" },
  { kind: "duty", es: "Recogí la basura y limpié los baños", en: "Took out the trash and cleaned the restrooms" },
  { kind: "duty", es: "Conduje una camioneta de reparto", en: "Drove a delivery van" },
  { kind: "duty", es: "Armé cajas y etiqueté paquetes", en: "Assembled boxes and labeled packages" },
  { kind: "duty", es: "Hice sándwiches y ensaladas", en: "Made sandwiches and salads" },
  { kind: "duty", es: "Lavé ropa y planché uniformes", en: "Washed laundry and ironed uniforms" },
  { kind: "duty", es: "Cuidé a dos niños después de la escuela", en: "Cared for two children after school" },
  { kind: "duty", es: "Trabajé turnos de 10 horas", en: "Worked 10-hour shifts" },
  { kind: "duty", es: "Trabajé de noche, de 10 pm a 6 am", en: "Worked nights, 10 pm to 6 am" },
  { kind: "duty", es: "Aprendí a usar la caja registradora", en: "Learned to use the cash register" },
  { kind: "duty", es: "Organicé los estantes y el inventario", en: "Organized shelves and inventory" },
  { kind: "duty", es: "Ayudé a clientes a encontrar productos", en: "Helped customers find products" },
  { kind: "duty", es: "Preparé café y pasteles", en: "Prepared coffee and pastries" },
  { kind: "duty", es: "Mantuve registros de inventario", en: "Kept inventory records" },
  { kind: "duty", es: "Usé Excel para llevar el inventario", en: "Used Excel to track inventory" },
  { kind: "duty", es: "Trabajé en equipo con otros cocineros", en: "Worked as a team with other cooks" },
  { kind: "duty", es: "Entregué 30 paquetes al día", en: "Delivered 30 packages a day" },
  { kind: "duty", es: "Hablé con clientes en español e inglés", en: "Spoke with customers in Spanish and English" },
  { kind: "duty", es: "Cociné comida mexicana para eventos", en: "Cooked Mexican food for events" },
  { kind: "duty", es: "Anoté pedidos en la computadora", en: "Entered orders into the computer" },
  { kind: "duty", es: "Vendí ropa y ayudé en los probadores", en: "Sold clothing and helped in the fitting rooms" },
  { kind: "duty", es: "Preparé masa y horneé pan", en: "Made dough and baked bread" },
  { kind: "duty", es: "Limpié habitaciones de hotel", en: "Cleaned hotel rooms" },
  { kind: "duty", es: "Reparé tuberías y grifos", en: "Repaired pipes and faucets" },
  { kind: "duty", es: "Atendí la barra y serví bebidas", en: "Tended the bar and served drinks" },
  { kind: "duty", es: "Usé un patín hidráulico para mover paletas", en: "Used a pallet jack to move pallets" },
  { kind: "duty", es: "Terminé mis tareas a tiempo", en: "Finished my tasks on time" },
  { kind: "duty", es: "Ayudé a mi equipo a cumplir las metas", en: "Helped my team meet goals" },
  { kind: "duty", es: "Respondí quejas de clientes con calma", en: "Handled customer complaints calmly" },
  { kind: "duty", es: "Revisé que los productos no estuvieran dañados", en: "Checked that products were not damaged" },
  { kind: "duty", es: "Nunca falté al trabajo", en: "Never missed work" },
  { kind: "duty", es: "Cociné para eventos de hasta 200 personas", en: "Cooked for events of up to 200 people" },
  { kind: "duty", es: "Hice entregas de comida a domicilio", en: "Made home food deliveries" },
  // job headers
  { kind: "header", es: "Mesera | Restaurante La Palma | Columbus, OH | junio 2017 - agosto 2020", en: "Server | Restaurante La Palma | Columbus, OH | June 2017 - August 2020" },
  { kind: "header", es: "Cajero | Tienda Pueblo | Austin, TX | 2018 - 2021", en: "Cashier | Tienda Pueblo | Austin, TX | 2018 - 2021" },
  { kind: "header", es: "Jardinero por cuenta propia | Verde Servicios | Tampa, FL | 2015 - presente", en: "Self-employed Gardener | Verde Servicios | Tampa, FL | 2015 - Present" },
  { kind: "header", es: "Operador de montacargas | Almacén Norte | Dayton, OH | 03/2019 - 11/2021", en: "Forklift Operator | Almacén Norte | Dayton, OH | 03/2019 - 11/2021" },
  { kind: "header", es: "Ayudante de cocina en Café Rosa, Springfield, OH (2019 - 2021)", en: "Kitchen Helper at Café Rosa, Springfield, OH (2019 - 2021)" },
  // education and credentials
  { kind: "education", es: "Diploma de preparatoria | Lincoln High School, 2014", en: "High School Diploma | Lincoln High School, 2014" },
  { kind: "education", es: "Certificado de manejo de alimentos, 2022", en: "Food Handler Certificate, 2022" },
  { kind: "education", es: "Tarjeta de manipulador de alimentos, vigente hasta 2027", en: "Food handler card, valid through 2027" },
  { kind: "education", es: "Licencia de conducir de Ohio", en: "Ohio driver's license" },
  { kind: "education", es: "Curso de primeros auxilios, 2021", en: "First aid course, 2021" },
  { kind: "education", es: "Certificación de montacargas, 2020", en: "Forklift certification, 2020" },
  { kind: "credential", es: "Tarjeta de montacargas", en: "Forklift card" },
  // summary and skills and the missed-work sentences
  { kind: "summary", es: "Cocinera con experiencia en restaurantes y comida rápida", en: "Cook with experience in restaurants and fast food" },
  { kind: "summary", es: "Persona bilingüe con experiencia en atención al cliente", en: "Bilingual person with customer service experience" },
  { kind: "summary", es: "Busco un trabajo estable como ayudante de cocina", en: "Looking for a stable job as a kitchen helper" },
  { kind: "skills", es: "Cocina, caja, atención al cliente", en: "Cooking, cash register, customer service" },
  { kind: "skills", es: "Español e inglés", en: "Spanish and English" },
  { kind: "skills", es: "Manejo de montacargas | Servicio al cliente | Trabajo en equipo", en: "Forklift operation | Customer service | Teamwork" },
  { kind: "hook", es: "Cuidé a mi abuela durante tres años.", en: "Cared for my grandmother for three years." },
  { kind: "hook", es: "Ayudé a organizar eventos en mi iglesia.", en: "Helped organize events at my church." },
  { kind: "hook", es: "Arreglé carros con mi tío los fines de semana.", en: "Fixed cars with my uncle on weekends." },
];
