import { z } from 'zod';
import { LmsAuthError, LmsUnavailableError } from '@vega/connector-lms';

/**
 * Cliente de los web services REST de Moodle 3.
 *
 * ⚠️ NADA de este fichero se ha probado contra un Moodle real. Las URLs, los
 * nombres de función y la forma de las respuestas están sacados de la
 * documentación de Moodle 3.x, no de una ejecución. Ver los `TODO(vega)`.
 * Lo que sí está cubierto por `api.test.ts` es la clasificación del fallo
 * (credencial contra indisponibilidad), que se prueba con un `fetchImpl` de
 * laboratorio y no depende de acertar con la forma de las respuestas.
 *
 * Particularidades de Moodle que condicionan el diseño:
 *  - Todos los servicios cuelgan del MISMO endpoint y se distinguen por el
 *    parámetro `wsfunction`.
 *  - Los errores llegan con HTTP 200 y un cuerpo `{exception, errorcode,
 *    message}`; hay que mirar el cuerpo, no el código de estado.
 *  - Los arrays se serializan como `assignmentids[0]=3&assignmentids[1]=7`.
 */

export const WS_PATH = '/webservice/rest/server.php';

/** Funciones de web service que usa Vega. */
export const WS_FUNCTIONS = {
  /**
   * Sitio, usuario y capacidades del dueño del token. Es la llamada más barata
   * que existe y la única que no necesita ningún parámetro, así que sirve de
   * prueba de vida de la credencial.
   */
  getSiteInfo: 'core_webservice_get_site_info',
  /** Cursos y módulos visibles para el token: de aquí sale el catálogo. */
  getCourseContents: 'core_course_get_contents',
  /** Cursos en los que el usuario del token está matriculado. */
  getUserCourses: 'core_enrol_get_users_courses',
  getAssignments: 'mod_assign_get_assignments',
  getSubmissions: 'mod_assign_get_submissions',
  /** Foros de un curso, para poder reaccionar también a los debates. */
  getForums: 'mod_forum_get_forums_by_courses',
  /**
   * Debates de un foro; de ahí cuelgan los mensajes de cada alumno.
   *
   * Es la función de Moodle 3.7+. La anterior,
   * `mod_forum_get_forum_discussions_paginated`, quedó obsoleta en 3.7 y los
   * sitios modernos **ya ni la ofrecen** en el selector de funciones del
   * servicio web: en el piloto (Moodle 3.11) era imposible añadirla y los foros
   * fallaban enteros con `accessexception`. Devuelve la misma estructura de
   * debate; sólo cambian los parámetros (`sortorder` numérico en lugar de
   * `sortby`/`sortdirection`).
   */
  getForumDiscussions: 'mod_forum_get_forum_discussions',
  /** Debates, en la función anterior a Moodle 3.7. Ver `getForumDiscussions`. */
  getForumDiscussionsLegacy: 'mod_forum_get_forum_discussions_paginated',
  /**
   * Mensajes de un debate. El listado de debates trae el primer mensaje, pero
   * no las respuestas, y sin ellas no se puede saber si la pregunta que abre el
   * debate sigue sin contestar, que es lo único a lo que Vega responde.
   *
   * Función de Moodle 3.7+: devuelve los mensajes con otra forma (autor
   * anidado, `parentid` en vez de `parent`, `timecreated` en vez de `created`);
   * `normalizeModernPost` los traduce a la forma que entiende el conector.
   */
  getDiscussionPosts: 'mod_forum_get_discussion_posts',
  /** Mensajes de un debate, en la función anterior a Moodle 3.7. */
  getDiscussionPostsLegacy: 'mod_forum_get_forum_discussion_posts',
  /**
   * Perfil de los alumnos a partir de sus ids. Es opcional para Vega: sin ella
   * la corrección funciona igual, sólo que la cola enseña `moodle-1234` en lugar
   * del nombre del alumno.
   */
  getUsersByField: 'core_user_get_users_by_field',
  saveGrade: 'mod_assign_save_grade',
  /**
   * Responder a una duda de foro. Cuelga la respuesta del mensaje del alumno,
   * que es lo que exige HU-20 (RN-4): una duda no se contesta escribiendo en el
   * libro de notas de una tarea.
   */
  addDiscussionPost: 'mod_forum_add_discussion_post',
} as const;

