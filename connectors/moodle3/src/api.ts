import { z } from 'zod';

/**
 * Cliente de los web services REST de Moodle 3.
 *
 * ⚠️ NADA de este fichero se ha probado contra un Moodle real. Las URLs, los
 * nombres de función y la forma de las respuestas están sacados de la
 * documentación de Moodle 3.x, no de una ejecución. Ver los `TODO(vega)`.
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
  /** Cursos y módulos visibles para el token: de aquí sale el catálogo. */
  getCourseContents: 'core_course_get_contents',
  /** Cursos en los que el usuario del token está matriculado. */
  getUserCourses: 'core_enrol_get_users_courses',
  getAssignments: 'mod_assign_get_assignments',
  getSubmissions: 'mod_assign_get_submissions',
  /** Foros de un curso, para poder reaccionar también a los debates. */
  getForums: 'mod_forum_get_forums_by_courses',
  /** Debates de un foro; de ahí cuelgan los mensajes de cada alumno. */
  getForumDiscussions: 'mod_forum_get_forum_discussions_paginated',
  saveGrade: 'mod_assign_save_grade',
} as const;

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

    const response = await this.#fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error(`Moodle respondió ${response.status} al llamar a ${wsfunction}.`);
    }

    const payload: unknown = await response.json();

    const error = MoodleError.safeParse(payload);
    if (error.success) {
      throw new Error(
        `Moodle rechazó ${wsfunction}: ${error.data.errorcode} — ${error.data.message}`,
      );
    }

    return schema.parse(payload);
  }

  async downloadFile(fileUrl: string): Promise<Uint8Array> {
    const response = await this.#fetch(this.signFileUrl(fileUrl));
    if (!response.ok) {
      throw new Error(`No se pudo descargar el fichero de Moodle (${response.status}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
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
