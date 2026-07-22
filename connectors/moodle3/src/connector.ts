import { z } from 'zod';
import type { ActivityKind, DiscoveredActivity, DiscoveredCourse } from '@vega/shared';
import type { LmsConnector, LmsConnectorFactory } from '@vega/connector-lms';
import { LmsAuthError } from '@vega/connector-lms';
import type {
  ActivityRef,
  DownloadedFile,
  FeedbackFile,
  LmsConnectionCheck,
  LmsConnectionInfo,
  LmsConnectorConfig,
  RemoteGrade,
  RemoteReply,
  RemoteStudent,
  RemoteSubmission,
  SubmissionRef,
} from '@vega/connector-lms';
import {
  GetAssignmentsResponse,
  GetDiscussionPostsResponse,
  GetForumDiscussionsResponse,
  GetForumsResponse,
  GetSiteInfoResponse,
  GetSubmissionsResponse,
  GetUserCoursesResponse,
  GetUsersByFieldResponse,
  MoodleClient,
  WS_FUNCTIONS,
} from './api.js';
import type {
  MoodleForumDiscussion,
  MoodleForumPost,
  MoodleSubmission,
  MoodleUser,
} from './api.js';

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

/**
 * Detalle de «ok» cuando una función **de lectura** se comprueba contra el
 * catálogo en vez de llamarla: no es que escribiera nada, es que sin datos a la
 * vista (ningún foro, ningún debate) no hay llamada representativa que hacer.
 */
/**
 * Cuántos cursos se consultan al comprobar la conexión. Suficientes para dar
 * con una tarea o un foro real con el que ensayar, sin que un profesor con
 * cientos de cursos convierta el botón «Probar conexión» en una consulta que
 * su Moodle tarda medio minuto en contestar.
 */
const MAX_PROBE_COURSES = 25;

const READ_NOT_REHEARSED =
  'Está en el servicio web del token. No se ha podido ensayar con una llamada real porque este ' +
  'token aún no ve ningún foro o debate con el que probarla.';

/**
 * Tamaño de página al recorrer los debates de un foro. Cincuenta es un
 * compromiso: bastante alto para que la mayoría de foros quepan en una sola
 * llamada y bastante bajo para que una respuesta no ocupe megas de HTML.
 */
const DISCUSSIONS_PER_PAGE = 50;

/**
 * Tope de páginas de debates. No está para limitar el foro, sino para que una
 * versión de Moodle que ignore `page` y devuelva siempre la primera página no
 * deje el proceso girando para siempre.
 */
const MAX_DISCUSSION_PAGES = 20;

/**
 * Cuántos alumnos se piden por petición al traer los perfiles. Moodle serializa
 * los arrays como `values[0]=…&values[1]=…`, así que un foro de doscientos
 * participantes en una sola llamada se convierte en un cuerpo enorme que algunas
 * instalaciones cortan por `max_input_vars` sin decir por qué. Cincuenta es el
 * mismo compromiso que en los debates: pocas peticiones y ninguna desmesurada.
 */
const STUDENTS_PER_REQUEST = 50;

/** Las entregas antes que los foros: es el orden en que el profesor los busca. */
const KIND_ORDER: Readonly<Record<ActivityKind, number>> = { assignment: 0, forum: 1 };

