import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema } from '../db/client.js';
import { notFound } from '../http/errors.js';
import type { AppContext } from '../context.js';

/**
 * Páginas escaneadas simuladas.
 *
 * Mientras no haya un LMS de verdad detrás, la UI necesita *algo* que enseñar
 * en la pestaña "Original". Generamos un SVG con pinta de folio cuadriculado
 * escaneado para poder ajustar el zoom, el paginador y la vista comparada sin
 * depender de ficheros binarios en el repositorio.
 */

const WIDTH = 1240; // A4 a 150 ppp
const HEIGHT = 1754;

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) =>
    char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : char === "'" ? '&apos;' : '&quot;',
  );
}

function renderScan(options: {
  studentRef: string;
  activityName: string;
  page: number;
  pageCount: number;
  lines: string[];
}): string {
  const { studentRef, activityName, page, pageCount, lines } = options;

  const handwriting = lines
    .map((line, index) => {
      // Pequeña inclinación por renglón para que no parezca texto tecleado.
      const y = 300 + index * 78;
      const tilt = ((index % 5) - 2) * 0.35;
      return `<text x="120" y="${y}" class="hand" transform="rotate(${tilt} 120 ${y})">${escapeXml(line)}</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Escaneo simulado, página ${page}">
  <defs>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#c8d4e0" stroke-width="1"/>
    </pattern>
    <style>
      .hand { font-family: 'Segoe Script','Bradley Hand','Comic Sans MS',cursive; font-size: 34px; fill: #1c2a3a; }
      .meta { font-family: ui-monospace,'SF Mono',Menlo,monospace; font-size: 22px; fill: #64748b; }
      .stamp { font-family: ui-sans-serif,system-ui,sans-serif; font-size: 20px; fill: #94a3b8; letter-spacing: 3px; }
    </style>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fdfdf8"/>
  <rect x="60" y="60" width="${WIDTH - 120}" height="${HEIGHT - 120}" fill="url(#grid)" opacity="0.55"/>
  <line x1="150" y1="60" x2="150" y2="${HEIGHT - 60}" stroke="#e5a1a1" stroke-width="2" opacity="0.6"/>

  <text x="120" y="150" class="meta">${escapeXml(activityName)}</text>
  <text x="120" y="190" class="meta">Alumno: ${escapeXml(studentRef)}</text>
  <text x="${WIDTH - 120}" y="150" class="meta" text-anchor="end">Página ${page} de ${pageCount}</text>

  <line x1="120" y1="220" x2="${WIDTH - 120}" y2="220" stroke="#94a3b8" stroke-width="1.5"/>

    ${handwriting}

  <text x="${WIDTH / 2}" y="${HEIGHT - 90}" class="stamp" text-anchor="middle">ESCANEO SIMULADO · VEGA EN MODO MOCK</text>
</svg>`;
}

/** Renglones de relleno con aspecto de desarrollo matemático manuscrito. */
const SAMPLE_LINES: string[][] = [
  [
    'a) f(x) = (3x² − 5x) / (x + 2)',
    '',
    "   f'(x) = [(6x − 5)(x+2) − (3x² − 5x)·1] / (x+2)²",
    '',
    '        = (6x² + 12x − 5x − 10 − 3x² + 5x) / (x+2)²',
    '',
    '        = (3x² + 12x − 10) / (x+2)²',
    '',
    'b) Puntos críticos:  3x² + 12x − 10 = 0',
    '',
    '   x = (−12 ± √(144 + 120)) / 6',
    '',
    '   x = (−12 ± √264) / 6   ≈  0,708  y  −4,708',
  ],
  [
    'c) Estudio del signo de f\'(x):',
    '',
    '   (x+2)² > 0 siempre  ⟹  el signo lo da el numerador',
    '',
    '   f creciente en (−∞, −4,708) ∪ (0,708, +∞)',
    '   f decreciente en (−4,708, −2) ∪ (−2, 0,708)',
    '',
    'd) Asíntota vertical en x = −2',
    '',
    '   lim(x→−2⁻) f(x) = −∞      lim(x→−2⁺) f(x) = +∞',
    '',
    '   Asíntota oblicua:  y = 3x − 11',
  ],
  [
    'e) Representación gráfica:',
    '',
    '   (esquema del alumno)',
    '',
    '   Corta al eje X en x = 0 y x = 5/3',
    '',
    '   f(0) = 0',
    '',
    'Conclusión: la función presenta un mínimo relativo',
    'en x ≈ 0,708 y un máximo relativo en x ≈ −4,708.',
  ],
];

export async function scanRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: { id: string; page: string } }>('/api/scans/:id/:page.svg', async (request, reply) => {
    const page = Number.parseInt(request.params.page, 10);
    if (!Number.isFinite(page) || page < 1) throw notFound('Página no válida.');

    const [submission] = await ctx.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, request.params.id))
      .limit(1);
    if (!submission) throw notFound('No existe esa entrega.');
    if (page > submission.pageCount) throw notFound('Esa página no existe en la entrega.');

    const [activity] = await ctx.db
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.id, submission.activityId))
      .limit(1);

    const svg = renderScan({
      studentRef: submission.studentAlias ?? submission.studentRef,
      activityName: activity?.name ?? 'Actividad',
      page,
      pageCount: submission.pageCount,
      lines: SAMPLE_LINES[(page - 1) % SAMPLE_LINES.length] ?? [],
    });

    void reply
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'private, max-age=3600');
    return svg;
  });
}