/**
 * Las funciones que **escriben** en Moodle.
 *
 * Están apartadas porque no se pueden ensayar: llamar a `mod_assign_save_grade`
 * para ver si el token la tiene pondría una nota a un alumno de verdad, y
 * llamar a `mod_forum_add_discussion_post` publicaría un mensaje en un foro con
 * gente dentro. Su comprobación es distinta y está en `verifyConnection()`.
 */
export const WRITE_FUNCTIONS: readonly string[] = [
  WS_FUNCTIONS.saveGrade,
  WS_FUNCTIONS.addDiscussionPost,
];

// ── Esquemas de respuesta ───────────────────────────────────────────────────

/** Moodle devuelve los errores con HTTP 200 y este cuerpo. */
export const MoodleError = z.object({
  exception: z.string(),
  errorcode: z.string(),
  message: z.string(),
  debuginfo: z.string().optional(),
});
export type MoodleError = z.infer<typeof MoodleError>;

export const MoodleFile = z.object({
  filename: z.string(),
  filepath: z.string().optional(),
  filesize: z.number().optional(),
  fileurl: z.string(),
  timemodified: z.number().optional(),
  mimetype: z.string().optional(),
});
export type MoodleFile = z.infer<typeof MoodleFile>;

export const MoodleSubmissionPlugin = z.object({
  type: z.string(),
  name: z.string().optional(),
  fileareas: z
    .array(z.object({ area: z.string(), files: z.array(MoodleFile).optional() }))
    .optional(),
});

export const MoodleSubmission = z.object({
  id: z.number(),
  userid: z.number(),
  attemptnumber: z.number(),
  timecreated: z.number(),
  timemodified: z.number(),
  status: z.string(),
  plugins: z.array(MoodleSubmissionPlugin).optional(),
});
export type MoodleSubmission = z.infer<typeof MoodleSubmission>;

export const GetSubmissionsResponse = z.object({
  assignments: z.array(
    z.object({
      assignmentid: z.number(),
      submissions: z.array(MoodleSubmission),
    }),
  ),
  warnings: z.array(z.object({ item: z.string().optional(), message: z.string() })).optional(),
});
export type GetSubmissionsResponse = z.infer<typeof GetSubmissionsResponse>;

export const GetAssignmentsResponse = z.object({
  courses: z.array(
    z.object({
      id: z.number(),
      shortname: z.string().optional(),
      assignments: z.array(
        z.object({
          id: z.number(),
          cmid: z.number().optional(),
          course: z.number(),
          name: z.string(),
          duedate: z.number().optional(),
          grade: z.number().optional(),
        }),
      ),
    }),
  ),
  warnings: z.array(z.object({ item: z.string().optional(), message: z.string() })).optional(),
});
export type GetAssignmentsResponse = z.infer<typeof GetAssignmentsResponse>;

/**
 * `core_webservice_get_site_info` devuelve muchísimos campos; aquí sólo se
 * declaran los tres que se usan y Zod descarta el resto. `userid` no es
 * decorativo: `core_enrol_get_users_courses` lo exige, y el token no lo revela
 * por ningún otro sitio.
 *
 * TODO(vega): sin verificar contra Moodle real — falta comprobar que los tres
 * campos llegan siempre. Si alguna instalación omite `sitename` o `username`,
 * habría que relajarlos a opcionales antes que romper la verificación entera.
 */
export const GetSiteInfoResponse = z.object({
  sitename: z.string(),
  username: z.string(),
  userid: z.number(),
  /**
   * Las funciones que el token puede llamar. Es la única forma de saber si una
   * función de **escritura** está en el servicio web sin llamarla —y llamarla
   * significaría calificar a un alumno o publicar un mensaje en un foro.
   *
   * Opcional porque no todas las versiones ni todas las configuraciones la
   * devuelven; cuando falta, la comprobación se declara omitida en lugar de
   * fallida. Dar por ausente lo que no se ha podido leer mandaría a habilitar
   * funciones que probablemente ya estén puestas.
   */
  functions: z.array(z.object({ name: z.string() })).optional(),
});
export type GetSiteInfoResponse = z.infer<typeof GetSiteInfoResponse>;

