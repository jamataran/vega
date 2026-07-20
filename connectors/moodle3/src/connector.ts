import { z } from 'zod';
import type { ActivityKind, DiscoveredActivity, DiscoveredCourse } from '@vega/shared';
import type { LmsConnector, LmsConnectorFactory } from '@vega/connector-lms';
import { LmsAuthError } from '@vega/connector-lms';
import type {
  ActivityRef,
  DownloadedFile,
  FeedbackFile,
  LmsConnectionInfo,
  LmsConnectorConfig,
  RemoteGrade,
  RemoteSubmission,
  SubmissionRef,
} from '@vega/connector-lms';
import {
  GetAssignmentsResponse,
  GetForumsResponse,
  GetSiteInfoResponse,
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
});
export type Moodle3Config = z.infer<typeof Moodle3Config>;
// `courseId` se ha eliminado de la configuración: el curso lo elige el profesor
// en cada consulta (`listActivities(moodleCourseId)`), no el operador en el
// entorno. Fijarlo en un despliegue con varios cursos escondería el resto del
// catálogo sin decirlo, y contradiría a `listCourses()`, que existe justo para
// enseñarlos todos. Tampoco llegaba a usarse: ni `.env.example` ni los compose
// de `deploy/` ni `apps/api/src/config.ts` lo poblaban nunca.

/** Área de ficheros donde Moodle guarda lo que sube el alumno. */
const SUBMISSION_FILE_AREA = 'submission_files';

/** Las entregas antes que los foros: es el orden en que el profesor los busca. */
const KIND_ORDER: Readonly<Record<ActivityKind, number>> = { assignment: 0, forum: 1 };

export class Moodle3Connector implements LmsConnector {
  readonly name = 'moodle3';

  readonly #client: MoodleClient;
  /** Cache por sesión: `remoteId` → URL del fichero, para no re-listar al descargar. */
  readonly #fileUrls = new Map<string, string>();
  #siteInfo: Promise<GetSiteInfoResponse> | undefined;

  constructor(config: Moodle3Config) {
    this.#client = new MoodleClient({ baseUrl: config.baseUrl, token: config.token });
  }

