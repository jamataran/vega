import { z } from 'zod';
import type { DiscoveredActivity } from '@vega/shared';
import type { LmsConnector, LmsConnectorFactory } from '@vega/connector-lms';
import type {
  ActivityRef,
  DownloadedFile,
  FeedbackFile,
  LmsConnectorConfig,
  RemoteGrade,
  RemoteSubmission,
  SubmissionRef,
} from '@vega/connector-lms';
import {
  GetAssignmentsResponse,
  GetForumsResponse,
  GetSubmissionsResponse,
  GetUserCoursesResponse,
  MoodleClient,
  WS_FUNCTIONS,
} from './api.js';
import type { MoodleSubmission } from './api.js';

/**
 * Conector para Moodle 3.x vía web services REST.
 *
 * ⚠️ SIN VERIFICAR CONTRA UN MOODLE REAL. Cada método lleva su `TODO(vega)`
 * con lo concreto que falta por comprobar. El conector por defecto en
 * desarrollo sigue siendo el mock (`LMS_CONNECTOR=mock`).
 */

export const Moodle3Config = z.object({
  /** `MOODLE_BASE_URL`, p. ej. https://moodle.ejemplo.es */
  baseUrl: z.string().url(),
  /** `MOODLE_TOKEN`: token de un usuario con permisos de corrección. */
  token: z.string().min(1),
  /** Curso al que pertenecen las actividades, si hay que listar tareas. */
  courseId: z.number().int().positive().optional(),
});
export type Moodle3Config = z.infer<typeof Moodle3Config>;

/** Área de ficheros donde Moodle guarda lo que sube el alumno. */
const SUBMISSION_FILE_AREA = 'submission_files';

export class Moodle3Connector implements LmsConnector {
  readonly name = 'moodle3';

  readonly #client: MoodleClient;
  readonly #courseId: number | undefined;
  /** Cache por sesión: `remoteId` → URL del fichero, para no re-listar al descargar. */
  readonly #fileUrls = new Map<string, string>();

  constructor(config: Moodle3Config) {
    this.#client = new MoodleClient({ baseUrl: config.baseUrl, token: config.token });
    this.#courseId = config.courseId;
  }

