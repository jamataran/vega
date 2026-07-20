import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { hasStudentFile, type ActivityKind, type TranscriptionPage } from '@vega/shared';
import '../env.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createDb, schema } from './client.js';
import {
  ACTIVITIES,
  AI_LATEX,
  AI_SUMMARY,
  CORRECTION_ITEMS,
  COURSE_MOODLE_IDS,
  FORUM_POSTS,
  SEED_ENUNCIADO_TEMA04,
  SEED_MATERIAL_FORO,
  STUDENTS,
  SUBMISSION_PLAN,
  TRANSCRIPTION_FLAGS,
  TRANSCRIPTION_PAGES,
} from './seed-data.js';

/**
 * Siembra la base de datos con un escenario de trabajo completo.
 *
 * Borra y reinserta: está pensado para desarrollo, no para producción. La
 * variación entre entregas es determinista (PRNG con semilla) para que dos
 * ejecuciones den exactamente lo mismo y podamos comparar capturas de la UI.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const DEMO_PASSWORD = 'vega1234';

/** PRNG mulberry32: pequeño, rápido y reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Redondeo al cuarto de punto, que es como puntúa el departamento. */
const toQuarter = (value: number): number => Math.round(value * 4) / 4;

/**
 * Lee un contexto de `contexts/`, probando varias rutas en orden. Si ninguna
 * existe, usa el texto de reserva.
 *
 * Hay varios candidatos porque los ficheros del repositorio siguen la
 * nomenclatura vieja (`task-types/`, `mailboxes/`) y el modelo ya usa la nueva
 * (`activity_kind`, `activity`). Se prueba primero la ruta nueva, de modo que
 * en cuanto alguien renombre los directorios esto empiece a leer de ahí sin
 * tocar código.
 */
async function readContext(candidates: readonly string[], fallback: string): Promise<string> {
  for (const relativePath of candidates) {
    try {
      return await readFile(join(REPO_ROOT, 'contexts', relativePath), 'utf8');
    } catch {
      // Siguiente candidato.
    }
  }
  return fallback;
}

/** Ficheros de contexto por tipo de actividad, nueva ruta y reserva histórica. */
function contextFilesForKind(kind: ActivityKind): string[] {
  return kind === 'assignment'
    ? // Los dos simulacros colapsaron en 'assignment' con la migración 0002; el
      // de problema es el que mejor describe una entrega con fichero.
      [`activity-kinds/assignment.md`, `task-types/simulacro_problema.md`]
    : [`activity-kinds/forum.md`];
}

const FALLBACK_KIND_CONTEXT: Record<ActivityKind, string> = {
  assignment: `# Entrega con fichero

Aplica sobre las instrucciones globales. El alumno entrega un documento escrito
que pasa por transcripción antes de corregirse.

- Corrige **lo que está en el papel**. Si el OCR ha dejado marcas [ILEGIBLE] o
  [DUDA], no supongas el contenido: señálalo y deja que lo decida el profesor.
- Puntúa apartado por apartado siguiendo el reparto de puntos de la actividad.
- Distingue error de cálculo de error de método: el segundo pesa más.`,
  forum: `# Foro

Aplica sobre las instrucciones globales. Aquí no hay fichero ni transcripción:
se corrige el texto que el alumno ha escrito.

- **Normalmente no se puntúa.** El resultado es feedback cualitativo, no nota.
- Valora la calidad del argumento, no la extensión.
- Valora que responda a los compañeros: un foro es una conversación.
- No corrijas la ortografía como si fuera un examen.`,
};

