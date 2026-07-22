import type { DiscoveredActivity, DiscoveredCourse } from '@vega/shared';
import { hasStudentFile } from '@vega/shared';
import type { LmsConnector, LmsConnectorFactory } from './connector.js';
import type {
  ActivityRef,
  DownloadedFile,
  FeedbackFile,
  LmsConnectionInfo,
  LmsConnectorConfig,
  RemoteGrade,
  RemoteStudent,
  RemoteSubmission,
  SubmissionRef,
} from './types.js';

/**
 * Conector simulado en memoria: el que se usa por defecto en desarrollo. No
 * toca disco ni red, y genera siempre las mismas actividades y las mismas
 * entregas para que la cola de revisión no cambie entre recargas.
 *
 * Lo publicado se guarda en memoria y se puede consultar con `publishedGrades`
 * y `publishedFiles`, que es como se comprueba en los tests de la API que una
 * validación acaba efectivamente en el LMS.
 */

/** Fecha base fija: sin ella, "hace dos días" cambiaría en cada ejecución. */
const BASE_DATE = Date.UTC(2026, 0, 15, 8, 0, 0);

const COURSE_MORNING = 'Academia Hipatia · Secundaria Matemáticas · Grupo de mañana';
const COURSE_AFTERNOON = 'Academia Hipatia · Secundaria Matemáticas · Grupo de tarde';
const COURSE_PREP = 'Academia Hipatia · Preparación de oposiciones';

/**
 * Ids de curso fijos, en el rango en el que Moodle los reparte de verdad. Que
 * no cambien entre arranques es lo que permite guardar el curso elegido en la
 * URL o en la base de datos de desarrollo sin que apunte a otro sitio mañana.
 */
const COURSE_ID_MORNING = '101';
const COURSE_ID_AFTERNOON = '102';
const COURSE_ID_PREP = '103';

const COURSES: readonly DiscoveredCourse[] = [
  { moodleCourseId: COURSE_ID_MORNING, name: COURSE_MORNING, shortName: 'MAT-2-MAÑANA' },
  { moodleCourseId: COURSE_ID_AFTERNOON, name: COURSE_AFTERNOON, shortName: 'MAT-2-TARDE' },
  { moodleCourseId: COURSE_ID_PREP, name: COURSE_PREP, shortName: 'OPO-SEC-MAT' },
];

/**
 * Catálogo de actividades "que hay en Moodle". Dos entregas y un foro por la
 * mañana, una entrega y un foro por la tarde, y un simulacro de oposiciones:
 * suficiente para que la pantalla de alta de actividades tenga con qué
 * probarse, incluidos varios cursos y los dos tipos.
 */
const CATALOGUE: readonly Omit<DiscoveredActivity, 'alreadyImported'>[] = [
  {
    moodleRef: 'assign-tema04',
    name: 'Tema 04 · Derivadas y aplicaciones',
    kind: 'assignment',
    moodleCourseId: COURSE_ID_MORNING,
    courseName: COURSE_MORNING,
    pendingCount: 6,
  },
  {
    moodleRef: 'assign-problema12',
    name: 'Problema 12 · Integrales definidas y áreas',
    kind: 'assignment',
    moodleCourseId: COURSE_ID_MORNING,
    courseName: COURSE_MORNING,
    pendingCount: 4,
  },
  {
    moodleRef: 'forum-didactica',
    name: 'Foro · Didáctica: ¿límite antes que derivada?',
    kind: 'forum',
    moodleCourseId: COURSE_ID_MORNING,
    courseName: COURSE_MORNING,
    pendingCount: 3,
  },
  {
    moodleRef: 'assign-tema07',
    name: 'Tema 07 · Límites y continuidad',
    kind: 'assignment',
    moodleCourseId: COURSE_ID_AFTERNOON,
    courseName: COURSE_AFTERNOON,
    pendingCount: 5,
  },
  {
    moodleRef: 'forum-dudas-analisis',
    name: 'Foro · Dudas de análisis entre compañeros',
    kind: 'forum',
    moodleCourseId: COURSE_ID_AFTERNOON,
    courseName: COURSE_AFTERNOON,
    pendingCount: 4,
  },
  {
    moodleRef: 'assign-simulacro-global',
    name: 'Simulacro global · Convocatoria de junio',
    kind: 'assignment',
    moodleCourseId: COURSE_ID_PREP,
    courseName: COURSE_PREP,
    pendingCount: 8,
  },
  {
    moodleRef: 'forum-evaluacion',
    name: 'Foro · El error como recurso de evaluación',
    kind: 'forum',
    moodleCourseId: COURSE_ID_PREP,
    courseName: COURSE_PREP,
    pendingCount: 2,
  },
];