  /**
   * Tareas del curso, para que el profesor pueda emparejar una actividad de
   * Vega con un `assignment` de Moodle.
   *
   * TODO(vega): sin verificar contra Moodle real — falta comprobar que el token
   * de un profesor ve todos los cursos esperados y el formato de `duedate`.
   */
  async listAssignments(): Promise<GetAssignmentsResponse> {
    return this.#client.call(
      WS_FUNCTIONS.getAssignments,
      this.#courseId !== undefined ? { courseids: [this.#courseId] } : { courseids: [] },
      GetAssignmentsResponse,
    );
  }

  /**
   * Catálogo de actividades de Moodle a las que Vega puede reaccionar: las
   * entregas (`mod_assign`) y los foros (`mod_forum`) de los cursos visibles
   * para el token. Es lo que se le enseña al profesor para que elija.
   *
   * TODO(vega): sin verificar contra Moodle real — quedan por comprobar:
   *  - que `core_enrol_get_users_courses` necesita el `userid` del dueño del
   *    token (habría que sacarlo antes de `core_webservice_get_site_info`), y
   *    si con `courseId` configurado conviene saltarse esta llamada;
   *  - de dónde sale el recuento de pendientes de una entrega sin bajarse
   *    todas las entregas: `mod_assign_get_submissions` las trae enteras y en
   *    un curso grande eso es una petición muy cara sólo para contar;
   *  - que `numdiscussions` de un foro es el número de debates y NO el de
   *    mensajes, con lo que el recuento de un foro no es comparable al de una
   *    entrega y probablemente haya que ajustarlo con
   *    `mod_forum_get_forum_discussions_paginated`;
   *  - el nombre de curso que se enseña: aquí se usa `fullname`, pero en
   *    instalaciones con nombres muy largos puede convenir `shortname`.
   */
  async listActivities(): Promise<DiscoveredActivity[]> {
    const courses =
      this.#courseId !== undefined
        ? [{ id: this.#courseId, fullname: undefined, shortname: undefined }]
        : await this.#client.call(WS_FUNCTIONS.getUserCourses, {}, GetUserCoursesResponse);

    const courseIds = courses.map((course) => course.id);
    if (courseIds.length === 0) return [];

    const courseNames = new Map(
      courses.map((course) => [course.id, course.fullname ?? course.shortname ?? ''] as const),
    );

    const [assignments, forums] = await Promise.all([
      this.#client.call(
        WS_FUNCTIONS.getAssignments,
        { courseids: courseIds },
        GetAssignmentsResponse,
      ),
      this.#client.call(WS_FUNCTIONS.getForums, { courseids: courseIds }, GetForumsResponse),
    ]);

    const activities: DiscoveredActivity[] = [];

    for (const course of assignments.courses) {
      for (const assignment of course.assignments) {
        activities.push({
          moodleRef: String(assignment.id),
          name: assignment.name,
          kind: 'assignment',
          courseName: courseNames.get(course.id) ?? course.shortname ?? '',
          // TODO(vega): sin verificar contra Moodle real — de momento 0; ver
          // arriba por qué contar pendientes aquí saldría caro.
          pendingCount: 0,
          alreadyImported: false,
        });
      }
    }

    for (const forum of forums) {
      activities.push({
        moodleRef: String(forum.id),
        name: forum.name,
        kind: 'forum',
        courseName: courseNames.get(forum.course) ?? '',
        pendingCount: forum.numdiscussions ?? 0,
        alreadyImported: false,
      });
    }

    return activities;
  }

  /**
   * TODO(vega): sin verificar contra Moodle real — falta comprobar el filtro por
   * `status` (sólo queremos `submitted`), la paginación cuando hay muchos
   * alumnos, y si `plugins` llega siempre o hay que pedirlo aparte.
   */
  async listSubmissions(activityRef: ActivityRef): Promise<RemoteSubmission[]> {
    // TODO(vega): sin verificar contra Moodle real — falta el camino del foro:
    // `mod_forum_get_forum_discussions_paginated` más los posts de cada debate,
    // concatenados por alumno en `textContent`.
    if (activityRef.kind === 'forum') {
      throw new Error(
        `Todavía no se leen las intervenciones de un foro de Moodle 3 ("${activityRef.slug}"). ` +
          'Usa el conector mock o filesystem para probar el camino de foros.',
      );
    }

    const assignmentId = assignmentIdOf(activityRef);

    const response = await this.#client.call(
      WS_FUNCTIONS.getSubmissions,
      { assignmentids: [assignmentId], status: 'submitted' },
      GetSubmissionsResponse,
    );

    const submissions: RemoteSubmission[] = [];
    for (const assignment of response.assignments) {
      for (const submission of assignment.submissions) {
        const file = firstSubmissionFile(submission);
        if (file === undefined) continue;

        // Nunca pedimos el nombre del alumno: el id numérico de Moodle es
        // suficiente para publicar la nota y no identifica a nadie fuera de él.
        const studentRef = `moodle-${submission.userid}`;
        const remoteId = `${assignment.assignmentid}:${submission.userid}:${submission.attemptnumber}`;
        this.#fileUrls.set(remoteId, file.fileurl);

        submissions.push({
          ref: { activity: activityRef, studentRef, remoteId },
          filename: file.filename,
          submittedAt: new Date(submission.timemodified * 1000).toISOString(),
          sizeBytes: file.filesize ?? 0,
          mediaType: file.mimetype ?? 'application/pdf',
          textContent: null,
        });
      }
    }
    return submissions;
  }

  /**
   * TODO(vega): sin verificar contra Moodle real — la descarga por
   * `pluginfile.php` con `?token=` funciona en la documentación, pero hay que
   * comprobar el comportamiento con `forcedownload`, con ficheros grandes y con
   * instalaciones tras un proxy que reescribe URLs.
   */
  async download(ref: SubmissionRef): Promise<DownloadedFile> {
    const fileUrl = this.#fileUrls.get(ref.remoteId);
    if (fileUrl === undefined) {
      throw new Error(
        `No hay URL de descarga para ${ref.remoteId}. Llama antes a listSubmissions() sobre la misma actividad.`,
      );
    }
    const bytes = await this.#client.downloadFile(fileUrl);
    return {
      filename: `${ref.studentRef}.pdf`,
      mediaType: 'application/pdf',
      bytes,
    };
  }

  /**
   * TODO(vega): sin verificar contra Moodle real — falta comprobar el
   * `attemptnumber` correcto cuando el alumno ha reenviado, y si la escala de
   * la actividad coincide con la nota máxima de Moodle (una nota sobre 10 en
   * un assignment sobre 100 se publica mal sin reescalar).
   */
  async publishGrade(ref: SubmissionRef, grade: RemoteGrade): Promise<void> {
    const { assignmentId, userId, attempt } = parseRemoteId(ref.remoteId);

    await this.#client.call(
      WS_FUNCTIONS.saveGrade,
      {
        assignmentid: assignmentId,
        userid: userId,
        // Actividad no puntuable: -1 es como Moodle representa "sin nota", de
        // modo que se publique el feedback sin tocar la calificación.
        grade: grade.score ?? -1,
        attemptnumber: attempt,
        addattempt: 0,
        workflowstate: 'graded',
        applytoall: 0,
        plugindata: {
          assignfeedbackcomments_editor: {
            text: renderFeedbackHtml(grade),
            format: 1, // HTML
          },
        },
      },
      z.unknown(),
    );
  }

  /**
   * Publicar el PDF de corrección en `assignfeedback_file` es el punto de
   * riesgo conocido del proyecto: Moodle 3 no expone un web service para subir
   * ficheros a esa área directamente (haría falta `core_files_upload` más un
   * paso de asignación que la API no cubre limpiamente).
   *
   * TODO(vega): sin verificar contra Moodle real — hay que resolver el spike:
   * o se encuentra la combinación de servicios que funciona, o se aplica el
   * plan B (nota + feedback en HTML como comentario, PDF por otro canal).
   */
  publishFeedbackFile(_ref: SubmissionRef, _file: FeedbackFile): Promise<void> {
    return Promise.reject(
      new Error(
        'Publicar el fichero de feedback en Moodle 3 todavía no está resuelto (área assignfeedback_file). ' +
          'Publica la nota con publishGrade, que ya incluye el feedback en HTML, y adjunta el PDF por otro canal.',
      ),
    );
  }
}

