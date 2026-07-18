#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ACTIVITY_KIND_LABEL, hasStudentFile } from '@vega/shared';
import type { ActivityKind, AutonomyMode, PointsAllocation } from '@vega/shared';
import { aiConfigFromEnv, createAiProvider } from './ai/index.js';
import type { PageSource } from './ai/provider.js';
import { formatCents } from './cost/pricing.js';
import { gradeSubmission } from './grading/engine.js';
import type { GradeSubmissionResult } from './grading/engine.js';

/**
 * CLI de desarrollo. Sirve para corregir un examen sin levantar la API ni la
 * base de datos, que es como se validan los prompts antes de tocar producción.
 * Sin dependencias externas a propósito: `node:util.parseArgs` es suficiente y
 * una CLI de desarrollo no debería arrastrar un árbol de paquetes.
 */

const USAGE = `Vega · corrección asistida de actividades de matemáticas

Uso:
  vega-cli grade --actividad <slug> [--tipo entrega|foro] [opciones]

Opciones:
  --actividad <slug>   Actividad contra la que se corrige (obligatorio).
  --tipo <tipo>        entrega (por defecto) o foro. Un foro no lleva fichero:
                       no se transcribe nada y se corrige sobre el texto.
  --pdf <ruta>         Examen escaneado, sólo para --tipo entrega. Con el
                       proveedor mock no hace falta que exista: se avisa y se
                       continúa en modo simulado.
  --texto <ruta>       Intervención del alumno, sólo para --tipo foro. Si no se
                       indica, el proveedor mock se inventa una creíble.
  --provider <nombre>  mock (por defecto) o anthropic.
  --paginas <n>        Páginas a simular cuando no se lee el PDF (por defecto 3).
  --alumno <ref>       Referencia interna del alumno (por defecto "alumno-demo").
  --contextos <ruta>   Carpeta de contextos markdown (por defecto ./contexts).
  --json               Vuelca el resultado completo en JSON.
  --help               Muestra esta ayuda.

Ejemplos:
  pnpm --filter @vega/core cli grade --actividad tema04 --pdf examen.pdf
  pnpm --filter @vega/core cli grade --actividad foro-didactica --tipo foro
`;

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      actividad: { type: 'string' },
      tipo: { type: 'string' },
      pdf: { type: 'string' },
      texto: { type: 'string' },
      provider: { type: 'string' },
      paginas: { type: 'string' },
      alumno: { type: 'string' },
      contextos: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0];

  if (values.help === true || command === undefined || command === 'help') {
    process.stdout.write(USAGE);
    return values.help === true || command === 'help' ? 0 : 1;
  }

  if (command !== 'grade') {
    process.stderr.write(`Comando desconocido: "${command}".\n\n${USAGE}`);
    return 1;
  }

  const slug = values.actividad;
  if (slug === undefined || slug === '') {
    process.stderr.write(`Falta --actividad.\n\n${USAGE}`);
    return 1;
  }

  const kind = parseKind(values.tipo);
  if (kind === undefined) {
    process.stderr.write(`Tipo desconocido: "${values.tipo ?? ''}". Usa entrega o foro.\n\n${USAGE}`);
    return 1;
  }

  const activity = demoActivity(slug, kind);
  const needsFile = hasStudentFile(kind);

  const pdfPath = needsFile && values.pdf !== undefined ? resolve(values.pdf) : undefined;
  const pdfExists = pdfPath !== undefined && (await exists(pdfPath));

  const envConfig = aiConfigFromEnv();
  const providerName = values.provider ?? envConfig.provider ?? 'mock';

  // Un foro no trae fichero: exigir un PDF ahí no tendría sentido.
  if (needsFile && providerName === 'anthropic' && !pdfExists) {
    process.stderr.write(
      'Con --provider anthropic hace falta un PDF que exista: no hay nada que transcribir.\n',
    );
    return 1;
  }
  if (needsFile && !pdfExists) {
    process.stderr.write(
      `⚠ No se encuentra el PDF${pdfPath !== undefined ? ` (${pdfPath})` : ''}; se continúa en modo simulado.\n`,
    );
  }

  const textContent = needsFile
    ? null
    : values.texto !== undefined
      ? ((await readIfExists(resolve(values.texto))) ?? null)
      : null;

  const parsedPages = Number.parseInt(values.paginas ?? '3', 10);
  const studentRef = values.alumno ?? 'alumno-demo';

  const provider = createAiProvider({ ...envConfig, provider: providerName });
  const context = await loadContexts(values.contextos ?? 'contexts', slug, kind);

  const result = await gradeSubmission({
    provider,
    // Id estable a partir de la actividad y del fichero: dos ejecuciones
    // seguidas del mismo comando dan exactamente el mismo resultado con el mock.
    submissionId: stableUuid(`${slug}:${pdfPath ?? 'sin-pdf'}:${studentRef}`),
    studentRef,
    activityKind: kind,
    pages: needsFile
      ? await buildPages(pdfPath, pdfExists, Number.isFinite(parsedPages) ? parsedPages : 3)
      : [],
    textContent,
    context,
    pointsAllocation: activity.pointsAllocation,
    graded: activity.graded,
    maxScore: activity.maxScore,
    autonomy: activity.autonomy,
  });

  if (values.json === true) {
    // El LaTeX es largo y ensucia el volcado: se resume por longitud y el
    // documento entero se ve en la salida normal.
    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          correction: {
            ...result.correction,
            aiLatex: `(${result.correction.aiLatex.length} caracteres)`,
          },
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write(
    renderReport(result, {
      slug,
      kind,
      studentRef,
      providerName: provider.name,
      fileLabel: needsFile ? (pdfPath !== undefined ? basename(pdfPath) : '(ninguno)') : '(foro)',
      fileMissing: needsFile && !pdfExists,
    }),
  );
  return 0;
}