/** El mensaje del error del LMS, que ya viene redactado para el profesor. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido.';
}

export class Moodle3Connector implements LmsConnector {
  readonly name = 'moodle3';

  readonly #client: MoodleClient;
  /** Cache por sesión: `remoteId` → URL del fichero, para no re-listar al descargar. */
  readonly #fileUrls = new Map<string, string>();
  #siteInfo: Promise<GetSiteInfoResponse> | undefined;

  /**
   * `fetchImpl` sólo lo usan las pruebas. Sin él no habría forma de ejercitar
   * el conector entero —que es donde vive la lógica de producto— sin un Moodle
   * delante, y justamente de ese Moodle es de lo que no se dispone.
   */
  constructor(config: Moodle3Config, fetchImpl?: typeof fetch) {
    this.#client = new MoodleClient({ baseUrl: config.baseUrl, token: config.token, fetchImpl });
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
   * Comprueba la credencial **función por función**, sin parar en la primera
   * que falle.
   *
   * Moodle no añade ninguna función al crear un servicio externo: hay que
   * listarlas a mano, y lo habitual es que falten varias. Si esto se detuviera
   * en el primer fallo, configurar el servicio serían tantos viajes al panel de
   * Moodle como funciones faltasen, descubiertas de una en una. Se prueban
   * todas y se devuelve el parte completo.
   *
   * Se comprueban también las que todavía no usa ninguna pantalla —ingesta y
   * publicación—: mejor enterarse ahora que la primera noche que corra el
   * proceso, cuando no haya nadie mirando.
   */
  async verifyConnection(): Promise<LmsConnectionInfo> {
    const checks: LmsConnectionCheck[] = [];

    // Identificación: de aquí sale el `userid`, que sólo hace falta para listar
    // cursos. Las de tareas y foros no dependen de él, así que se prueban igual
    // aunque esta falle — es la diferencia entre enterarse de todo lo que falta
    // de una vez o descubrirlo de una en una.
    let siteInfo: GetSiteInfoResponse | undefined;
    try {
      siteInfo = await this.#requireSiteInfo();
      checks.push({
        name: WS_FUNCTIONS.getSiteInfo,
        label: 'Identificar el token',
        status: 'ok',
        detail: `${siteInfo.sitename} · conectado como ${siteInfo.username}`,
        required: true,
      });
    } catch (error) {
      checks.push({
        name: WS_FUNCTIONS.getSiteInfo,
        label: 'Identificar el token',
        status: 'failed',
        detail: describe(error),
        required: true,
      });
    }

    let courses: DiscoveredCourse[] = [];
    if (siteInfo === undefined) {
      checks.push({
        name: WS_FUNCTIONS.getUserCourses,
        label: 'Listar tus cursos',
        status: 'skipped',
        detail: `No se ha podido comprobar: necesita el identificador de usuario que devuelve ${WS_FUNCTIONS.getSiteInfo}.`,
        required: true,
      });
    } else {
      try {
        courses = await this.listCourses();
        checks.push({
          name: WS_FUNCTIONS.getUserCourses,
          label: 'Listar tus cursos',
          status: 'ok',
          detail:
            courses.length === 0
              ? 'Responde correctamente, pero este token no ve ningún curso.'
              : `${courses.length} ${courses.length === 1 ? 'curso' : 'cursos'}`,
          required: true,
        });
      } catch (error) {
        checks.push({
          name: WS_FUNCTIONS.getUserCourses,
          label: 'Listar tus cursos',
          status: 'failed',
          detail: describe(error),
          required: true,
        });
      }
    }

    // Con un curso de verdad la prueba es representativa; sin ninguno se manda
    // la lista vacía, que Moodle acepta y sirve igual para saber si la función
    // está habilitada, que es justo lo que se está comprobando.
    //
    // Se preguntan **varios cursos y no sólo el primero**: en un aula real el
    // profesor ve decenas y las tareas suelen estar en uno concreto, así que
    // mirar el primero puede no encontrar ninguna tarea ni ningún foro con el
    // que ensayar las funciones que de verdad usa la ingesta. El tope evita
    // que un claustro con cientos de cursos convierta una comprobación en una
    // consulta enorme.
    const probeCourseIds = courses
      .slice(0, MAX_PROBE_COURSES)
      .map((course) => parseCourseId(course.moodleCourseId));

    let assignments: GetAssignmentsResponse | undefined;
    checks.push(
      await this.#probe(
        WS_FUNCTIONS.getAssignments,
        'Leer las tareas del curso',
        async () => {
          assignments = await this.#client.call(
            WS_FUNCTIONS.getAssignments,
            { courseids: probeCourseIds },
            GetAssignmentsResponse,
          );
          return assignments;
        },
        (result) => {
          // Cuántas TAREAS, no cuántos cursos ha devuelto Moodle: un curso sin
          // ninguna tarea también viene en la respuesta, y contar cursos daba
          // un «1 curso con tareas» que no significaba nada.
          const total = result.courses.reduce((sum, course) => sum + course.assignments.length, 0);
          return total === 0
            ? 'Responde correctamente; este token no ve ninguna tarea todavía.'
            : `${total} ${total === 1 ? 'tarea visible' : 'tareas visibles'}`;
        },
      ),
    );

    // La ingesta no lee las tareas: lee sus **envíos**, con esta otra función.
    // Es la que suele faltar en el servicio web, y durante un tiempo este parte
    // no la cubría: importar actividades funcionaba y la ingesta fallaba entera
    // sin que «Probar conexión» avisara de nada.
    //
    // Hace falta una tarea de verdad con la que ensayar: Moodle rechaza la
    // llamada con la lista vacía (`invalidparameter`), que es un fallo de la
    // sonda y no del servicio web —dar eso por roto manda a arreglar algo que
    // está bien—. Sin ninguna tarea a la vista se mira el catálogo del token.
    const assignmentIds = (assignments?.courses ?? [])
      .flatMap((course) => course.assignments.map((assignment) => assignment.id))
      .slice(0, 1);
    checks.push(
      assignmentIds.length === 0
        ? this.#declared(
            siteInfo,
            WS_FUNCTIONS.getSubmissions,
            'Leer lo que entrega cada alumno',
            'Sin ella Vega ve la tarea pero no puede traerse ni una entrega.',
            READ_NOT_REHEARSED,
          )
        : await this.#probe(
            WS_FUNCTIONS.getSubmissions,
            'Leer lo que entrega cada alumno',
            () =>
              this.#client.call(
                WS_FUNCTIONS.getSubmissions,
                { assignmentids: assignmentIds, status: 'submitted' },
                GetSubmissionsResponse,
              ),
            (result) => {
              const total = result.assignments.reduce(
                (sum, assignment) => sum + assignment.submissions.length,
                0,
              );
              return `${total} ${total === 1 ? 'entrega visible' : 'entregas visibles'} en la primera tarea`;
            },
          ),
    );

    let forums: GetForumsResponse | undefined;
    checks.push(
      await this.#probe(
        WS_FUNCTIONS.getForums,
        'Leer los foros del curso',
        async () => {
          forums = await this.#client.call(
            WS_FUNCTIONS.getForums,
            { courseids: probeCourseIds },
            GetForumsResponse,
          );
          return forums;
        },
        (result) => `${result.length} ${result.length === 1 ? 'foro' : 'foros'}`,
      ),
    );

    // El mismo agujero que el de los envíos, en versión foro: ver el foro no es
    // poder leer sus debates ni sus mensajes. Con un foro (o un debate) a la
    // vista se hace la llamada de verdad; sin ninguno no hay llamada inocua
    // posible y se mira el catálogo del token, que es donde suele estar el fallo.
    const forumId = forums?.[0]?.id;
    let discussions: GetForumDiscussionsResponse | undefined;
    checks.push(
      forumId === undefined
        ? this.#declared(
            siteInfo,
            WS_FUNCTIONS.getForumDiscussions,
            'Leer los debates del foro',
            'Sin ella Vega ve el foro pero no puede leer qué se pregunta en él.',
            READ_NOT_REHEARSED,
          )
        : await this.#probe(
            WS_FUNCTIONS.getForumDiscussions,
            'Leer los debates del foro',
            async () => {
              discussions = await this.#client.call(
                WS_FUNCTIONS.getForumDiscussions,
                {
                  forumid: forumId,
                  page: 0,
                  perpage: 1,
                  sortby: 'timemodified',
                  sortdirection: 'ASC',
                },
                GetForumDiscussionsResponse,
              );
              return discussions;
            },
            (result) =>
              result.discussions.length === 0
                ? 'Responde correctamente; el primer foro aún no tiene debates.'
                : 'Lee los debates del primer foro sin problemas.',
          ),
    );

    const firstDiscussion = discussions?.discussions[0];
    const discussionId =
      firstDiscussion === undefined ? undefined : (firstDiscussion.discussion ?? firstDiscussion.id);
    checks.push(
      discussionId === undefined
        ? this.#declared(
            siteInfo,
            WS_FUNCTIONS.getDiscussionPosts,
            'Leer los mensajes de un debate',
            'Sin ella no se sabe si la pregunta que abre un debate sigue sin responder, que es a lo único que Vega contesta.',
            READ_NOT_REHEARSED,
          )
        : await this.#probe(
            WS_FUNCTIONS.getDiscussionPosts,
            'Leer los mensajes de un debate',
            () =>
              this.#client.call(
                WS_FUNCTIONS.getDiscussionPosts,
                { discussionid: discussionId },
                GetDiscussionPostsResponse,
              ),
            (result) =>
              `${result.posts.length} ${result.posts.length === 1 ? 'mensaje' : 'mensajes'} en el primer debate`,
          ),
    );

    // Opcional a propósito: sin esta función Vega corrige exactamente igual,
    // sólo que la cola enseña el identificador de Moodle en lugar del nombre del
    // alumno. Marcarla como obligatoria mandaría a pelearse con los permisos del
    // servicio web para conseguir algo que no bloquea nada.
    //
    // Se prueba con el propio usuario del token: es el único id que se sabe que
    // existe en el sitio, y basta para saber si la función está habilitada.
    checks.push(
      await this.#probe(
        WS_FUNCTIONS.getUsersByField,
        'Leer el perfil de los alumnos',
        () =>
          this.#client.call(
            WS_FUNCTIONS.getUsersByField,
            { field: 'id', values: siteInfo === undefined ? [] : [siteInfo.userid] },
            GetUsersByFieldResponse,
          ),
        (result) =>
          result.length === 0
            ? 'Responde correctamente, pero no ha devuelto ningún perfil.'
            : `${result.length} ${result.length === 1 ? 'perfil' : 'perfiles'}`,
        false,
      ),
    );

    // Las de escritura no se llaman: se leen del catálogo del token. Ver
    // `#declared`.
    checks.push(
      this.#declared(
        siteInfo,
        WS_FUNCTIONS.saveGrade,
        'Publicar la nota y el feedback',
        'Sin ella el profesor validaría correcciones que no llegarían nunca al alumno.',
      ),
      this.#declared(
        siteInfo,
        WS_FUNCTIONS.addDiscussionPost,
        'Responder en el foro',
        'Sin ella las respuestas a dudas se quedan en Vega, revisadas y sin publicar.',
      ),
    );

    return {
      siteName: siteInfo?.sitename ?? '',
      username: siteInfo?.username ?? '',
      courseCount: courses.length,
      checks,
    };
  }

  /**
   * Una comprobación suelta: no propaga el fallo, lo convierte en parte.
   * `required` por defecto a `true` porque casi todas lo son; las que no, lo
   * dicen explícitamente y la pantalla de Ajustes puede enseñarlas como aviso en
   * vez de como impedimento.
   */
  async #probe<T>(
    name: string,
    label: string,
    call: () => Promise<T>,
    describeOk: (result: T) => string,
    required = true,
  ): Promise<LmsConnectionCheck> {
    try {
      return { name, label, status: 'ok', detail: describeOk(await call()), required };
    } catch (error) {
      return { name, label, status: 'failed', detail: describe(error), required };
    }
  }

  /**
   * Comprobación de una función **de escritura**, que no se llama.
   *
   * `mod_assign_save_grade` calificaría a un alumno de verdad y
   * `mod_forum_add_discussion_post` publicaría un mensaje en un foro con gente
   * dentro: no hay forma de ensayarlas. Se mira en su lugar el catálogo de
   * funciones que `core_webservice_get_site_info` devuelve para el token, que
   * es exactamente donde está el fallo habitual —Moodle no añade ninguna
   * función al crear un servicio externo—.
   *
   * Lo que esto comprueba y lo que no conviene no confundirlo, y por eso lo dice
   * el detalle: **que la función esté en el servicio no garantiza que el usuario
   * tenga la capacidad** (`mod/assign:grade`, `mod/forum:replypost`). Eso sólo
   * se sabe publicando. Aun así vale la pena: sin este parte, el profesor da la
   * configuración por buena y se entera de que falta la mitad la primera noche
   * que corre el proceso, cuando no hay nadie mirando.
   */
  #declared(
    siteInfo: GetSiteInfoResponse | undefined,
    name: string,
    label: string,
    whyItMatters: string,
    okDetail?: string,
  ): LmsConnectionCheck {
    const declared = siteInfo?.functions;
    if (declared === undefined) {
      return {
        name,
        label,
        status: 'skipped',
        detail:
          siteInfo === undefined
            ? `No se ha podido comprobar: necesita el catálogo de funciones que devuelve ${WS_FUNCTIONS.getSiteInfo}.`
            : 'Este Moodle no ha devuelto la lista de funciones del token, así que no se puede comprobar sin publicar de verdad.',
        required: true,
      };
    }

    if (declared.some((entry) => entry.name === name)) {
      return {
        name,
        label,
        status: 'ok',
        detail:
          okDetail ??
          'Está en el servicio web del token. No se ejecuta en la comprobación —escribiría en Moodle—, ' +
            'así que queda por confirmar que el usuario tenga además la capacidad correspondiente.',
        required: true,
      };
    }

    return {
      name,
      label,
      status: 'failed',
      detail: `No está en el servicio web del token. ${whyItMatters} Añádela en Administración del sitio → Servidor → Servicios web → Servicios externos → Funciones.`,
      required: true,
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
   * Lo que hay pendiente de corregir en una actividad. Son dos caminos que no
   * se parecen: una tarea entrega ficheros, uno por alumno, y un foro entrega
   * texto, como mucho uno por debate (ver `#listForumQuestions`).
   *
   * TODO(vega): sin verificar contra Moodle real — falta comprobar el filtro por
   * `status` (sólo queremos `submitted`), la paginación cuando hay muchos
   * alumnos, y si `plugins` llega siempre o hay que pedirlo aparte.
   */
  async listSubmissions(activityRef: ActivityRef): Promise<RemoteSubmission[]> {
    if (activityRef.kind === 'forum') return this.#listForumQuestions(activityRef);

    const assignmentId = assignmentIdOf(activityRef);

    const response = await this.#client.call(
      WS_FUNCTIONS.getSubmissions,
      { assignmentids: [assignmentId], status: 'submitted' },
      GetSubmissionsResponse,
    );

    const submissions: RemoteSubmission[] = [];
    const userIds: number[] = [];
    for (const assignment of response.assignments) {
      for (const submission of assignment.submissions) {
        const file = firstSubmissionFile(submission);
        if (file === undefined) continue;

        // La referencia sigue siendo el id numérico de Moodle: es lo que se usa
        // para publicar la nota y lo que nunca cambia. El nombre del alumno,
        // cuando se puede leer, viaja aparte en `student`.
        const studentRef = `moodle-${submission.userid}`;
        const remoteId = `${assignment.assignmentid}:${submission.userid}:${submission.attemptnumber}`;
        this.#fileUrls.set(remoteId, file.fileurl);
        userIds.push(submission.userid);

        submissions.push({
          ref: { activity: activityRef, studentRef, remoteId },
          filename: file.filename,
          submittedAt: new Date(submission.timemodified * 1000).toISOString(),
          sizeBytes: file.filesize ?? 0,
          mediaType: file.mimetype ?? 'application/pdf',
          textContent: null,
          student: null,
        });
      }
    }
    return this.#withStudents(submissions, userIds);
  }

  /**
   * Pega a cada entrega el perfil de quien la firma. Se hace aquí, una sola vez
   * por llamada y con todos los ids juntos, y no dentro del bucle: una petición
   * por alumno convertiría una entrega de treinta en treinta viajes a Moodle
   * para enseñar treinta nombres.
   */
  async #withStudents(
    submissions: RemoteSubmission[],
    userIds: number[],
  ): Promise<RemoteSubmission[]> {
    if (submissions.length === 0) return submissions;

    const students = await this.#fetchStudents(userIds);
    // Sin perfiles no hay nada que pegar: se devuelven las entregas tal cual, ya
    // con `student: null`, en vez de reconstruir la lista entera para nada.
    if (students.size === 0) return submissions;

    return submissions.map((submission) => ({
      ...submission,
      student: students.get(submission.ref.studentRef) ?? null,
    }));
  }

  /**
   * El perfil de los alumnos indicados, indexado por `moodle-<id>`, que es el
   * mismo formato que usa `studentRef`: así quien llama los casa sin volver a
   * parsear nada.
   *
   * **Este método no falla nunca hacia fuera.** Si Moodle rechaza la llamada
   * —porque la función no está en el servicio web, o porque al token le falta
   * `moodle/user:viewalldetails`— se devuelve lo que se haya podido reunir, que
   * puede ser nada. Traer el perfil es un extra para el profesor y para el
   * contexto del modelo: que Moodle no deje leer perfiles no puede impedir que
   * se corrijan las entregas, que es para lo que sirve el producto.
   *
   * TODO(vega): sin verificar contra Moodle real — `core_user_get_users_by_field`
   * exige la capacidad `moodle/user:viewalldetails` para ver perfiles ajenos, y
   * además `moodle/site:viewuseridentity` para `email` e `idnumber`. Sin ellas
   * Moodle **no avisa**: devuelve el perfil recortado, con los campos
   * simplemente ausentes. Hay que comprobar contra una instalación real qué
   * llega con un token de profesor corriente antes de prometer nada en la
   * interfaz.
   */
  async #fetchStudents(userIds: number[]): Promise<Map<string, RemoteStudent>> {
    const students = new Map<string, RemoteStudent>();

    // Un mismo alumno puede tener varias entregas en la misma actividad (un
    // fichero por cada adjunto), y pedir su perfil dos veces no aporta nada.
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return students;

    for (let start = 0; start < unique.length; start += STUDENTS_PER_REQUEST) {
      const batch = unique.slice(start, start + STUDENTS_PER_REQUEST);
      let users: MoodleUser[];
      try {
        users = await this.#client.call(
          WS_FUNCTIONS.getUsersByField,
          { field: 'id', values: batch },
          GetUsersByFieldResponse,
        );
      } catch {
        // Un fallo aquí es casi siempre de configuración —función no habilitada
        // o capacidad que falta—, así que afecta igual a los lotes siguientes:
        // se corta el recorrido en lugar de repetir el mismo error N veces.
        break;
      }
      for (const user of users) {
        students.set(`moodle-${user.id}`, toRemoteStudent(user));
      }
    }

    return students;
  }

  /**
   * Las preguntas de un foro que están esperando respuesta.
   *
   * REGLA DE PRODUCTO: en un foro Vega contesta **sólo a la primera pregunta no
   * respondida** de cada debate. De ahí salen las dos decisiones que gobiernan
   * este método:
   *
   *  - de cada debate sale **como mucho una** intervención, la del mensaje que
   *    lo abre (`parent === 0`), porque es ahí donde está la pregunta; los
   *    mensajes que cuelgan de él son conversación, no preguntas nuevas;
   *  - si el debate ya tiene una respuesta de alguien distinto de quien lo
   *    abrió, se omite entero. Alguien —otro alumno o el propio profesor— ya ha
   *    contestado, y meter encima una respuesta de la IA no ayudaría a nadie:
   *    duplicaría lo ya dicho o lo contradiría en público.
   *
   * Que el autor se responda a sí mismo no cuenta como respuesta: matizar la
   * propia pregunta es justo lo contrario de haberla resuelto.
   */
  async #listForumQuestions(activityRef: ActivityRef): Promise<RemoteSubmission[]> {
    const forumId = forumIdOf(activityRef);
    const discussions = await this.#listDiscussions(forumId);

    const submissions: RemoteSubmission[] = [];
    const userIds: number[] = [];
    // Un debate detrás de otro y no en paralelo: son foros de un curso, no hay
    // prisa, y un profesor con cincuenta debates no debería provocarle a su
    // Moodle cincuenta peticiones simultáneas.
    for (const discussion of discussions) {
      const discussionId = discussion.discussion ?? discussion.id;
      const { posts } = await this.#client.call(
        WS_FUNCTIONS.getDiscussionPosts,
        { discussionid: discussionId },
        GetDiscussionPostsResponse,
      );

      const question = pendingQuestionOf(posts);
      if (question === null) continue;

      userIds.push(question.userid);
      submissions.push(forumSubmission(activityRef, forumId, discussionId, question));
    }
    // Los perfiles se piden después del recorrido, con todos los autores de una
    // vez: dentro del bucle serían tantas peticiones más como debates abiertos.
    return this.#withStudents(submissions, userIds);
  }

  /**
   * Todos los debates de un foro, página a página.
   *
   * Se ordena por `timemodified` ascendente para que la paginación sea estable:
   * con el orden por defecto —el debate tocado más recientemente primero— un
   * mensaje nuevo escrito a mitad del recorrido reordena la lista y hace que un
   * debate salga dos veces o ninguna.
   *
   * TODO(vega): sin verificar contra Moodle real — falta comprobar que `page`
   * empieza en 0 y que Moodle respeta `perpage`; si devolviera siempre el
   * tamaño de página por defecto del sitio, el corte de «página incompleta»
   * nunca se cumpliría y el recorrido pararía en el tope de páginas. Falta
   * también ver qué hace con los debates fijados arriba, que algunas versiones
   * repiten en todas las páginas.
   */
  async #listDiscussions(forumId: number): Promise<MoodleForumDiscussion[]> {
    const all: MoodleForumDiscussion[] = [];

    for (let page = 0; page < MAX_DISCUSSION_PAGES; page += 1) {
      const { discussions } = await this.#client.call(
        WS_FUNCTIONS.getForumDiscussions,
        {
          forumid: forumId,
          page,
          perpage: DISCUSSIONS_PER_PAGE,
          sortby: 'timemodified',
          sortdirection: 'ASC',
        },
        GetForumDiscussionsResponse,
      );

      all.push(...discussions);
      // Una página incompleta es la última: Moodle no dice cuántos debates hay
      // en total, así que es la única señal de fin que se puede leer.
      if (discussions.length < DISCUSSIONS_PER_PAGE) break;
    }

    return all;
  }

  /**
   * TODO(vega): sin verificar contra Moodle real — la descarga por
   * `pluginfile.php` con `?token=` funciona en la documentación, pero hay que
   * comprobar el comportamiento con `forcedownload`, con ficheros grandes y con
   * instalaciones tras un proxy que reescribe URLs.
   */
  async download(ref: SubmissionRef): Promise<DownloadedFile> {
    // En un foro no hay nada que descargar, y el mensaje tiene que decirlo así:
    // el fallo genérico de más abajo («no hay URL de descarga») mandaría a
    // llamar antes a listSubmissions(), que en un foro no arreglaría nada.
    if (refersToForum(ref.activity)) {
      throw new Error(
        `La intervención "${ref.remoteId}" es un mensaje del foro "${ref.activity.slug}" y en un foro no hay fichero que descargar. ` +
          'El texto del alumno viaja en textContent de listSubmissions().',
      );
    }

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
    // Un `remoteId` de foro es `<foro>:<debate>:<mensaje>`, tres números, y
    // `parseRemoteId` lo aceptaría sin rechistar: publicaría la respuesta como
    // nota de la tarea nº foro al usuario nº debate. No daría error, y la nota
    // caería sobre un alumno cualquiera de una actividad cualquiera. De ahí que
    // el corte esté aquí y no en la validación del identificador.
    if (refersToForum(ref.activity)) {
      throw new Error(
        `La actividad "${ref.activity.slug}" es un foro y no tiene libro de notas: ` +
          'una respuesta a una duda se publica con publishForumReply().',
      );
    }

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

  /**
   * La respuesta se cuelga **del mensaje del alumno**, no del debate: así queda
   * como respuesta a su duda y no como una intervención suelta al final del
   * hilo, que es lo que vería quien entrase a leerlo.
   *
   * TODO(vega): sin verificar contra Moodle real — quedan tres cosas:
   *  - el formato del mensaje. `mod_forum_add_discussion_post` no admite un
   *    `messageformat` de primer nivel en 3.x; se manda HTML porque es lo que
   *    el editor de Moodle guarda por defecto, pero un sitio configurado en
   *    Markdown podría enseñar las etiquetas en crudo al alumno;
   *  - si el sitio tiene activado el retardo de edición (`maxeditingtime`), que
   *    no impide publicar pero sí cambia cuándo se notifica;
   *  - si conviene pasar `options[discussionsubscribe]=0` para que el profesor
   *    no acabe suscrito a todos los debates que Vega conteste.
   */
  async publishForumReply(ref: SubmissionRef, reply: RemoteReply): Promise<void> {
    if (!refersToForum(ref.activity)) {
      throw new Error(
        `La actividad "${ref.activity.slug}" es una entrega, no un foro: ` +
          'la nota y el feedback se publican con publishGrade().',
      );
    }

    const { postId } = parseForumRemoteId(ref.remoteId);

    await this.#client.call(
      WS_FUNCTIONS.addDiscussionPost,
      {
        postid: postId,
        // Vacío deja que Moodle componga el «Re: <asunto del hilo>» que sus
        // usuarios reconocen; inventarlo aquí obligaría a Vega a conocer las
        // convenciones de cada idioma del sitio.
        subject: reply.subject ?? '',
        message: renderReplyHtml(reply),
      },
      z.unknown(),
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

/** El equivalente de `assignmentIdOf` para los foros, con la misma tolerancia. */
function forumIdOf(activityRef: ActivityRef): number {
  const lmsRef = activityRef.lmsRef ?? '';

  const parsed = parseMoodleRef(lmsRef);
  if (parsed !== null) {
    if (parsed.kind !== 'forum') {
      throw new Error(
        `La actividad "${activityRef.slug}" apunta a una tarea de Moodle ("${lmsRef}"), no a un foro.`,
      );
    }
    return parsed.id;
  }

  // Compatibilidad con las actividades dadas de alta antes del prefijo, que
  // guardaron el id pelado ("42"). Ver `assignmentIdOf`.
  if (/^\d+$/.test(lmsRef)) return Number(lmsRef);

  throw new Error(
    `La actividad "${activityRef.slug}" no tiene asignado un foro de Moodle (lmsRef vacío o con formato desconocido: "${lmsRef}").`,
  );
}

/**
 * Si la actividad es un foro. `kind` es opcional en `ActivityRef`, así que
 * cuando no viene se mira el `lmsRef`: un `forum-42` es un foro aunque nadie lo
 * haya dicho, y el mensaje de error acierta más si se tiene esto en cuenta.
 */
function refersToForum(activityRef: ActivityRef): boolean {
  if (activityRef.kind !== undefined) return activityRef.kind === 'forum';
  return parseMoodleRef(activityRef.lmsRef ?? '')?.kind === 'forum';
}

/**
 * El mensaje que abre el debate, si sigue sin respuesta de nadie más. `null`
 * cuando el debate ya está atendido o cuando no hay mensaje raíz que leer.
 * Ver la regla de producto en `#listForumQuestions`.
 */
function pendingQuestionOf(posts: readonly MoodleForumPost[]): MoodleForumPost | null {
  // El mensaje raíz es el único sin padre. No se toma el primero del array
  // porque Moodle no promete ningún orden concreto en `posts`.
  const root = posts.find((post) => (post.parent ?? 0) === 0);
  if (root === undefined) return null;

  const answered = posts.some((post) => post.id !== root.id && post.userid !== root.userid);
  return answered ? null : root;
}

/** La pregunta pendiente de un debate, ya en la forma que entiende Vega. */
function forumSubmission(
  activityRef: ActivityRef,
  forumId: number,
  discussionId: number,
  post: MoodleForumPost,
): RemoteSubmission {
  const subject = htmlToPlainText(post.subject ?? '');
  const body = htmlToPlainText(post.message ?? '');
  // El asunto es parte de la pregunta —muchas veces es la pregunta entera— y
  // sin él el motor corrige un texto al que le falta el enunciado.
  const textContent = subject === '' ? body : `${subject}\n\n${body}`;

  return {
    ref: {
      activity: activityRef,
      // Nunca el nombre real del alumno: el id numérico de Moodle basta para
      // publicar la respuesta y no identifica a nadie fuera de Moodle.
      studentRef: `moodle-${post.userid}`,
      // Foro, debate y mensaje: los tres son ids de Moodle y no cambian, así
      // que la misma pregunta conserva su referencia entre ejecuciones y no se
      // importa dos veces.
      remoteId: `${forumId}:${discussionId}:${post.id}`,
    },
    // En un foro el alumno no sube nada: lo que entrega es el texto.
    filename: null,
    submittedAt: new Date(post.created * 1000).toISOString(),
    sizeBytes: new TextEncoder().encode(textContent).length,
    mediaType: 'text/plain',
    textContent,
    // El perfil se pega después, de una sola vez para todo el foro.
    student: null,
  };
}

/**
 * El usuario de Moodle en la forma que entiende Vega. Todo lo que Moodle no
 * manda se convierte en `null` —y no en cadena vacía— para que quien lo pinte
 * pueda distinguir «este dato no ha llegado» de «este dato está en blanco»: lo
 * primero suele ser una capacidad que le falta al token, lo segundo un perfil
 * que nadie ha rellenado, y se arreglan en sitios distintos.
 *
 * Los `customfields` pasan tal cual, con su `shortname` original. Ver la nota de
 * `RemoteStudent`: qué campos existen depende de cada instalación y filtrarlos
 * aquí sería decidir por el producto desde el conector.
 */
function toRemoteStudent(user: MoodleUser): RemoteStudent {
  return {
    ref: `moodle-${user.id}`,
    username: user.username ?? null,
    firstName: user.firstname ?? null,
    lastName: user.lastname ?? null,
    fullName: user.fullname ?? null,
    email: user.email ?? null,
    phone: user.phone1 ?? null,
    idnumber: user.idnumber ?? null,
    institution: user.institution ?? null,
    department: user.department ?? null,
    city: user.city ?? null,
    country: user.country ?? null,
    customFields: (user.customfields ?? []).map((field) => ({
      shortname: field.shortname,
      name: field.name ?? null,
      // Un campo sin valor es un campo vacío, no un campo ausente: Moodle los
      // devuelve igual y quitarlos escondería que existen en la instalación.
      value: field.value ?? '',
    })),
  };
}

/** Entidades HTML que aparecen en un mensaje de foro escrito con el editor de Moodle. */
const HTML_ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&nbsp;/gi, ' '],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#0*39;/g, "'"],
  // `&amp;` va la última a propósito: decodificarla antes convertiría un
  // `&amp;lt;` escrito literalmente por el alumno en un `<` que no puso él.
  [/&amp;/gi, '&'],
];

