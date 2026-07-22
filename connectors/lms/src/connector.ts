import type { DiscoveredActivity, DiscoveredCourse } from '@vega/shared';
import type {
  ActivityRef,
  DownloadedFile,
  FeedbackFile,
  LmsConnectionInfo,
  LmsConnectorConfig,
  RemoteGrade,
  RemoteReply,
  RemoteSubmission,
  SubmissionRef,
} from './types.js';

/**
 * La interfaz mínima que tiene que cumplir cualquier LMS para hablar con Vega.
 * Ocho operaciones: comprueba que la credencial vale, qué cursos hay, qué
 * actividades hay en uno, qué hay pendiente en una, tráemelo, publica la nota,
 * publica el PDF de feedback y responde a una duda de foro. Cuanto más pequeña
 * sea, más fácil es que alguien mande una PR con su propio LMS.
 *
 * Las dos últimas **escriben en el LMS**: son las únicas que un alumno llega a
 * ver, y las únicas que no se pueden ensayar sin consecuencias. Ver
 * `verifyConnection()`.
 */
export interface LmsConnector {
  /** Nombre con el que se registra: `"mock"`, `"filesystem"`, `"moodle3"`. */
  readonly name: string;

  /**
   * Cursos que ve la credencial configurada. Es el primer paso del alta de
   * actividades porque una instalación real tiene decenas de cursos, y un
   * catálogo completo obliga al LMS a resolver las actividades de todos ellos
   * para que el profesor mire uno: no escala en tiempo de respuesta y tampoco
   * en la pantalla, donde encontrar la entrega de esta semana entre cientos es
   * peor que elegir el curso primero.
   */
  listCourses(): Promise<DiscoveredCourse[]>;

  /**
   * Comprueba que la credencial sirve y devuelve con quién y contra qué se ha
   * conectado. Existe porque el fallo más probable en producción no es un bug
   * sino un token caducado, revocado o sin permisos, y el profesor necesita
   * distinguir "el token no vale, ve a Ajustes" de "Moodle no responde,
   * reinténtalo": la primera la arregla él y la segunda sólo pide esperar.
   * Los conectores señalan esa diferencia con `LmsAuthError` y
   * `LmsUnavailableError`, aquí y en el resto de operaciones.
   */
  verifyConnection(): Promise<LmsConnectionInfo>;

  /**
   * Actividades del curso indicado, entregas y foros. Sin curso devuelve las de
   * todos, que puede ser caro: úsalo sólo cuando de verdad haga falta el
   * catálogo entero. Es lo que permite al profesor elegir a cuáles reacciona
   * Vega: la pantalla de alta de actividades se pinta con esto.
   * `alreadyImported` lo decide Vega, no el conector, que no sabe qué hay dado
   * de alta; los conectores lo devuelven a `false` y la capa de aplicación lo
   * corrige.
   */
  listActivities(moodleCourseId?: string): Promise<DiscoveredActivity[]>;

  /** Entregas disponibles en una actividad. No descarga nada todavía. */
  listSubmissions(activityRef: ActivityRef): Promise<RemoteSubmission[]>;

  /**
   * Descarga el fichero del alumno. Sólo tiene sentido en actividades con
   * entrega: en un foro el contenido ya viaja en `RemoteSubmission.textContent`.
   */
  download(ref: SubmissionRef): Promise<DownloadedFile>;

  /**
   * Publica la nota validada. Sólo se llama tras la validación explícita del
   * profesor: nada llega al alumno sin que él lo apruebe.
   *
   * **Sólo en actividades con entrega.** Un foro no tiene libro de notas, y
   * un conector que reciba aquí una referencia de foro debe rechazarla en vez
   * de apañárselas: publicar una respuesta como si fuera una calificación es
   * exactamente el error que HU-20 (RN-4) prohíbe.
   */
  publishGrade(ref: SubmissionRef, grade: RemoteGrade): Promise<void>;

  /** Publica el PDF (o markdown) de corrección junto a la entrega. */
  publishFeedbackFile(ref: SubmissionRef, file: FeedbackFile): Promise<void>;

  /**
   * Publica la respuesta validada a una duda de foro, como mensaje colgando de
   * la pregunta del alumno.
   *
   * Es la octava operación de la interfaz y rompe la promesa de mínimos del
   * [ADR 0006](../../../docs/decisiones/0006-conectores-lms-interfaz-minima.md),
   * que el [ADR 0009](../../../docs/decisiones/0009-interfaz-lms-siete-operaciones.md)
   * ya había estirado. La alternativa era generalizar `publishGrade` a un
   * `publishOutcome` que decidiera según el `kind`, y eso mete una decisión de
   * dominio —qué significa publicar en cada tipo de actividad— dentro del
   * conector, que es el sitio donde peor se prueba y donde nadie la busca.
   * Dos verbos distintos para dos cosas distintas.
   *
   * Un conector que no sepa escribir en foros debe rechazar la llamada con un
   * mensaje que lo diga; la capa de publicación lo cuenta como publicación
   * incompleta y se lo explica al profesor.
   */
  publishForumReply(ref: SubmissionRef, reply: RemoteReply): Promise<void>;
}

export type LmsConnectorFactory = (config: LmsConnectorConfig) => LmsConnector;

/**
 * Registro de conectores. Está aquí, y no en cada paquete, para que
 * `@vega/connector-lms` no dependa de sus implementaciones: la dependencia va
 * siempre de la implementación hacia la interfaz, nunca al revés.
 */
const registry = new Map<string, LmsConnectorFactory>();

export function registerConnector(name: string, factory: LmsConnectorFactory): void {
  registry.set(name, factory);
}

export function availableConnectors(): string[] {
  return [...registry.keys()].sort();
}

export function createConnector(name: string, config: LmsConnectorConfig = {}): LmsConnector {
  const factory = registry.get(name);
  if (factory === undefined) {
    throw new Error(
      `Conector LMS desconocido: "${name}". Registrados: ${availableConnectors().join(', ') || 'ninguno'}.`,
    );
  }
  return factory(config);
}