/**
 * Intervenciones simuladas de foro. Se reparten por alumno, de modo que dos
 * alumnos de un mismo foro no entregan el mismo texto: es lo que hace creíble
 * la cola cuando se prueba la corrección de foros.
 */
const FORUM_POSTS: readonly string[] = [
  `No estoy del todo de acuerdo con lo que plantea Marta más arriba. Ella defiende cerrar el bloque de límites antes de tocar la derivada, y el argumento se entiende: la derivada se define como un límite.

Pero en el aula ese orden tiene un coste. Después de seis sesiones resolviendo indeterminaciones, el alumnado maneja una técnica que no sabe para qué sirve. A mí me funciona mejor introducir la tasa de variación media con un contexto físico, dejar que aparezca la necesidad del límite, y formalizarlo entonces.`,

  `Sobre lo que dice Javier de que GeoGebra "les quita el trabajo", creo que mezcla dos cosas.

Una es usar el software para evitar el cálculo, y ahí le doy la razón. Otra es usarlo para comprobar lo que ya han hecho a mano: yo les pido el estudio completo de la función en papel y sólo después les dejo contrastarlo. El error lo localizan ellos, no yo con el boli rojo, y en un grupo de treinta eso es difícil de conseguir de otra manera.`,

  `Yo defiendo que en segundo de Bachillerato hay que demostrar, pero no todo.

Hay demostraciones que explican por qué el resultado es cierto (la derivada del producto, Rolle apoyado en un dibujo) y otras puramente técnicas que sólo se memorizan. Las primeras merecen tiempo de clase. Le respondo así a Lucía, que decía que sin demostraciones esto es un recetario: de acuerdo, pero el recetario también aparece cuando demuestras todo y lo copian sin entenderlo.`,

  `Quería aportar algo al hilo que abrió Andrés sobre los errores recurrentes.

En mi grupo el error más repetido no es de cálculo, es de notación: enlazan la derivada y el resultado con signos de igual que no se sostienen. Antes lo corregía tachando; ahora proyecto dos o tres desarrollos anónimos y son ellos los que buscan dónde se rompe la cadena. Lo que noto no es que dejen de cometerlo, sino que lo detectan al releerse.`,

  `Sobre la distinción entre ejercicio y problema que planteaba Nuria: es útil, pero se está usando como si fuera una propiedad de la tarea y depende de quién la resuelve.

Un sistema de ecuaciones es un ejercicio para quien tiene el método automatizado y un problema para quien aún debe decidir qué hacer. No creo que haya que sustituir unos por otros, sino cuidar el momento. Lo que sí cambiaría es el peso en la evaluación.`,
];

/**
 * Perfiles simulados. Se reparten por índice de alumno y no al azar: la maqueta
 * tiene que enseñar siempre lo mismo para que una captura de pantalla de ayer
 * siga valiendo hoy, y para que las pruebas puedan afirmar algo concreto.
 *
 * `ccaa` y `provincia` imitan los campos de perfil que el cliente tiene dados de
 * alta en su Moodle. El de Andrés lleva **dos comunidades separadas por `', '`**
 * porque así es exactamente como las guarda su sistema: no es un caso raro, es
 * el formato, y la interfaz tiene que poder enseñarlo sin partirse.
 *
 * `nif` es un dato personal que aquí está sólo para poder comprobar que **no**
 * acaba en el prompt del modelo. Los valores son deliberadamente imposibles.
 */
interface MockStudentProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly username: string;
  readonly email: string;
  /** `null` en alguno a propósito: un perfil incompleto es lo normal. */
  readonly phone: string | null;
  readonly city: string;
  readonly ccaa: string;
  readonly provincia: string;
  readonly nif: string;
}

const STUDENT_PROFILES: readonly MockStudentProfile[] = [
  {
    firstName: 'Lucía',
    lastName: 'Serrano Peña',
    username: 'lserrano',
    email: 'lucia.serrano@ejemplo.invalid',
    phone: '+34 600 000 001',
    city: 'Granada',
    ccaa: 'Andalucía',
    provincia: 'Granada',
    nif: '00000001X',
  },
  {
    firstName: 'Andrés',
    lastName: 'Iglesias Roldán',
    username: 'aiglesias',
    email: 'andres.iglesias@ejemplo.invalid',
    phone: null,
    city: 'Toledo',
    // Dos comunidades en un solo campo: el formato real del cliente.
    ccaa: 'Comunidad de Madrid, Castilla-La Mancha',
    provincia: 'Toledo',
    nif: '00000002X',
  },
  {
    firstName: 'Nuria',
    lastName: 'Bermejo Cañas',
    username: 'nbermejo',
    email: 'nuria.bermejo@ejemplo.invalid',
    phone: '+34 600 000 003',
    city: 'Valencia',
    ccaa: 'Comunitat Valenciana',
    provincia: 'Valencia',
    nif: '00000003X',
  },
  {
    firstName: 'Javier',
    lastName: 'Otxoa Ibarra',
    username: 'jotxoa',
    email: 'javier.otxoa@ejemplo.invalid',
    phone: '+34 600 000 004',
    city: 'Bilbao',
    ccaa: 'País Vasco, La Rioja',
    provincia: 'Bizkaia',
    nif: '00000004X',
  },
  {
    firstName: 'Marta',
    lastName: 'Feijóo Lens',
    username: 'mfeijoo',
    email: 'marta.feijoo@ejemplo.invalid',
    phone: '+34 600 000 005',
    city: 'Santiago de Compostela',
    ccaa: 'Galicia',
    provincia: 'A Coruña',
    nif: '00000005X',
  },
];

