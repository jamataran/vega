import { eq } from 'drizzle-orm';
import {
  effectivePoints,
  hasStudentFile,
  totalScore,
  type Activity,
  type Correction,
  type Submission,
  type Transcription,
} from '@vega/shared';
import type { LmsConnector, RemoteGrade, SubmissionRef } from '@vega/connector-lms';
import { schema } from '../db/client.js';
import { buildFeedbackPdf, feedbackFilename } from '../feedback/pdf.js';
import type { AppContext } from '../context.js';

/**
 * Publicación en el LMS: el último paso del circuito y el primero que toca a un
 * tercero.
 *
 * Está separado de la validación a propósito. Validar es una decisión humana que
 * no debe depender de que Moodle esté en pie; publicar es una operación de red
 * que falla, se reintenta y no debería volver a molestar al profesor (HU-17).
 *
 * **El problema de fondo es que son dos operaciones y no una.** `publishGrade`
 * puede terminar bien y `publishFeedbackFile` fallar: entonces la nota ya está
 * en Moodle y el alumno la ve, pero el fichero no llegó. Con una sola marca
 * `published_at` no había forma de saberlo, así que el reintento habría vuelto a
 * publicar la nota. Las dos marcas separadas (`grade_published_at`,
 * `feedback_file_published_at`) hacen el reintento idempotente: se reenvía sólo
 * lo que falta. Es la respuesta a la pregunta abierta 2 de HU-17.
 *
 * Y una tercera situación que no es un fallo: **hay conectores que no admiten el
 * fichero de feedback**. Moodle 3 es uno de ellos (`assignfeedback_file` no tiene
 * web service limpio). La nota se publica igual, la entrega llega a `published`,
 * y el motivo se guarda en `publish_notice` para poder decírselo al profesor sin
 * que parezca un error (HU-17, escenario 10).
 */

export interface PublishOutcome {
  readonly gradePublished: boolean;
  readonly filePublished: boolean;
  /** Publicación completa: es lo que permite pasar la entrega a `published`. */
  readonly complete: boolean;
  /** Explicación para el profesor cuando algo no ha ido del todo bien. */
  readonly notice: string | null;
}

export interface PublishInput {
  readonly submission: Submission;
  readonly activity: Activity;
  readonly correction: Correction;
  /** Marcas de lo ya publicado en un intento anterior. */
  readonly alreadyPublished: {
    readonly grade: boolean;
    readonly file: boolean;
  };
  /** Hace falta para reconstruir el original del alumno en el PDF de feedback. */
  readonly transcription: Transcription | null;
}

/**
 * Lo que se manda al LMS es lo **efectivo**, no lo que propuso la IA: los puntos
 * que el profesor dejó tras revisar (`teacherPoints ?? aiPoints`) y su feedback.
 * Lo que sustituyó no viaja a ninguna parte (HU-17, RN-2 y RN-3).
 */
export function toRemoteGrade(input: PublishInput): RemoteGrade {
  const { activity, correction } = input;
  const items = correction.items.map((item) => ({
    label: item.label,
    points: effectivePoints(item),
    maxPoints: item.maxPoints,
    feedback: item.teacherFeedback ?? item.aiFeedback,
  }));

  return {
    // Una actividad no puntuable no manda nota: `null` viaja hasta el conector,
    // que lo traduce a lo que su LMS entienda por «sin calificar».
    score: activity.graded ? totalScore(correction.items) : null,
    maxScore: activity.graded ? correction.maxScore : null,
    summary: correction.teacherSummary ?? correction.aiSummary,
    items: activity.graded ? items : [],
    validatedBy: correction.validatedBy,
    ...(correction.validatedAt === null ? {} : { validatedAt: correction.validatedAt }),
  };
}

/**
 * Publica lo que falte por publicar. No escribe en la base de datos: devuelve lo
 * conseguido para que quien llama lo persista en la misma transacción en la que
 * decide el estado de la entrega.
 *
 * Lanza sólo si **la nota** falla, porque entonces no hay nada publicado y la
 * entrega tiene que quedar en `error` para poder reintentarse. Que falle el
 * fichero no se lanza: es un éxito parcial y se cuenta como tal.
 */
export async function publishToLms(
  connector: LmsConnector,
  ref: SubmissionRef,
  input: PublishInput,
): Promise<PublishOutcome> {
  const grade = toRemoteGrade(input);

  let gradePublished = input.alreadyPublished.grade;
  if (!gradePublished) {
    await connector.publishGrade(ref, grade);
    gradePublished = true;
  }

  // En una actividad sin fichero del alumno no hay PDF de corrección que
  // adjuntar: todo el valor está en el feedback, que ya viaja con la nota.
  if (!hasFeedbackFile(input)) {
    return {
      gradePublished,
      filePublished: false,
      complete: true,
      notice: null,
    };
  }

  if (input.alreadyPublished.file) {
    return { gradePublished, filePublished: true, complete: true, notice: null };
  }

  try {
    const pdf = await buildFeedbackPdf({
      submission: input.submission,
      activity: input.activity,
      correction: input.correction,
      transcription: input.transcription,
    });

    await connector.publishFeedbackFile(ref, {
      filename: feedbackFilename({ submission: input.submission, activity: input.activity }),
      mediaType: 'application/pdf',
      content: pdf,
    });

    return { gradePublished, filePublished: true, complete: true, notice: null };
  } catch (error) {
    // La nota ya está puesta y el alumno la ve. Dejar la entrega en `error`
    // sería mentir en la otra dirección: lo que hay es una publicación
    // incompleta, y el profesor necesita saber exactamente qué falta.
    return {
      gradePublished,
      filePublished: false,
      complete: true,
      notice:
        `La nota y el feedback se han publicado, pero el PDF de corrección no: ` +
        `${(error as Error).message}`,
    };
  }
}

/**
 * Un foro no produce PDF de corrección: no hay original del alumno que
 * anteponer, y todo lo que el profesor validó viaja ya con el feedback.
 */
function hasFeedbackFile(input: PublishInput): boolean {
  return hasStudentFile(input.activity.kind);
}

/**
 * Deja constancia de lo publicado. Se llama tras un intento, haya ido como haya
 * ido.
 *
 * Las marcas previas **no se pisan**: si la nota se publicó anoche y hoy sólo se
 * ha reintentado el fichero, la fecha de la nota tiene que seguir siendo la de
 * anoche. Es el rastro que permite explicar qué vio el alumno y cuándo.
 */
export async function recordPublication(
  ctx: AppContext,
  correction: { id: string; gradePublishedAt: Date | null; feedbackFilePublishedAt: Date | null },
  submissionId: string,
  outcome: PublishOutcome,
): Promise<void> {
  const now = new Date();
  const gradeAt = outcome.gradePublished ? (correction.gradePublishedAt ?? now) : null;
  const fileAt = outcome.filePublished ? (correction.feedbackFilePublishedAt ?? now) : null;

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(schema.corrections)
      .set({
        gradePublishedAt: gradeAt,
        feedbackFilePublishedAt: fileAt,
        publishedAt: outcome.complete ? now : null,
        publishedAutomatically: false,
        publishNotice: outcome.notice,
      })
      .where(eq(schema.corrections.id, correction.id));

    if (outcome.complete) {
      await tx
        .update(schema.submissions)
        .set({ status: 'published', errorMessage: null, updatedAt: now })
        .where(eq(schema.submissions.id, submissionId));
    }
  });
}