/**
 * `core_enrol_get_users_courses` devuelve la lista pelada de cursos, sin
 * envoltorio. Es el punto de partida para saber sobre qué cursos preguntar.
 */
export const GetUserCoursesResponse = z.array(
  z.object({
    id: z.number(),
    shortname: z.string().optional(),
    fullname: z.string().optional(),
  }),
);
export type GetUserCoursesResponse = z.infer<typeof GetUserCoursesResponse>;

/**
 * `mod_forum_get_forums_by_courses` también devuelve un array pelado, con un
 * foro por elemento. `numdiscussions` es lo más parecido a "cuántas
 * intervenciones hay" que ofrece Moodle sin bajarse los debates uno a uno.
 */
export const GetForumsResponse = z.array(
  z.object({
    id: z.number(),
    course: z.number(),
    name: z.string(),
    cmid: z.number().optional(),
    type: z.string().optional(),
    numdiscussions: z.number().optional(),
  }),
);
export type GetForumsResponse = z.infer<typeof GetForumsResponse>;

/**
 * Orden «por fecha de creación, ascendente» de `mod_forum_get_forum_discussions`.
 * Es el valor de `discussion_list::SORTORDER_CREATED_ASC` en Moodle 3.7+, y se
 * elige porque es el único orden estable para paginar: la fecha de creación no
 * cambia nunca, mientras que con el orden por defecto —último mensaje primero—
 * una respuesta escrita a mitad del recorrido reordena la lista y hace que un
 * debate salga dos veces o ninguna.
 */
export const SORTORDER_CREATED_ASC = 4;

/**
 * Un debate tal y como lo devuelven tanto `mod_forum_get_forum_discussions`
 * (3.7+) como su antecesora `_paginated`: las dos entregan el primer mensaje
 * con los datos del debate pegados encima, de ahí que convivan `id` (el del
 * mensaje) y `discussion` (el del debate). Sólo se declaran los campos que Vega
 * mira; el resto lo descarta Zod. La equivalencia de formas está comprobada
 * contra el código de Moodle 3.11 (`get_forum_discussions_returns()`).
 */
export const MoodleForumDiscussion = z.object({
  id: z.number(),
  discussion: z.number().optional(),
  name: z.string().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
  userid: z.number().optional(),
  created: z.number().optional(),
  modified: z.number().optional(),
  numreplies: z.number().optional(),
});
export type MoodleForumDiscussion = z.infer<typeof MoodleForumDiscussion>;

/**
 * TODO(vega): sin verificar contra Moodle real — falta comprobar si esta
 * función devuelve además un total de debates con el que decidir cuándo parar.
 * Mientras no se sepa, el conector pagina hasta que una página venga incompleta
 * y se protege con un tope de páginas.
 */
export const GetForumDiscussionsResponse = z.object({
  discussions: z.array(MoodleForumDiscussion),
  warnings: z.array(z.object({ item: z.string().optional(), message: z.string() })).optional(),
});
export type GetForumDiscussionsResponse = z.infer<typeof GetForumDiscussionsResponse>;

/**
 * Un mensaje de un debate. `id` y `userid` son imprescindibles —sin ellos no
 * hay ni referencia estable ni autor al que atribuir la intervención—, y
 * `created` marca cuándo se escribió. El resto se declara opcional porque la
 * estructura varía entre versiones y perder un foro entero por un campo
 * decorativo que falta sería un mal negocio.
 *
 * `message` viaja en HTML, no en texto plano: quien lo consuma tiene que
 * limpiarlo antes de enseñárselo a nadie o de mandarlo al motor de IA.
 */
export const MoodleForumPost = z.object({
  id: z.number(),
  userid: z.number(),
  created: z.number(),
  discussion: z.number().optional(),
  /** `0` en el mensaje que abre el debate; el id del mensaje al que responde en el resto. */
  parent: z.number().optional(),
  modified: z.number().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
});
export type MoodleForumPost = z.infer<typeof MoodleForumPost>;