/** `--tipo entrega|foro`. En la CLI se escribe en español; el dominio, en inglés. */
function parseKind(value: string | undefined): ActivityKind | undefined {
  if (value === undefined || value === '') return 'assignment';
  const normalized = value.toLowerCase();
  if (normalized === 'entrega' || normalized === 'assignment') return 'assignment';
  if (normalized === 'foro' || normalized === 'forum') return 'forum';
  return undefined;
}

// ── Datos de apoyo ──────────────────────────────────────────────────────────

interface DemoActivity {
  readonly graded: boolean;
  readonly maxScore: number | null;
  readonly pointsAllocation: readonly PointsAllocation[];
  readonly autonomy: AutonomyMode;
}

/**
 * La CLI no habla con la base de datos, así que se inventa una actividad
 * plausible a partir del slug y del tipo. Cuando se corre contra `apps/api`,
 * esto lo sustituye la actividad real.
 *
 * Un foro se toma como no puntuable, que es el caso normal: sólo se publica
 * feedback cualitativo. Es también la forma de probar por CLI el camino sin
 * nota, con `items` vacío y `score` null.
 */
function demoActivity(slug: string, kind: ActivityKind): DemoActivity {
  if (kind === 'forum') {
    return { graded: false, maxScore: null, pointsAllocation: [], autonomy: 'review_all' };
  }
  return {
    graded: true,
    maxScore: 10,
    pointsAllocation: [
      { label: '1a', statement: 'Planteamiento y desarrollo', maxPoints: 2.5 },
      { label: '1b', statement: 'Resolución y simplificación', maxPoints: 2.5 },
      { label: '2a', statement: 'Método y justificación', maxPoints: 2.5 },
      { label: '2b', statement: 'Resultado e interpretación', maxPoints: 2.5 },
    ],
    // Con el slug de un simulacro se prueba además el aviso de autonomía: si la
    // confianza baja del umbral, Vega avisa de que eso no se publica solo.
    autonomy: slug.toLowerCase().includes('simulacro') ? 'review_low_confidence' : 'review_all',
  };
}

/**
 * Aún no partimos el PDF en páginas: cuando el fichero existe se manda entero
 * y, cuando no, se simulan `pageCount` páginas para que el mock tenga algo con
 * lo que trabajar.
 */
async function buildPages(
  pdfPath: string | undefined,
  pdfExists: boolean,
  pageCount: number,
): Promise<PageSource[]> {
  if (pdfPath !== undefined && pdfExists) {
    const bytes = await readFile(pdfPath);
    return [{ page: 1, mediaType: 'application/pdf', bytes }];
  }
  const total = Math.max(1, Math.min(pageCount, 20));
  return Array.from({ length: total }, (_unused, index) => ({
    page: index + 1,
    mediaType: 'application/pdf' as const,
    path: pdfPath ?? `simulado/pagina-${index + 1}.pdf`,
  }));
}

/**
 * Lee los tres niveles de contexto de `contexts/`, con la misma disposición que
 * usa la API para sembrar `grading_contexts` (ver `contexts/README.md`). Lo que
 * falte queda en blanco.
 *
 * Se admite todavía la disposición antigua (`task-types/`, `mailboxes/`) para
 * no obligar a renombrar la carpeta de contextos a la vez que se migra el
 * código; en cuanto `contexts/` se reordene, la segunda lectura sobra.
 */
async function loadContexts(
  root: string,
  slug: string,
  kind: ActivityKind,
): Promise<{ global: string; activityKind: string; activity: string }> {
  const [global, byKind, byActivity, legacyKind, legacyActivity] = await Promise.all([
    readIfExists(join(root, 'global.md')),
    readIfExists(join(root, 'activity-kinds', `${kind}.md`)),
    readIfExists(join(root, 'activities', `${slug}.md`)),
    readIfExists(join(root, 'task-types', `${kind}.md`)),
    readIfExists(join(root, 'mailboxes', `${slug}.md`)),
  ]);
  return {
    global: global ?? DEMO_GLOBAL_CONTEXT,
    activityKind: byKind ?? legacyKind ?? '',
    activity:
      byActivity ??
      legacyActivity ??
      `Actividad ${slug}. Sin solución de referencia cargada todavía.`,
  };
}

