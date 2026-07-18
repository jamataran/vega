import type { DiscoveredActivity } from '@vega/shared';
import { hasStudentFile } from '@vega/shared';
import type { LmsConnector, LmsConnectorFactory } from './connector.js';
import type {
  ActivityRef,
  DownloadedFile,
  FeedbackFile,
  LmsConnectorConfig,
  RemoteGrade,
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
    courseName: COURSE_MORNING,
    pendingCount: 6,
  },
  {
    moodleRef: 'assign-problema12',
    name: 'Problema 12 · Integrales definidas y áreas',
    kind: 'assignment',
    courseName: COURSE_MORNING,
    pendingCount: 4,
  },
  {
    moodleRef: 'forum-didactica',
    name: 'Foro · Didáctica: ¿límite antes que derivada?',
    kind: 'forum',
    courseName: COURSE_MORNING,
    pendingCount: 3,
  },
  {
    moodleRef: 'assign-tema07',
    name: 'Tema 07 · Límites y continuidad',
    kind: 'assignment',
    courseName: COURSE_AFTERNOON,
    pendingCount: 5,
  },
  {
    moodleRef: 'forum-dudas-analisis',
    name: 'Foro · Dudas de análisis entre compañeros',
    kind: 'forum',
    courseName: COURSE_AFTERNOON,
    pendingCount: 4,
  },
  {
    moodleRef: 'assign-simulacro-global',
    name: 'Simulacro global · Convocatoria de junio',
    kind: 'assignment',
    courseName: COURSE_PREP,
    pendingCount: 8,
  },
  {
    moodleRef: 'forum-evaluacion',
    name: 'Foro · El error como recurso de evaluación',
    kind: 'forum',
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

  /**
   * El conector no sabe qué actividades tiene Vega dadas de alta, así que
   * devuelve `alreadyImported: false` y deja que lo resuelva quien sí lo sabe.
   */
  listActivities(): Promise<DiscoveredActivity[]> {
    return Promise.resolve(
      CATALOGUE.map((activity) => ({ ...activity, alreadyImported: false })),
    );
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
    // PDF mínimo válido: suficiente para que el visor no proteste en la maqueta.
    const body = `%PDF-1.4\n% Entrega simulada de ${ref.studentRef} en ${ref.activity.slug}\n%%EOF\n`;
    return Promise.resolve({
      filename: `${ref.activity.slug}-${ref.studentRef}.pdf`,
      mediaType: 'application/pdf',
      bytes: new TextEncoder().encode(body),
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