/**
 * El mensaje de un foro de Moodle viaja en HTML, y lo que necesitan tanto el
 * motor de IA como el profesor es el texto. Convertir aquí —y no más adelante—
 * evita que las etiquetas se cuelen en el prompt, donde gastan contexto y
 * confunden al modelo, o en la pantalla, donde se leerían en crudo.
 *
 * No pretende ser un renderizador: conserva la separación en párrafos, que es
 * lo único de la estructura que aporta significado a un texto de foro, y tira
 * el resto.
 */
export function htmlToPlainText(html: string): string {
  const text = HTML_ENTITIES.reduce(
    (accumulated, [pattern, replacement]) => accumulated.replace(pattern, replacement),
    html
      // El contenido de un `<script>` o un `<style>` no es texto del alumno:
      // quitando sólo las etiquetas quedaría el código suelto en medio.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<[^>]*>/g, ''),
  );

  return (
    text
      .split('\n')
      // El HTML se escribe con sangrías y saltos que no significan nada: se
      // colapsan dentro de cada línea, pero sin tocar los saltos que sí vienen
      // de los párrafos y los `<br>`.
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
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

/**
 * El `<foro>:<debate>:<mensaje>` que fabrica `forumSubmission`. Lo único que
 * hace falta para responder es el tercero, pero se validan los tres: un
 * identificador con dos partes es un `remoteId` de entrega colado por el camino
 * de foro, y contestar a un `postid` que en realidad es un `userid` publicaría
 * la respuesta en un hilo cualquiera.
 */
function parseForumRemoteId(remoteId: string): { postId: number } {
  const parts = remoteId.split(':');
  const postId = Number.parseInt(parts[2] ?? '', 10);
  if (parts.length !== 3 || !Number.isFinite(postId)) {
    throw new Error(
      `Identificador de intervención de foro mal formado: "${remoteId}". Se esperaba <foro>:<debate>:<mensaje>.`,
    );
  }
  return { postId };
}

/**
 * La respuesta en HTML, que es lo que el editor de Moodle guarda por defecto.
 * Se respetan los saltos de línea del profesor: lo que escribió con dos párrafos
 * tiene que llegarle al alumno con dos párrafos.
 */
function renderReplyHtml(reply: RemoteReply): string {
  return reply.body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
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