  /**
   * Tareas en crudo, tal y como las devuelve Moodle. No la usa el flujo normal
   * —para eso está `listActivities()`—, pero es lo más útil que hay para
   * depurar una instalación concreta sin montar la aplicación entera.
   *
   * TODO(vega): sin verificar contra Moodle real — falta comprobar que el token
   * de un profesor ve todos los cursos esperados y el formato de `duedate`.
   */
  async listAssignments(moodleCourseId?: string): Promise<GetAssignmentsResponse> {
    const courseIds = moodleCourseId === undefined ? [] : [parseCourseId(moodleCourseId)];
    return this.#client.call(
      WS_FUNCTIONS.getAssignments,
      { courseids: courseIds },
      GetAssignmentsResponse,
    );
  }

  /**
   * Cursos en los que está matriculado el dueño del token.
   *
   * TODO(vega): sin verificar contra Moodle real — falta comprobar que un
   * profesor ve aquí los cursos que imparte (y no sólo aquellos en los que
   * figura como alumno) y qué pasa con los cursos ocultos o ya archivados.
   */
  async listCourses(): Promise<DiscoveredCourse[]> {
    const { userid } = await this.#requireSiteInfo();

    const courses = await this.#client.call(
      WS_FUNCTIONS.getUserCourses,
      { userid },
      GetUserCoursesResponse,
    );

    return courses
      .map((course) => ({
        moodleCourseId: String(course.id),
        name: course.fullname ?? course.shortname ?? '',
        shortName: course.shortname ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  /**
   * Prueba de vida de la credencial. `core_webservice_get_site_info` es la
   * llamada más barata del web service y no lleva parámetros, así que si falla
   * el problema es el token o el sitio, nunca lo que se ha pedido.
   */
  async verifyConnection(): Promise<LmsConnectionInfo> {
    const [siteInfo, courses] = await Promise.all([this.#requireSiteInfo(), this.listCourses()]);
    return {
      siteName: siteInfo.sitename,
      username: siteInfo.username,
      courseCount: courses.length,
    };
  }

  /**
   * Los datos del token: quién es y contra qué sitio habla. Se resuelven una
   * sola vez por instancia porque el token no cambia durante su vida; si la
   * llamada falla no se cachea el fallo, para que reintentar tras arreglar el
   * token en Ajustes no exija reiniciar el proceso.
   */
  async #requireSiteInfo(): Promise<GetSiteInfoResponse> {
    this.#siteInfo ??= this.#client
      .call(WS_FUNCTIONS.getSiteInfo, {}, GetSiteInfoResponse)
      .catch((error: unknown) => {
        this.#siteInfo = undefined;
        throw error;
      });
    return this.#siteInfo;
  }

  /**
   * Catálogo de actividades de Moodle a las que Vega puede reaccionar: las
   * entregas (`mod_assign`) y los foros (`mod_forum`). Es lo que se le enseña
   * al profesor para que elija.
   *
   * Con `moodleCourseId` se pregunta por ese curso y sólo por ese: en una
   * instalación con decenas de cursos, pedir las actividades de todos para
   * enseñar las de uno es la diferencia entre una pantalla que abre y otra que
   * caduca. El catálogo de cursos se pide en paralelo y sólo sirve para poner
   * nombre al curso, porque `mod_forum_get_forums_by_courses` devuelve el id
   * del curso pero no su nombre.
   *
   * TODO(vega): sin verificar contra Moodle real — quedan por comprobar:
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
  async listActivities(moodleCourseId?: string): Promise<DiscoveredActivity[]> {
    const coursesPromise = this.listCourses();

    // Con curso elegido no hace falta esperar al catálogo para saber a quién
    // preguntar; sin él, los cursos matriculados SON la lista de destinos.
    const courseIds =
      moodleCourseId !== undefined
        ? [parseCourseId(moodleCourseId)]
        : (await coursesPromise).map((course) => Number(course.moodleCourseId));

    if (courseIds.length === 0) return [];

    const [courses, assignments, forums] = await Promise.all([
      coursesPromise,
      this.#client.call(
        WS_FUNCTIONS.getAssignments,
        { courseids: courseIds },
        GetAssignmentsResponse,
      ),
      this.#client.call(WS_FUNCTIONS.getForums, { courseids: courseIds }, GetForumsResponse),
    ]);

    const courseNames = new Map(courses.map((course) => [course.moodleCourseId, course.name]));
    const wanted = new Set(courseIds);

    const activities: DiscoveredActivity[] = [];

    for (const course of assignments.courses) {
      // Moodle ignora `courseids` en algunas versiones si el token ve el curso
      // por otra vía; se vuelve a filtrar aquí para no colar actividades de un
      // curso que el profesor no ha elegido.
      if (!wanted.has(course.id)) continue;
      for (const assignment of course.assignments) {
        activities.push({
          moodleRef: moodleRefFor('assignment', assignment.id),
          name: assignment.name,
          kind: 'assignment',
          moodleCourseId: String(course.id),
          courseName: courseNames.get(String(course.id)) ?? course.shortname ?? '',
          // TODO(vega): sin verificar contra Moodle real — de momento 0; ver
          // arriba por qué contar pendientes aquí saldría caro.
          pendingCount: 0,
          alreadyImported: false,
        });
      }
    }

    for (const forum of forums) {
      if (!wanted.has(forum.course)) continue;
      activities.push({
        moodleRef: moodleRefFor('forum', forum.id),
        name: forum.name,
        kind: 'forum',
        moodleCourseId: String(forum.course),
        courseName: courseNames.get(String(forum.course)) ?? '',
        pendingCount: forum.numdiscussions ?? 0,
        alreadyImported: false,
      });
    }

    // Orden estable: la lista no debería bailar entre recargas, y Moodle no
    // garantiza ninguno. El `moodleRef` desempata los nombres repetidos.
    return activities.sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.name.localeCompare(b.name, 'es') ||
        a.moodleRef.localeCompare(b.moodleRef),
    );
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
  // mensaje lo diga, y como error de credencial, en vez de reventar luego con
  // un 401 de Moodle que la interfaz ya no sabría de dónde viene.
  if (config['token'] === undefined || config['token'] === '') {
    throw new LmsAuthError(
      'Falta MOODLE_TOKEN. Configúralo en el entorno o usa LMS_CONNECTOR=mock / filesystem.',
    );
  }
  return new Moodle3Connector(Moodle3Config.parse(config));
};

// ── Referencias de actividad ────────────────────────────────────────────────

/**
 * Prefijo por tipo de módulo. `mod_assign` y `mod_forum` numeran en tablas
 * distintas de Moodle, así que la tarea 5 y el foro 5 existen a la vez: sin
 * prefijo comparten `moodleRef`, y la segunda importación se pierde en silencio
 * contra el índice único. El prefijo es el propio nombre del módulo de Moodle
 * menos el `mod_`, que es como los nombra el resto del sistema.
 */
const KIND_PREFIX: Readonly<Record<ActivityKind, string>> = {
  assignment: 'assign',
  forum: 'forum',
};

const PREFIX_KIND: Readonly<Record<string, ActivityKind>> = {
  assign: 'assignment',
  forum: 'forum',
};

/** Referencia estable de una actividad de Moodle: `assign-42`, `forum-42`. */
export function moodleRefFor(kind: ActivityKind, id: number | string): string {
  return `${KIND_PREFIX[kind]}-${String(id)}`;
}

/**
 * El inverso de `moodleRefFor`. Devuelve `null` —y no lanza— para cualquier
 * cosa que no sea una referencia de Moodle: los conectores mock y filesystem
 * usan refs con el mismo prefijo pero id no numérico (`assign-tema04`), y quien
 * llama tiene que poder distinguirlas sin capturar excepciones.
 */
export function parseMoodleRef(ref: string): { kind: ActivityKind; id: number } | null {
  const separator = ref.indexOf('-');
  if (separator <= 0) return null;

  const kind = PREFIX_KIND[ref.slice(0, separator)];
  if (kind === undefined) return null;

  const rest = ref.slice(separator + 1);
  // `Number.parseInt` aceptaría "42abc"; aquí sólo vale un id entero completo.
  if (!/^\d+$/.test(rest)) return null;

  const id = Number(rest);
  return Number.isSafeInteger(id) ? { kind, id } : null;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function parseCourseId(moodleCourseId: string): number {
  if (!/^\d+$/.test(moodleCourseId)) {
    throw new Error(`Identificador de curso de Moodle no válido: "${moodleCourseId}".`);
  }
  return Number(moodleCourseId);
}

function assignmentIdOf(activityRef: ActivityRef): number {
  const lmsRef = activityRef.lmsRef ?? '';

  const parsed = parseMoodleRef(lmsRef);
  if (parsed !== null) {
    if (parsed.kind !== 'assignment') {
      throw new Error(
        `La actividad "${activityRef.slug}" apunta a un foro de Moodle ("${lmsRef}"), no a una tarea.`,
      );
    }
    return parsed.id;
  }

  // Compatibilidad: las actividades dadas de alta antes del prefijo guardaron
  // el id pelado ("42"). Se siguen aceptando para no romperlas.
  if (/^\d+$/.test(lmsRef)) return Number(lmsRef);

  throw new Error(
    `La actividad "${activityRef.slug}" no tiene asignada una tarea de Moodle (lmsRef vacío o con formato desconocido: "${lmsRef}").`,
  );
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