async function main(): Promise<void> {
  const config = loadConfig();
  const { sql, db } = createDb(config.DATABASE_URL, { max: 1 });

  try {
    console.log('→ limpiando datos anteriores…');
    // CASCADE se encarga de correcciones, apartados, transcripciones y ficheros.
    await sql`
      TRUNCATE submissions, activities, activity_files, courses, grading_contexts,
               batch_runs, app_settings, users
      RESTART IDENTITY CASCADE
    `;

    // ── Usuarios ──────────────────────────────────────────────────────────
    console.log('→ creando usuarios…');
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    // Si hay un token de Moodle en el entorno, se lo damos a los dos usuarios
    // de ejemplo. Es puro arranque en frío para desarrollo: sin esto, probar
    // contra un Moodle real obliga a pegar el token a mano tras cada `db:seed`.
    const moodleToken = config.MOODLE_TOKEN ?? null;
    const [admin, teacher] = await db
      .insert(schema.users)
      .values([
        {
          email: 'admin@vega.test',
          name: 'Administración',
          role: 'admin' as const,
          passwordHash,
          moodleToken,
          moodleTokenUpdatedAt: moodleToken === null ? null : new Date(),
        },
        {
          email: 'profe@vega.test',
          name: 'Marta Ruiz',
          role: 'teacher' as const,
          passwordHash,
          moodleToken,
          moodleTokenUpdatedAt: moodleToken === null ? null : new Date(),
        },
      ])
      .returning();
    if (!admin || !teacher) throw new Error('No se han podido crear los usuarios de ejemplo.');

    // ── Cursos ────────────────────────────────────────────────────────────
    console.log('→ creando cursos…');
    const courseRows = await db
      .insert(schema.courses)
      .values(
        Object.entries(COURSE_MOODLE_IDS).map(([name, moodleCourseId]) => ({
          moodleCourseId,
          name,
        })),
      )
      .returning();
    const courseByName = new Map(courseRows.map((row) => [row.name, row]));

    // ── Actividades ───────────────────────────────────────────────────────
    console.log('→ creando actividades…');
    const activityRows = await db
      .insert(schema.activities)
      .values(
        ACTIVITIES.map((activity) => ({
          slug: activity.slug,
          name: activity.name,
          kind: activity.kind,
          courseId: courseByName.get(activity.courseName)?.id ?? null,
          courseName: activity.courseName,
          moodleRef: activity.moodleRef,
          // Las sembradas las "importó" la profesora: es su token el que
          // usaría el lote para bajar sus entregas.
          importedBy: teacher.id,
          enabled: activity.enabled,
          graded: activity.graded,
          // `null` en las no puntuables: lo exige el CHECK y lo pide el dominio.
          maxScore: activity.maxScore === null ? null : String(activity.maxScore),
          referenceSolution: activity.referenceSolution,
          pointsAllocation: activity.pointsAllocation,
          autonomy: activity.autonomy,
        })),
      )
      .returning();
    const activityBySlug = new Map(activityRows.map((row) => [row.slug, row]));

    // ── Ficheros de contexto ──────────────────────────────────────────────
    // LaTeX y no PDF: es el caso real del producto. El `.tex` ya es texto, entra
    // literal en el prompt y se cachea; un PDF habría que transcribirlo en cada
    // corrección. Sembramos también un binario para que se vea qué pasa con lo
    // que Vega **no** puede leer.
    console.log('→ registrando ficheros de contexto…');
    const tema04 = activityBySlug.get('tema04');
    const foroDudas = activityBySlug.get('foro-dudas-analisis');
    const withContent = (
      activityId: string,
      filename: string,
      mimeType: string,
      content: string,
    ) => ({
      activityId,
      filename,
      mimeType,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    });

    if (tema04) {
      await db
        .insert(schema.activityFiles)
        .values([
          withContent(
            tema04.id,
            'enunciado-tema04.tex',
            'application/x-tex',
            SEED_ENUNCIADO_TEMA04,
          ),
          {
            activityId: tema04.id,
            filename: 'criterios-departamento.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 96_112,
            // Binario: se guarda como referencia del profesor, pero su
            // contenido no llega al modelo y la ficha lo dice.
            content: null,
          },
        ]);
    }
    if (foroDudas) {
      await db
        .insert(schema.activityFiles)
        .values([
          withContent(
            foroDudas.id,
            'material-analisis.tex',
            'application/x-tex',
            SEED_MATERIAL_FORO,
          ),
        ]);
    }

    // ── Contextos de corrección ───────────────────────────────────────────
    console.log('→ creando contextos de corrección…');
    const contextValues: (typeof schema.gradingContexts.$inferInsert)[] = [
      {
        level: 'global',
        key: 'global',
        content: await readContext(
          ['global.md'],
          '# Instrucciones globales\n\nCorrige con criterio de tribunal de oposición: exige justificación, admite métodos alternativos y usa la coma como separador decimal.',
        ),
        updatedBy: admin.id,
      },
    ];

    // Nivel intermedio: el tipo de actividad. Lo que vale para una entrega no
    // vale para un foro.
    for (const kind of ['assignment', 'forum'] as const) {
      contextValues.push({
        level: 'activity_kind',
        key: kind,
        content: await readContext(contextFilesForKind(kind), FALLBACK_KIND_CONTEXT[kind]),
        updatedBy: admin.id,
      });
    }

    for (const activity of ACTIVITIES) {
      contextValues.push({
        level: 'activity',
        key: activity.slug,
        content: await readContext(
          [`activities/${activity.slug}.md`, `mailboxes/${activity.slug}.md`],
          activity.gradingNotes,
        ),
        updatedBy: teacher.id,
      });
    }
    await db.insert(schema.gradingContexts).values(contextValues);

    // ── Ajustes ───────────────────────────────────────────────────────────
    // El planificador arranca desactivado: en desarrollo no queremos que se
    // ponga a corregir solo mientras se prueba la UI.
    await db.insert(schema.appSettings).values([
      { key: 'schedule.enabled', value: 'false', updatedBy: admin.id },
      { key: 'schedule.everyMinutes', value: '60', updatedBy: admin.id },
      { key: 'branding.name', value: 'Vega', updatedBy: admin.id },
      // Si el entorno apunta a un Moodle de verdad, sembramos ese y su conector:
      // así `pnpm db:seed` deja la instalación lista para probar contra él sin
      // pasar por Ajustes. Sin entorno, queda el Moodle ficticio y el conector
      // simulado, que es lo que hace falta para una demo.
      {
        key: 'moodle.baseUrl',
        value: config.MOODLE_BASE_URL ?? 'https://campus.academiahipatia.test',
        updatedBy: admin.id,
      },
      { key: 'moodle.connector', value: config.LMS_CONNECTOR, updatedBy: admin.id },
    ]);

    // ── Entregas ──────────────────────────────────────────────────────────
    console.log('→ creando entregas, transcripciones y correcciones…');
    const now = Date.now();
    let created = 0;
    let studentCursor = 0;
    let hourCursor = 0;

    for (const activitySeed of ACTIVITIES) {
      const activity = activityBySlug.get(activitySeed.slug);
      if (!activity) continue;

      const plan = SUBMISSION_PLAN[activitySeed.slug] ?? [];
      const withFile = hasStudentFile(activitySeed.kind);
      const forumPosts = FORUM_POSTS[activitySeed.slug] ?? [];
      const pages = TRANSCRIPTION_PAGES[activitySeed.slug] ?? [];

      for (const [index, entry] of plan.entries()) {
        const random = seededRandom(hourCursor * 7919 + 13);

        // En los foros el alumno es el que escribió el mensaje; en las entregas
        // se van repartiendo del banco de alias.
        const post = withFile ? undefined : forumPosts[index % Math.max(forumPosts.length, 1)];
        const student = post
          ? (STUDENTS.find((candidate) => candidate.ref === post.studentRef) ??
            STUDENTS[studentCursor % STUDENTS.length]!)
          : STUDENTS[studentCursor % STUDENTS.length]!;
        studentCursor += 1;

        // Repartimos las entregas por las últimas dos semanas, las más recientes
        // primero.
        hourCursor += 1;
        const submittedAt = new Date(
          now - (hourCursor * 9 + Math.floor(random() * 6)) * 3_600_000,
        );

        const [submission] = await db
          .insert(schema.submissions)
          .values({
            activityId: activity.id,
            studentRef: student.ref,
            studentAlias: student.alias,
            status: entry.status,
            // Un foro no trae fichero: ni nombre, ni páginas, sólo texto.
            originalFilename: withFile ? `${activitySeed.slug}_${student.ref}.pdf` : null,
            pageCount: withFile ? pages.length : 0,
            textContent: withFile ? null : (post?.text ?? null),
            errorMessage:
              entry.status === 'error'
                ? 'El PDF descargado de Moodle está protegido con contraseña y no se ha podido abrir.'
                : null,
            submittedAt,
            updatedAt: submittedAt,
          })
          .returning();
        if (!submission) continue;
        created += 1;

        // Sólo las actividades con fichero pasan por transcripción.
        const hasTranscription =
          withFile &&
          ['transcribed', 'grading', 'graded', 'validated', 'published'].includes(entry.status);

        if (hasTranscription) {
          const transcriptionPages: TranscriptionPage[] = pages.map((latex, page) => ({
            page: page + 1,
            latex,
            imageUrl: `/api/scans/${submission.id}/${page + 1}.svg`,
          }));

          await db.insert(schema.transcriptions).values({
            submissionId: submission.id,
            pages: transcriptionPages,
            flags: TRANSCRIPTION_FLAGS[activitySeed.slug] ?? [],
            confidence: (0.82 + random() * 0.16).toFixed(3),
            model: 'mock-vision-1',
            createdAt: submittedAt,
          });
        }

        const hasCorrection = ['graded', 'validated', 'published'].includes(entry.status);
        if (!hasCorrection) continue;

        const inputTokens = 8_000 + Math.floor(random() * 4_000);
        const outputTokens = 900 + Math.floor(random() * 600);
        const cachedInputTokens = Math.floor(inputTokens * 0.6);

        const isReviewed = entry.status === 'validated' || entry.status === 'published';
        const autoPublished = entry.autoPublished === true;
        const validatedAt = new Date(submittedAt.getTime() + 3_600_000 * 5);
        const publishedAt =
          entry.status === 'published' ? new Date(validatedAt.getTime() + 1_800_000) : null;

        const [correction] = await db
          .insert(schema.corrections)
          .values({
            submissionId: submission.id,
            // `null` en las no puntuables: no hay nota que enseñar.
            maxScore: activitySeed.maxScore === null ? null : String(activitySeed.maxScore),
            aiLatex: AI_LATEX[activitySeed.slug] ?? '',
            teacherLatex: null,
            aiSummary: AI_SUMMARY[activitySeed.slug] ?? '',
            teacherSummary: null,
            confidence: (0.74 + random() * 0.2).toFixed(3),
            model: 'mock-grader-1',
            inputTokens,
            outputTokens,
            cachedInputTokens,
            // Céntimos de euro; el orden de magnitud es el que esperamos por corrección.
            costCents: (2.4 + random() * 2.2).toFixed(4),
            annotatedFileUrl: withFile ? `/api/submissions/${submission.id}/feedback.pdf` : null,
            publishedAutomatically: autoPublished,
            // Publicada sola ⇒ nadie la validó: `validatedBy` y `validatedAt`
            // se quedan a null y es `publishedAutomatically` quien lo explica.
            validatedBy: autoPublished ? null : isReviewed ? teacher.id : null,
            validatedAt: autoPublished ? null : isReviewed ? validatedAt : null,
            publishedAt,
            createdAt: submittedAt,
          })
          .returning();
        if (!correction) continue;

        // Los apartados sólo existen si la actividad se puntúa. En un foro la
        // corrección es únicamente el documento.
        if (!activitySeed.graded) continue;

        const templates = CORRECTION_ITEMS[activitySeed.slug] ?? [];
        // El profesor sólo retoca lo que ha revisado de verdad, y ni siquiera
        // siempre: hay correcciones que valida tal cual porque está de acuerdo.
        // Esas son las que cuentan en `untouchedRatio`.
        const teacherReviewed = isReviewed && !autoPublished && entry.untouched !== true;

        await db.insert(schema.correctionItems).values(
          templates.map((template, position) => {
            // Cada alumno puntúa algo distinto, pero siempre dentro del máximo.
            const drift = (random() - 0.5) * 0.8;
            const aiPoints = Math.min(
              template.maxPoints,
              Math.max(0, toQuarter(template.aiPoints + drift)),
            );

            // En las ya revisadas, el profesor retoca los apartados de baja
            // confianza: es lo que alimenta la desviación y el `untouchedRatio`.
            const teacherTouches = teacherReviewed && template.confidence < 0.75;
            const teacherPoints = teacherTouches
              ? Math.min(template.maxPoints, toQuarter(aiPoints + 0.5))
              : null;

            return {
              correctionId: correction.id,
              label: template.label,
              statement: template.statement,
              maxPoints: String(template.maxPoints),
              aiPoints: String(aiPoints),
              aiFeedback: template.aiFeedback,
              teacherPoints: teacherPoints === null ? null : String(teacherPoints),
              teacherFeedback: teacherTouches
                ? 'Revisado sobre el original: el desarrollo sí era correcto, subo la puntuación.'
                : null,
              confidence: template.confidence.toFixed(3),
              alternativeMethod: template.alternativeMethod,
              position,
            };
          }),
        );

        if (teacherReviewed) {
          await db
            .update(schema.corrections)
            .set({
              teacherSummary:
                'Revisado. Coincido en lo esencial con la propuesta; he ajustado el apartado que quedaba en duda tras mirar el escaneo original.',
            })
            .where(eq(schema.corrections.id, correction.id));
        }
      }
    }

    // ── Último lote ───────────────────────────────────────────────────────
    const startedAt = new Date(now - 9 * 3_600_000);
    await db.insert(schema.batchRuns).values({
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 22 * 60_000),
      status: 'done',
      // Lo lanzó el planificador, no una persona.
      triggeredBy: null,
      submissionsProcessed: 11,
      submissionsFailed: 1,
      submissionsAutoPublished: 3,
      inputTokens: 96_400,
      outputTokens: 12_800,
      cachedInputTokens: 58_000,
      costCents: '38.6400',
    });

    const forums = ACTIVITIES.filter((activity) => !activity.graded).length;
    console.log('');
    console.log(
      `✔ Sembrado completo: ${created} entregas en ${activityRows.length} actividades ` +
        `(${activityRows.length - forums} puntuables, ${forums} foros sin nota).`,
    );
    console.log('');
    console.log('  Credenciales de acceso:');
    console.log(`    profesor       profe@vega.test  /  ${DEMO_PASSWORD}`);
    console.log(`    administrador  admin@vega.test  /  ${DEMO_PASSWORD}`);
    console.log('');
  } finally {
    await sql.end();
  }
}

await main();