/** El centro es el mismo para todos: la academia del catálogo simulado. */
const MOCK_INSTITUTION = 'Academia Hipatia';
const MOCK_DEPARTMENT = 'Secundaria · Matemáticas';

/**
 * El perfil que le toca a un alumno. Depende sólo del índice, así que el mismo
 * `studentRef` devuelve siempre exactamente el mismo perfil, en esta actividad y
 * en cualquier otra.
 */
function mockStudent(studentRef: string, index: number): RemoteStudent {
  // El módulo hace que el catálogo aguante cualquier `submissionsPerActivity`
  // sin dejar alumnos sin perfil.
  const profile = STUDENT_PROFILES[index % STUDENT_PROFILES.length] ?? STUDENT_PROFILES[0]!;

  return {
    ref: studentRef,
    username: profile.username,
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: `${profile.firstName} ${profile.lastName}`,
    email: profile.email,
    phone: profile.phone,
    idnumber: `ALU-${String(index + 1).padStart(4, '0')}`,
    institution: MOCK_INSTITUTION,
    department: MOCK_DEPARTMENT,
    city: profile.city,
    country: 'ES',
    // Tal cual los daría el LMS, sin interpretar: los `shortname` son los que
    // usa el cliente y el conector no decide cuáles importan.
    customFields: [
      { shortname: 'CCAA', name: 'Comunidad autónoma', value: profile.ccaa },
      { shortname: 'PROVINCIA', name: 'Provincia', value: profile.provincia },
      { shortname: 'NIF', name: 'NIF', value: profile.nif },
    ],
  };
}

export interface MockLmsConnectorOptions {
  /** Entregas simuladas por actividad (por defecto 4). */
  readonly submissionsPerActivity?: number;
}

export interface PublishedGrade {
  readonly ref: SubmissionRef;
  readonly grade: RemoteGrade;
}

export interface PublishedFile {
  readonly ref: SubmissionRef;
  readonly file: FeedbackFile;
}

export class MockLmsConnector implements LmsConnector {
  readonly name = 'mock';

  readonly #perActivity: number;
  readonly #grades: PublishedGrade[] = [];
  readonly #files: PublishedFile[] = [];

  constructor(options: MockLmsConnectorOptions = {}) {
    this.#perActivity = Math.max(1, options.submissionsPerActivity ?? 4);
  }

  /** Notas publicadas hasta ahora, en orden de publicación. */
  get publishedGrades(): readonly PublishedGrade[] {
    return this.#grades;
  }

  get publishedFiles(): readonly PublishedFile[] {
    return this.#files;
  }

  listCourses(): Promise<DiscoveredCourse[]> {
    return Promise.resolve(COURSES.map((course) => ({ ...course })));
  }

  /** Nunca falla: el mock existe justo para trabajar sin credenciales. */
  verifyConnection(): Promise<LmsConnectionInfo> {
    return Promise.resolve({
      siteName: 'Moodle simulado',
      username: 'profesora.simulada',
      courseCount: COURSES.length,
      // Se devuelve el mismo parte que el conector real para que la pantalla de
      // Ajustes se pueda diseñar y revisar sin un Moodle delante.
      checks: [
        { name: 'mock.site', label: 'Identificar el token', status: 'ok' as const,
          detail: 'Moodle simulado · conectado como profesora.simulada', required: true },
        { name: 'mock.courses', label: 'Listar tus cursos', status: 'ok' as const,
          detail: `${COURSES.length} cursos`, required: true },
        { name: 'mock.assignments', label: 'Leer las entregas del curso', status: 'ok' as const,
          detail: 'Catálogo simulado', required: true },
        { name: 'mock.forums', label: 'Leer los foros del curso', status: 'ok' as const,
          detail: 'Catálogo simulado', required: true },
      ],
    });
  }

