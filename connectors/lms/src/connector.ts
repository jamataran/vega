import type { DiscoveredActivity } from '@vega/shared';
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
 * La interfaz mínima que tiene que cumplir cualquier LMS para hablar con Vega.
 * Cinco operaciones: qué actividades hay, qué hay pendiente en una, tráemelo,
 * publica la nota y publica el PDF de feedback. Cuanto más pequeña sea, más
 * fácil es que alguien mande una PR con su propio LMS.
 */
export interface LmsConnector {
  /** Nombre con el que se registra: `"mock"`, `"filesystem"`, `"moodle3"`. */
  readonly name: string;

  /**
   * Actividades que existen en el LMS, entregas y foros. Es lo que permite al
   * profesor elegir a cuáles reacciona Vega: la pantalla de alta de
   * actividades se pinta con esto. `alreadyImported` lo decide Vega, no el
   * conector, que no sabe qué hay dado de alta; los conectores lo devuelven a
   * `false` y la capa de aplicación lo corrige.
   */
  listActivities(): Promise<DiscoveredActivity[]>;

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
   */
  publishGrade(ref: SubmissionRef, grade: RemoteGrade): Promise<void>;

  /** Publica el PDF (o markdown) de corrección junto a la entrega. */
  publishFeedbackFile(ref: SubmissionRef, file: FeedbackFile): Promise<void>;
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