/** La respuesta de la función **anterior a 3.7** (`…_forum_discussion_posts`). */
export const GetDiscussionPostsResponse = z.object({
  posts: z.array(MoodleForumPost),
  warnings: z.array(z.object({ item: z.string().optional(), message: z.string() })).optional(),
});
export type GetDiscussionPostsResponse = z.infer<typeof GetDiscussionPostsResponse>;

/**
 * Un mensaje como lo devuelve `mod_forum_get_discussion_posts` (Moodle 3.7+),
 * que exporta cada mensaje con el autor anidado. Formas comprobadas contra el
 * exporter de Moodle 3.11 (`mod_forum\local\exporters\post`):
 *
 *  - `author.id` puede llegar `null` cuando el sitio oculta al autor (foros
 *    anónimos o de preguntas y respuestas antes de contestar);
 *  - `parentid` sólo llega en las respuestas; el mensaje raíz trae
 *    `hasparent: false` y `parentid: null`;
 *  - un mensaje borrado llega con `isdeleted: true` y un texto de relleno
 *    («este mensaje ha sido eliminado»), no desaparece de la lista.
 */
export const ModernForumPost = z.object({
  id: z.number(),
  subject: z.string().nullish(),
  message: z.string().nullish(),
  author: z.object({ id: z.number().nullish() }).nullish(),
  discussionid: z.number().nullish(),
  hasparent: z.boolean().nullish(),
  parentid: z.number().nullish(),
  timecreated: z.number().nullish(),
  isdeleted: z.boolean().nullish(),
});
export type ModernForumPost = z.infer<typeof ModernForumPost>;

export const GetModernDiscussionPostsResponse = z.object({
  posts: z.array(ModernForumPost),
  warnings: z.array(z.object({ item: z.string().optional(), message: z.string() })).optional(),
});
export type GetModernDiscussionPostsResponse = z.infer<typeof GetModernDiscussionPostsResponse>;

/**
 * Traduce un mensaje de la forma 3.7+ a la que entiende el conector, que es la
 * antigua: así la regla de producto del foro (contestar sólo la primera
 * pregunta sin responder) vive en un único sitio y no en dos dialectos.
 *
 *  - Un mensaje borrado se descarta (`null`): su contenido ya no existe y una
 *    respuesta retirada no debería contar como «alguien ya ha contestado».
 *  - Un autor oculto se conserva como `userid: -1`: la respuesta de un autor
 *    que no se puede leer sigue significando que el debate está atendido, y
 *    quien construya entregas debe descartar las preguntas sin autor real.
 */
export function normalizeModernPost(post: ModernForumPost): MoodleForumPost | null {
  if (post.isdeleted === true) return null;
  return {
    id: post.id,
    userid: post.author?.id ?? -1,
    created: post.timecreated ?? 0,
    discussion: post.discussionid ?? undefined,
    // `-1` cuando dice tener padre pero no cuál: lo único que importa aguas
    // arriba es que no es el mensaje raíz (`parent === 0`).
    parent: post.hasparent === true ? (post.parentid ?? -1) : 0,
    subject: post.subject ?? undefined,
    message: post.message ?? undefined,
  };
}

/**
 * Un campo de perfil propio de la instalación. `shortname` es la única clave
 * estable —es el nombre técnico que le puso el administrador— y por eso es lo
 * único que se exige; `name` es la etiqueta que se ve en la pantalla de Moodle y
 * puede estar traducida o cambiar sin avisar.
 *
 * TODO(vega): sin verificar contra Moodle real — falta comprobar si `value`
 * llega siempre como cadena. En los campos de tipo menú o checkbox Moodle
 * podría mandar un número, y entonces la respuesta entera dejaría de validar y
 * el conector se quedaría sin perfiles (sin romper la corrección, eso sí).
 */
export const MoodleUserCustomField = z.object({
  type: z.string().optional(),
  value: z.string().optional(),
  name: z.string().optional(),
  shortname: z.string(),
});
export type MoodleUserCustomField = z.infer<typeof MoodleUserCustomField>;