export const createMoodle3Connector: LmsConnectorFactory = (config: LmsConnectorConfig) => {
  // El fallo más probable en producción es un token sin configurar; que el
  // mensaje lo diga en vez de reventar luego con un 401 de Moodle.
  if (config['token'] === undefined || config['token'] === '') {
    throw new Error(
      'Falta MOODLE_TOKEN. Configúralo en el entorno o usa LMS_CONNECTOR=mock / filesystem.',
    );
  }
  return new Moodle3Connector(Moodle3Config.parse(config));
};

// ── Utilidades ──────────────────────────────────────────────────────────────

function assignmentIdOf(activityRef: ActivityRef): number {
  const parsed = Number.parseInt(activityRef.lmsRef ?? '', 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `La actividad "${activityRef.slug}" no tiene asignada una tarea de Moodle (lmsRef vacío).`,
    );
  }
  return parsed;
}

function parseRemoteId(remoteId: string): {
  assignmentId: number;
  userId: number;
  attempt: number;
} {
  const [assignmentId, userId, attempt] = remoteId.split(':');
  const parsed = {
    assignmentId: Number.parseInt(assignmentId ?? '', 10),
    userId: Number.parseInt(userId ?? '', 10),
    attempt: Number.parseInt(attempt ?? '0', 10),
  };
  if (!Number.isFinite(parsed.assignmentId) || !Number.isFinite(parsed.userId)) {
    throw new Error(`Identificador de entrega de Moodle mal formado: "${remoteId}".`);
  }
  return parsed;
}

function firstSubmissionFile(submission: MoodleSubmission) {
  for (const plugin of submission.plugins ?? []) {
    for (const area of plugin.fileareas ?? []) {
      if (area.area !== SUBMISSION_FILE_AREA) continue;
      const file = (area.files ?? [])[0];
      if (file !== undefined) return file;
    }
  }
  return undefined;
}

/** Feedback en HTML, que es lo que entiende el editor de comentarios de Moodle. */
function renderFeedbackHtml(grade: RemoteGrade): string {
  const summary = `<p>${escapeHtml(grade.summary)}</p>`;
  const rows = grade.items
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.label)}</strong> — ${item.points} / ${item.maxPoints}: ${escapeHtml(item.feedback)}</li>`,
    )
    .join('');
  const list = rows === '' ? '' : `<ul>${rows}</ul>`;
  // En una actividad no puntuable no hay nota que enseñar: publicar "null / null"
  // al alumno sería peor que no publicar nada.
  const score =
    grade.score === null || grade.maxScore === null
      ? ''
      : `<p><em>Nota: ${grade.score} / ${grade.maxScore}</em></p>`;
  return `${summary}${list}${score}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