  /**
   * El conector no sabe qué actividades tiene Vega dadas de alta, así que
   * devuelve `alreadyImported: false` y deja que lo resuelva quien sí lo sabe.
   */
  listActivities(moodleCourseId?: string): Promise<DiscoveredActivity[]> {
    const selected =
      moodleCourseId === undefined
        ? CATALOGUE
        : CATALOGUE.filter((activity) => activity.moodleCourseId === moodleCourseId);
    return Promise.resolve(selected.map((activity) => ({ ...activity, alreadyImported: false })));
  }

  listSubmissions(activityRef: ActivityRef): Promise<RemoteSubmission[]> {
    // Sin `kind` explícito, se deduce del slug: es lo que permite pedir un foro
    // por su slug sin tener que construir el `ActivityRef` completo.
    const kind = activityRef.kind ?? (isForumSlug(activityRef.slug) ? 'forum' : 'assignment');
    const withFile = hasStudentFile(kind);

    const submissions = Array.from({ length: this.#perActivity }, (_unused, index) => {
      const studentRef = `alumno-${String(index + 1).padStart(4, '0')}`;
      const submittedAt = new Date(BASE_DATE + index * 3_600_000).toISOString();
      const ref = {
        activity: { ...activityRef, kind },
        studentRef,
        remoteId: `${activityRef.slug}:${studentRef}`,
      };
      const student = mockStudent(studentRef, index);

      // Un foro no trae fichero: lo que entrega el alumno es texto.
      if (!withFile) {
        const text = FORUM_POSTS[index % FORUM_POSTS.length] ?? FORUM_POSTS[0] ?? '';
        return {
          ref,
          filename: null,
          submittedAt,
          sizeBytes: text.length,
          mediaType: 'text/plain',
          textContent: text,
          student,
        };
      }

      return {
        ref,
        filename: `${activityRef.slug}-${studentRef}.pdf`,
        submittedAt,
        // Tamaño verosímil y estable: un escaneo de 3-4 folios.
        sizeBytes: 480_000 + index * 17_000,
        mediaType: 'application/pdf',
        textContent: null,
        student,
      };
    });
    return Promise.resolve(submissions);
  }

  download(ref: SubmissionRef): Promise<DownloadedFile> {
    if (ref.activity.kind === 'forum') {
      return Promise.reject(
        new Error(
          `La actividad "${ref.activity.slug}" es un foro y no tiene fichero que descargar: ` +
            'el contenido viaja en textContent de listSubmissions().',
        ),
      );
    }
    // Un PDF **de verdad**, no un fichero con cabecera de PDF. La diferencia
    // importa: la ingesta cuenta las páginas al descargar y marca la entrega en
    // `error` si no puede abrir el fichero, así que un mock inválido haría
    // fallar el camino feliz y nadie vería el circuito completo.
    return Promise.resolve({
      filename: `${ref.activity.slug}-${ref.studentRef}.pdf`,
      mediaType: 'application/pdf',
      bytes: simulatedPdf(3, `${ref.activity.slug} · ${ref.studentRef}`),
    });
  }

  publishGrade(ref: SubmissionRef, grade: RemoteGrade): Promise<void> {
    this.#grades.push({ ref, grade });
    return Promise.resolve();
  }

  publishFeedbackFile(ref: SubmissionRef, file: FeedbackFile): Promise<void> {
    this.#files.push({ ref, file });
    return Promise.resolve();
  }
}

/**
 * PDF sintético válido, escrito a mano.
 *
 * Se construye byte a byte en vez de usar una librería porque `connectors/lms`
 * es la frontera con el exterior y no debe arrastrar dependencias: `pdf-lib`
 * vive en `apps/api`, que es quien genera documentos de verdad. Aquí basta con
 * un documento que un lector de PDF acepte y del que se puedan contar páginas.
 */
export function simulatedPdf(pageCount: number, label: string): Uint8Array {
  const pages = Math.max(1, pageCount);
  const encoder = new TextEncoder();

  const objects: string[] = [];
  // 1: catálogo · 2: árbol de páginas · 3..: una página y su contenido.
  const pageIds = Array.from({ length: pages }, (_unused, index) => 3 + index * 2);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Count ${pages} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );

  for (const [index, id] of pageIds.entries()) {
    const text = `Entrega simulada · ${label} · pagina ${index + 1} de ${pages}`
      .replace(/\\/g, '')
      .replace(/[()]/g, '');
    const stream = `BT /F1 12 Tf 60 760 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> ` +
        `/Contents ${id + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return encoder.encode(body);
}

/** Convención del catálogo simulado: los foros llevan `foro`/`forum` en el slug. */
function isForumSlug(slug: string): boolean {
  const lower = slug.toLowerCase();
  return lower.includes('foro') || lower.includes('forum');
}

export const createMockConnector: LmsConnectorFactory = (config: LmsConnectorConfig) => {
  const perActivity = config['submissionsPerActivity'];
  return new MockLmsConnector(
    typeof perActivity === 'number' ? { submissionsPerActivity: perActivity } : {},
  );
};