/**
 * El perfil de un usuario. Sólo `id` es obligatorio, y a propósito: Moodle
 * recorta el perfil según las capacidades del token y según los ajustes de
 * privacidad del sitio, así que un usuario del que sólo llega el `id` es una
 * respuesta legítima. Exigir aquí el nombre o el correo convertiría una
 * instalación prudente en un error de conexión.
 *
 * TODO(vega): sin verificar contra Moodle real — leer perfiles ajenos exige la
 * capacidad `moodle/user:viewalldetails`, y `email` e `idnumber` además
 * `moodle/site:viewuseridentity`. Sin ellas Moodle **no da error**: devuelve el
 * perfil recortado y se queda tan ancho, de modo que la única forma de saber si
 * el token las tiene es mirar qué campos llegan de verdad.
 */
export const MoodleUser = z.object({
  id: z.number(),
  username: z.string().optional(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  fullname: z.string().optional(),
  email: z.string().optional(),
  /** Moodle guarda dos teléfonos; `phone1` es el principal. */
  phone1: z.string().optional(),
  idnumber: z.string().optional(),
  institution: z.string().optional(),
  department: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  customfields: z.array(MoodleUserCustomField).optional(),
});
export type MoodleUser = z.infer<typeof MoodleUser>;

/**
 * `core_user_get_users_by_field` devuelve un array pelado de usuarios, uno por
 * cada id encontrado. Los ids que no existen —o que el token no puede ver— no
 * salen en la respuesta, así que puede llegar más corta de lo que se pidió sin
 * que eso sea un error.
 */
export const GetUsersByFieldResponse = z.array(MoodleUser);
export type GetUsersByFieldResponse = z.infer<typeof GetUsersByFieldResponse>;

/** Módulos de un curso. Se usa para resolver el nombre del curso del catálogo. */
export const GetCourseContentsResponse = z.array(
  z.object({
    id: z.number(),
    name: z.string().optional(),
    modules: z
      .array(
        z.object({
          id: z.number(),
          instance: z.number().optional(),
          modname: z.string(),
          name: z.string(),
        }),
      )
      .optional(),
  }),
);
export type GetCourseContentsResponse = z.infer<typeof GetCourseContentsResponse>;

// ── Cliente ─────────────────────────────────────────────────────────────────

export interface MoodleClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  /** Inyectable para poder testear sin red cuando llegue el momento. */
  readonly fetchImpl?: typeof fetch;
}