const DEMO_GLOBAL_CONTEXT = `Corriges exámenes de oposición de matemáticas.
Puntúa en cuartos de punto y justifica cada descuento.
Un método alternativo correcto vale lo mismo que el de la solución de referencia.`;

// ── Salida ──────────────────────────────────────────────────────────────────

interface ReportMeta {
  readonly slug: string;
  readonly kind: ActivityKind;
  readonly studentRef: string;
  readonly providerName: string;
  readonly fileLabel: string;
  readonly fileMissing: boolean;
}

function renderReport(result: GradeSubmissionResult, meta: ReportMeta): string {
  const lines: string[] = [];
  const { correction, transcription } = result;

  lines.push('');
  lines.push('Vega · corrección asistida');
  lines.push('─'.repeat(60));
  lines.push(`Actividad:  ${meta.slug} (${ACTIVITY_KIND_LABEL[meta.kind]})`);
  lines.push(`Alumno:     ${meta.studentRef}`);
  lines.push(
    `Fichero:    ${meta.fileLabel}${meta.fileMissing ? '  ⚠ no encontrado (modo simulado)' : ''}`,
  );
  lines.push(`Proveedor:  ${meta.providerName} · ${correction.model}`);
  lines.push('');

  // Un foro no pasa por OCR: no hay transcripción que enseñar.
  if (transcription === null) {
    lines.push('Transcripción — no procede: la actividad no lleva fichero del alumno.');
  } else {
    lines.push(`Transcripción — confianza ${percent(transcription.confidence)}`);
    for (const page of transcription.pages) {
      const pageFlags = transcription.flags.filter((flag) => flag.page === page.page);
      const suffix =
        pageFlags.length === 0 ? '✓' : `⚠ ${pageFlags.map((flag) => `[${flag.kind}]`).join(' ')}`;
      lines.push(`  Página ${page.page}  ${suffix}`);
    }
  }
  lines.push('');

  lines.push(
    result.score === null || correction.maxScore === null
      ? `Corrección — actividad no puntuable · confianza ${percent(correction.confidence)}`
      : `Corrección — nota propuesta ${decimal(result.score)} / ${decimal(correction.maxScore)}`,
  );
  for (const item of correction.items) {
    const alt = item.alternativeMethod ? '  ↺ método alternativo' : '';
    lines.push(
      `  ${item.label.padEnd(5)} ${decimal(item.aiPoints).padStart(5)} / ${decimal(item.maxPoints)}   confianza ${percent(item.confidence)}${alt}`,
    );
    lines.push(`        ${wrap(item.aiFeedback, 66, '        ')}`);
  }
  lines.push('');
  lines.push(`Resumen: ${wrap(correction.aiSummary, 66, '         ')}`);
  lines.push('');

  // El LaTeX es la salida que el profesor edita: se enseña entero, que es lo
  // que permite ver si el documento sale bien antes de tocar producción.
  lines.push(`Corrección en LaTeX (${integer(correction.aiLatex.length)} caracteres)`);
  lines.push('─'.repeat(60));
  lines.push(correction.aiLatex.trimEnd());
  lines.push('─'.repeat(60));
  lines.push('');

  if (result.review.length > 0) {
    lines.push('Avisos para el profesor');
    for (const flag of result.review) lines.push(`  • ${flag.detail}`);
    lines.push('');
  }

  const { usage } = result;
  lines.push(
    `Consumo: ${integer(usage.inputTokens)} tokens de entrada (${integer(usage.cachedInputTokens)} de caché) · ` +
      `${integer(usage.outputTokens)} de salida · coste estimado ${formatCents(usage.costCents)}`,
  );
  lines.push('');
  lines.push('Nada se publica en el LMS: esto es sólo una propuesta de corrección.');
  lines.push('');

  return lines.join('\n');
}

// ── Utilidades ──────────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * UUID v4 *con forma* válida derivado de un texto. No es aleatorio a propósito:
 * queremos que dos ejecuciones del mismo comando produzcan la misma entrega y,
 * con el mock, exactamente la misma corrección.
 */
function stableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function decimal(value: number): string {
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function integer(value: number): string {
  return value.toLocaleString('es-ES', { maximumFractionDigits: 0 });
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

/** Corta un texto largo en líneas para que la salida no se desborde. */
function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current !== '' && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current === '' ? word : `${current} ${word}`;
    }
  }
  if (current !== '') lines.push(current);
  return lines.join(`\n${indent}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