export class MoodleClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: MoodleClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /** URL del endpoint REST, útil también para depurar desde el navegador. */
  get endpoint(): string {
    return `${this.#baseUrl}${WS_PATH}`;
  }

  /**
   * Los ficheros de Moodle se sirven por `pluginfile.php` y hay que firmarlos
   * con el mismo token; sin él la descarga devuelve el login en HTML.
   */
  signFileUrl(fileUrl: string): string {
    const separator = fileUrl.includes('?') ? '&' : '?';
    return `${fileUrl}${separator}token=${encodeURIComponent(this.#token)}`;
  }

  async call<T>(wsfunction: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const body = new URLSearchParams({
      wstoken: this.#token,
      wsfunction,
      moodlewsrestformat: 'json',
    });
    for (const [key, value] of flatten(params)) body.append(key, value);

    let response: Response;
    try {
      response = await this.#fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (cause) {
      // DNS, TLS, timeout, host caído: el token puede ser perfectamente bueno.
      throw new LmsUnavailableError(
        `No se ha podido contactar con Moodle en ${this.endpoint}. Comprueba la dirección y que el servidor esté accesible.`,
        { cause },
      );
    }

    if (!response.ok) {
      throw httpFailure(response.status, wsfunction);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      // Un HTTP 200 que no es JSON casi siempre es la página de login o la de
      // mantenimiento de Moodle servida en lugar del web service.
      throw new LmsUnavailableError(
        `Moodle ha devuelto una respuesta que no es JSON al llamar a ${wsfunction}. Comprueba que los web services están activados en el sitio.`,
        { cause },
      );
    }

    const error = MoodleError.safeParse(payload);
    if (error.success) {
      throw moodleFailure(error.data, wsfunction);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // Que la forma no cuadre no es culpa de la credencial: o es otra versión
      // de Moodle, o un plugin que altera la respuesta. Reintentar es inútil,
      // pero mandar al profesor a revisar el token lo sería todavía más.
      throw new LmsUnavailableError(
        `Moodle ha devuelto algo inesperado al llamar a ${wsfunction}: la respuesta no tiene la forma que Vega espera.`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  async downloadFile(fileUrl: string): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.#fetch(this.signFileUrl(fileUrl));
    } catch (cause) {
      throw new LmsUnavailableError(
        'No se ha podido contactar con Moodle para descargar la entrega. Vuelve a intentarlo en unos minutos.',
        { cause },
      );
    }
    if (!response.ok) {
      throw httpFailure(response.status, 'la descarga de la entrega');
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

/**
 * Errorcodes de Moodle que significan "esta credencial no vale". La lista
 * explícita cubre los habituales; la heurística por subcadena existe porque
 * cada plugin inventa los suyos y es preferible mandar al profesor a Ajustes
 * de más que enseñarle un "reinténtalo" que nunca va a funcionar.
 */
const AUTH_ERRORCODES = new Set([
  'invalidtoken',
  'accessexception',
  'invalidlogin',
  'requireloginerror',
  'nopermissions',
  'accessdenied',
]);

function isAuthErrorcode(errorcode: string): boolean {
  const lower = errorcode.toLowerCase();
  if (AUTH_ERRORCODES.has(lower)) return true;
  return ['token', 'permission', 'access'].some((needle) => lower.includes(needle));
}

/** Moodle contesta a un token malo con 401/403; el resto son caídas suyas. */
function httpFailure(status: number, what: string): LmsAuthError | LmsUnavailableError {
  if (status === 401 || status === 403) {
    return new LmsAuthError(
      `Moodle ha rechazado el token (HTTP ${status}) en ${what}. Genera uno nuevo en Moodle y actualízalo en Ajustes.`,
    );
  }
  return new LmsUnavailableError(
    `Moodle ha respondido con un error ${status} en ${what}. Vuelve a intentarlo en unos minutos.`,
  );
}

/** Los errores de Moodle llegan con HTTP 200: manda el `errorcode`, no el estado. */
function moodleFailure(error: MoodleError, wsfunction: string): LmsAuthError | LmsUnavailableError {
  if (isAuthErrorcode(error.errorcode)) {
    /**
     * `accessexception` con un token que Moodle acepta casi siempre significa
     * que **la función no está en el servicio**, no que el token esté mal: al
     * crear un servicio externo, Moodle no añade ninguna función sola y hay que
     * listarlas una a una. Decir «revisa el token» manda a mirar donde no es y
     * cuesta una tarde, así que el mensaje nombra la función y dónde añadirla.
     */
    const hint =
      error.errorcode === 'accessexception'
        ? `Lo más habitual es que «${wsfunction}» no esté añadida al servicio web del token: compruébalo en Moodle, en Administración del sitio → Servidor → Servicios web → Servicios externos → Funciones. Si está, revisa que el usuario dueño del token tenga la capacidad webservice/rest:use y esté autorizado en el servicio.`
        : 'Revisa el token y sus permisos en Moodle.';
    return new LmsAuthError(
      `Moodle ha rechazado la llamada a ${wsfunction} (${error.errorcode}): ${error.message}. ${hint}`,
    );
  }
  return new LmsUnavailableError(
    `Moodle ha rechazado la llamada a ${wsfunction} (${error.errorcode}): ${error.message}`,
  );
}

/**
 * Moodle no entiende JSON en el cuerpo: espera `clave[0]=valor` para los arrays
 * y `clave[sub]=valor` para los objetos anidados (`plugindata`, por ejemplo).
 */
export function flatten(params: Record<string, unknown>, prefix = ''): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    const name = prefix === '' ? key : `${prefix}[${key}]`;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          entries.push(...flatten(item as Record<string, unknown>, `${name}[${index}]`));
        } else {
          entries.push([`${name}[${index}]`, String(item)]);
        }
      });
    } else if (typeof value === 'object') {
      entries.push(...flatten(value as Record<string, unknown>, name));
    } else {
      entries.push([name, String(value)]);
    }
  }
  return entries;
}
