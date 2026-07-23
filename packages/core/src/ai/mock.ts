import { hasStudentFile } from '@vega/shared';
import type {
  PointsAllocation,
  TranscriptionFlag,
  TranscriptionFlagKind,
  TranscriptionPage,
} from '@vega/shared';
import { estimateCostCents } from '../cost/pricing.js';
import type {
  AiCallOptions,
  AiProvider,
  GradedItem,
  GradeInput,
  GradeResult,
  TriageInput,
  TriageResult,
  TranscribeInput,
  TranscribeResult,
  VerifyInput,
  VerifyResult,
  VerifyConnectionResult,
} from './provider.js';

/**
 * Proveedor simulado. Es el que se usa por defecto en desarrollo y en los
 * tests, así que su contrato más importante no es "parecer real" sino ser
 * **determinista**: la misma entrega produce siempre exactamente la misma
 * transcripción y la misma corrección. Sin eso no se pueden escribir tests de
 * regresión ni comparar dos ejecuciones del lote nocturno.
 */

// ── PRNG ────────────────────────────────────────────────────────────────────

/**
 * mulberry32: 32 bits de estado, distribución suficientemente buena para
 * decidir qué ejercicio toca. No usamos `Math.random()` porque necesitamos
 * reproducibilidad, y no traemos una dependencia por doce líneas de código.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a de 32 bits: convierte el id de la entrega en la semilla del PRNG. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface Rng {
  next(): number;
  /** Entero en [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

function makeRng(seedText: string): Rng {
  const next = mulberry32(hashSeed(seedText));
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(items: readonly T[]): T => {
      // `items` nunca está vacío en este módulo; el `?? items[0]!` es para
      // contentar a noUncheckedIndexedAccess sin envolver todo en guardas.
      const index = Math.floor(next() * items.length);
      return items[index] ?? (items[0] as T);
    },
    chance: (probability) => next() < probability,
  };
}

// ── Banco de ejercicios ─────────────────────────────────────────────────────

/**
 * Un fallo típico con su penalización. El descuento va aparte del texto porque
 * la nota se calcula a partir de él: si el comentario dice «−0,5», el apartado
 * pierde medio punto de verdad. Un feedback que no cuadra con la nota es lo
 * primero que un profesor detecta como "esto lo ha escrito una máquina".
 */
interface Fault {
  readonly penalty: number;
  readonly text: string;
}

/**
 * Lo que hace falta para corregir un apartado, venga de una entrega o de un
 * foro: de qué va, qué se dice cuando está bien y qué se dice cuando falla.
 * Entregas y foros comparten mecanismo de corrección, así que comparten forma.
 */
interface GradingMaterial {
  readonly topic: string;
  readonly statement: string;
  /** Comentarios de profesor cuando el apartado está bien. */
  readonly praise: readonly string[];
  readonly faults: readonly Fault[];
}

interface Exercise extends GradingMaterial {
  /** Desarrollo del alumno, línea a línea, en LaTeX. */
  readonly lines: readonly string[];
}

const EXERCISES: readonly Exercise[] = [
  {
    topic: 'derivadas',
    statement: 'Deriva y simplifica la función racional dada.',
    lines: [
      'f(x)=\\displaystyle\\frac{x^{2}+1}{x-3}',
      "f'(x)=\\displaystyle\\frac{2x(x-3)-(x^{2}+1)}{(x-3)^{2}}",
      "f'(x)=\\displaystyle\\frac{2x^{2}-6x-x^{2}-1}{(x-3)^{2}}",
      "f'(x)=\\displaystyle\\frac{x^{2}-6x-1}{(x-3)^{2}}",
    ],
    praise: [
      'Aplica correctamente la regla del cociente y simplifica el numerador sin errores. Apartado completo.',
      'Derivada bien planteada y bien simplificada; además indica el dominio de la derivada. Muy bien.',
    ],
    faults: [
      { penalty: 0.25, text: 'Aplica bien la regla del cociente pero se olvida de simplificar el denominador; −0,25.' },
      { penalty: 0.5, text: 'Confunde el signo al desarrollar el numerador y arrastra el error hasta el resultado final; −0,5.' },
      { penalty: 0.25, text: 'Deriva bien pero no indica que hay que excluir x = 3 del dominio; −0,25.' },
    ],
  },
  {
    topic: 'derivadas',
    statement: 'Deriva la función compuesta aplicando la regla de la cadena.',
    lines: [
      'y=\\ln\\left(\\sqrt{1+x^{2}}\\right)=\\tfrac{1}{2}\\ln(1+x^{2})',
      "y'=\\tfrac{1}{2}\\cdot\\displaystyle\\frac{2x}{1+x^{2}}",
      "y'=\\displaystyle\\frac{x}{1+x^{2}}",
    ],
    praise: [
      'Usa la propiedad del logaritmo antes de derivar, lo que le ahorra la regla de la cadena doble. Resolución limpia.',
      'Regla de la cadena bien aplicada y simplificación correcta. Apartado perfecto.',
    ],
    faults: [
      { penalty: 0.5, text: 'Olvida el factor 1/2 que sale de la raíz y el resultado queda al doble; −0,5.' },
      { penalty: 0.25, text: 'Deriva correctamente pero deja el resultado sin simplificar; −0,25.' },
    ],
  },
  {
    topic: 'integrales',
    statement: 'Resuelve la integral por partes.',
    lines: [
      '\\displaystyle\\int x\\,e^{x}\\,dx',
      'u=x\\;\\Rightarrow\\;du=dx \\qquad dv=e^{x}dx\\;\\Rightarrow\\;v=e^{x}',
      '\\displaystyle\\int x\\,e^{x}\\,dx = x\\,e^{x}-\\int e^{x}\\,dx',
      '= x\\,e^{x}-e^{x}+C = e^{x}(x-1)+C',
    ],
    praise: [
      'Elige bien u y dv, desarrolla las partes con orden y saca factor común al final. Resultado correcto.',
      'Integración por partes impecable, incluida la constante de integración.',
    ],
    faults: [
      { penalty: 0.25, text: 'Plantea bien la integración por partes pero olvida la constante de integración; −0,25.' },
      { penalty: 1, text: 'Intercambia u y dv, lo que complica la integral en lugar de simplificarla; no llega al resultado; −1.' },
    ],
  },
  {
    topic: 'integrales',
    statement: 'Resuelve la integral racional descomponiendo en fracciones simples.',
    lines: [
      '\\displaystyle\\int \\frac{2x+3}{x^{2}+x-2}\\,dx',
      'x^{2}+x-2=(x+2)(x-1)',
      '\\displaystyle\\frac{2x+3}{(x+2)(x-1)}=\\frac{A}{x+2}+\\frac{B}{x-1}',
      'A=\\tfrac{1}{3},\\qquad B=\\tfrac{5}{3}',
      '=\\tfrac{1}{3}\\ln|x+2|+\\tfrac{5}{3}\\ln|x-1|+C',
    ],
    praise: [
      'Factoriza bien el denominador, calcula A y B correctamente y no olvida los valores absolutos en los logaritmos. Muy bien.',
      'Descomposición en fracciones simples correcta y resultado exacto.',
    ],
    faults: [
      { penalty: 0.25, text: 'Calcula bien A y B pero escribe los logaritmos sin valor absoluto; −0,25.' },
      { penalty: 1.5, text: 'Se equivoca al factorizar el denominador y toda la descomposición queda mal; −1,5.' },
    ],
  },
  {
    topic: 'límites',
    statement: 'Calcula el límite indeterminado justificando el método empleado.',
    lines: [
      '\\displaystyle\\lim_{x \\to 0}\\frac{\\operatorname{sen} x - x}{x^{3}} \\quad \\left[\\tfrac{0}{0}\\right]',
      "\\text{L'Hôpital: } \\displaystyle\\lim_{x \\to 0}\\frac{\\cos x - 1}{3x^{2}} \\quad \\left[\\tfrac{0}{0}\\right]",
      '\\displaystyle\\lim_{x \\to 0}\\frac{-\\operatorname{sen} x}{6x} = -\\tfrac{1}{6}',
    ],
    praise: [
      "Identifica la indeterminación, aplica L'Hôpital las veces necesarias y comprueba en cada paso que sigue siendo 0/0. Muy buen desarrollo.",
      'Resuelve el límite por desarrollo de Taylor en lugar de por L\'Hôpital y llega al mismo resultado con menos pasos.',
    ],
    faults: [
      {
        penalty: 0.25,
        text: "Aplica L'Hôpital sin justificar que la indeterminación es 0/0; el resultado es correcto pero falta la justificación; −0,25.",
      },
      { penalty: 0.75, text: "Deja de aplicar L'Hôpital una iteración antes y da como resultado 0; −0,75." },
    ],
  },
  {
    topic: 'límites',
    statement: 'Calcula el límite en el infinito.',
    lines: [
      '\\displaystyle\\lim_{x \\to \\infty}\\left(\\frac{3x^{2}-x}{3x^{2}+2}\\right)^{x}\\quad[1^{\\infty}]',
      '\\displaystyle\\lim_{x \\to \\infty} x\\left(\\frac{3x^{2}-x}{3x^{2}+2}-1\\right)=\\lim_{x \\to \\infty}\\frac{-x^{2}-2x}{3x^{2}+2}=-\\tfrac{1}{3}',
      '\\text{El límite vale } e^{-1/3}',
    ],
    praise: [
      'Reconoce la indeterminación 1^∞ y aplica correctamente la regla del número e. Resultado exacto.',
      'Desarrollo correcto y bien justificado en cada paso.',
    ],
    faults: [
      { penalty: 0.5, text: 'Reconoce la indeterminación pero se equivoca en el signo del exponente; −0,5.' },
      { penalty: 1, text: 'Da directamente el resultado como 1 sin desarrollar la indeterminación; −1.' },
    ],
  },
  {
    topic: 'continuidad',
    statement: 'Estudia la continuidad y determina el parámetro.',
    lines: [
      'f(x)=\\begin{cases} x^{2}+a & \\text{si } x\\le 2\\\\[2pt] \\dfrac{3x-2}{x-1} & \\text{si } x>2\\end{cases}',
      '\\displaystyle\\lim_{x \\to 2^{-}} f(x) = 4+a',
      '\\displaystyle\\lim_{x \\to 2^{+}} f(x) = \\frac{4}{1} = 4',
      '4+a = 4 \\;\\Rightarrow\\; a = 0',
    ],
    praise: [
      'Plantea correctamente los límites laterales, los iguala e interpreta el resultado. Estudio de continuidad completo.',
      'Además de calcular el parámetro, comprueba que la función es continua en todo su dominio. Muy bien.',
    ],
    faults: [
      {
        penalty: 0.25,
        text: 'Impone bien la continuidad en x = 2 y despeja el parámetro, pero no comprueba el límite por la izquierda; −0,25.',
      },
      {
        penalty: 0.5,
        text: 'Iguala los valores de la función en lugar de los límites laterales; llega al resultado por casualidad; −0,5.',
      },
    ],
  },
  {
    topic: 'aplicaciones de la derivada',
    statement: 'Estudia los extremos relativos de la función.',
    lines: [
      'f(x)=x^{3}-3x^{2}+4',
      "f'(x)=3x^{2}-6x = 3x(x-2) = 0 \\;\\Rightarrow\\; x=0,\\; x=2",
      "f''(x)=6x-6",
      "f''(0)=-6<0 \\Rightarrow \\text{máximo relativo en } (0,4)",
      "f''(2)=6>0 \\Rightarrow \\text{mínimo relativo en } (2,0)",
    ],
    praise: [
      'Calcula los puntos críticos y los clasifica con la derivada segunda. Estudio completo y bien presentado.',
      'Clasifica los extremos estudiando el signo de la primera derivada, que también es válido, y da las coordenadas completas.',
    ],
    faults: [
      {
        penalty: 0.5,
        text: 'No estudia el signo de la derivada segunda, por lo que no llega a clasificar los extremos; −0,5.',
      },
      {
        penalty: 0.25,
        text: 'Encuentra los puntos críticos pero da sólo las abscisas, sin las coordenadas del punto; −0,25.',
      },
    ],
  },
];

// ── Banco de intervenciones de foro ─────────────────────────────────────────

/**
 * Un hilo de foro con la intervención tipo de un alumno. En un foro no hay
 * fichero ni transcripción: lo que se corrige es lo que el alumno ha escrito,
 * y el feedback es cualitativo (argumentación, uso de fuentes, respuesta a los
 * compañeros), no una lista de errores de cálculo.
 *
 * `post` se usa cuando la entrega llega sin `textContent`, para que el mock
 * tenga una intervención creíble sobre la que trabajar.
 */
interface ForumTopic extends GradingMaterial {
  /** Palabras del hilo, para reconocer el tema en un `textContent` que llega de fuera. */
  readonly keywords: readonly string[];
  /** Intervención simulada del alumno. */
  readonly post: string;
}

const FORUM_TOPICS: readonly ForumTopic[] = [
  {
    topic: 'secuenciación de límite y derivada',
    statement: 'Participación en el hilo sobre el orden de los contenidos de análisis.',
    keywords: ['límite', 'limite', 'derivada', 'secuencia', 'orden'],
    post: `No estoy del todo de acuerdo con lo que plantea Marta más arriba. Ella defiende que hay que cerrar el bloque de límites antes de tocar la derivada, y entiendo el argumento: la derivada se define como un límite y parece raro usar una herramienta que el alumnado todavía no domina.

Pero yo he visto en el aula que ese orden estricto tiene un coste. Cuando dedicas seis sesiones seguidas a resolver indeterminaciones, el alumnado acaba manejando una técnica que no sabe para qué sirve, y llega a la derivada agotado. A mí me ha funcionado mejor introducir la tasa de variación media con un contexto físico (la velocidad de un móvil, por ejemplo), dejar que aparezca la necesidad del límite de forma natural, y sólo entonces formalizarlo.

No digo que haya que renunciar al rigor, sino que el límite se entiende mejor cuando responde a una pregunta que el alumnado ya se ha hecho.`,
    praise: [
      'Toma posición con claridad, reconoce el argumento del compañero antes de rebatirlo y apoya su postura en la experiencia de aula. La estructura de la intervención es la de un buen debate didáctico.',
      'Distingue bien entre el orden lógico de la materia y el orden de aprendizaje, que es justo el núcleo del hilo. Además cierra matizando, sin caer en el todo o nada.',
    ],
    faults: [
      {
        penalty: 0.5,
        text: 'La postura se defiende sólo desde la experiencia personal; falta apoyarla en alguna referencia didáctica o en el currículo vigente; −0,5.',
      },
      {
        penalty: 0.25,
        text: 'Responde al compañero pero no llega a proponer una secuencia concreta de sesiones, que es lo que pedía el enunciado del hilo; −0,25.',
      },
    ],
  },
  {
    topic: 'software dinámico frente a papel',
    statement: 'Participación en el hilo sobre el uso de GeoGebra en el aula.',
    keywords: ['geogebra', 'software', 'papel', 'calculadora', 'tecnología', 'tecnologia'],
    post: `Sobre lo que comenta Javier de que GeoGebra "les quita el trabajo": creo que mezcla dos cosas distintas.

Una es usar el software para evitar el cálculo, y ahí le doy la razón: si el alumnado arrastra el deslizador hasta que la gráfica encaja, no ha estudiado nada. Otra muy distinta es usarlo para visualizar lo que ya ha calculado a mano. En el estudio de funciones yo les pido primero el análisis completo en papel (dominio, asíntotas, monotonía) y sólo después les dejo comprobarlo en GeoGebra. El error salta a la vista y son ellos quienes lo localizan, no yo con el boli rojo.

La herramienta no sustituye al procedimiento; lo que hace es devolver la corrección de forma inmediata, y eso en un grupo de treinta es difícil de conseguir de otra manera.`,
    praise: [
      'Desmonta el argumento del compañero separando dos usos distintos de la herramienta, que es exactamente la distinción que el hilo necesitaba. Muy buena intervención.',
      'Aporta una secuencia concreta (cálculo a mano y después comprobación) y justifica por qué funciona en un grupo numeroso. Argumentación sólida y aterrizada.',
    ],
    faults: [
      {
        penalty: 0.5,
        text: 'El ejemplo de aula está bien traído, pero no se valora ningún inconveniente del uso del software, y el hilo pedía sopesar las dos caras; −0,5.',
      },
      {
        penalty: 0.25,
        text: 'La intervención es correcta aunque algo larga: las dos últimas ideas se repiten y restan fuerza al argumento; −0,25.',
      },
    ],
  },
  {
    topic: 'nivel de rigor en las demostraciones',
    statement: 'Participación en el hilo sobre demostraciones formales en Bachillerato.',
    keywords: ['demostración', 'demostracion', 'rigor', 'bachillerato', 'formal', 'teorema'],
    post: `Yo defiendo que en segundo de Bachillerato sí hay que demostrar, pero no todo y no de cualquier manera.

Hay demostraciones que explican por qué el resultado es cierto (la derivada del producto, por ejemplo, o el teorema de Rolle apoyado en un dibujo) y otras que son puramente técnicas y sólo se memorizan. Las primeras merecen el tiempo de clase; las segundas creo que se pueden enunciar y remitir al libro.

Le respondo así a Lucía, que decía que sin demostraciones la asignatura se convierte en un recetario: estoy de acuerdo en el fondo, pero el recetario también aparece cuando demuestras todo y el alumnado copia la demostración sin entenderla. El criterio que uso es si la demostración se puede seguir con una idea visual detrás; si no la hay, suele acabar en memorización.`,
    praise: [
      'Propone un criterio explícito para decidir qué se demuestra y qué no, y lo aplica a ejemplos concretos. Es una aportación que hace avanzar el hilo, no sólo una opinión.',
      'Matiza la postura de la compañera sin descalificarla y añade un contraejemplo pertinente. Nivel de argumentación muy bueno.',
    ],
    faults: [
      {
        penalty: 0.75,
        text: 'La distinción entre demostraciones "con idea visual" y "técnicas" se enuncia pero no se justifica: convendría apoyarla en algún referente de didáctica del análisis; −0,75.',
      },
      {
        penalty: 0.25,
        text: 'No cita ningún criterio de evaluación del currículo, que era una de las condiciones del hilo; −0,25.',
      },
    ],
  },
  {
    topic: 'el error como recurso didáctico',
    statement: 'Participación en el hilo sobre el tratamiento del error en el aula.',
    keywords: ['error', 'evaluación', 'evaluacion', 'corrección', 'correccion', 'examen'],
    post: `Quería aportar algo a lo que abrió Andrés sobre los errores recurrentes.

En mi grupo el error más repetido no es de cálculo, es de notación: escriben la derivada y el resultado enlazados con signos de igual que no se sostienen. Durante un tiempo lo corregía tachando; ahora dedico diez minutos de la sesión siguiente a proyectar dos o tres desarrollos anónimos (con permiso) y son ellos los que buscan dónde se rompe la cadena de igualdades.

El cambio que noto no es tanto que dejen de cometer el error como que lo detecten ellos al releerse. Y eso, de cara a una prueba escrita, vale más que la corrección individual, que muchas veces ni la leen.

Coincido con Andrés en que el error hay que aprovecharlo, pero añadiría que hay que hacerlo en público y sin señalar a nadie.`,
    praise: [
      'Identifica un error concreto y bien elegido, explica la intervención que hace en el aula y valora su efecto con honestidad. Aportación de mucha calidad.',
      'Conecta con la intervención del compañero, la amplía con una condición nueva (hacerlo en público y sin señalar) y no se limita a mostrar acuerdo. Muy bien.',
    ],
    faults: [
      {
        penalty: 0.5,
        text: 'Describe muy bien la práctica pero no ofrece ninguna evidencia de su efecto más allá de la impresión personal; −0,5.',
      },
      {
        penalty: 0.25,
        text: 'La intervención responde al compañero de forma algo tardía: las tres primeras ideas no dialogan con el hilo; −0,25.',
      },
    ],
  },
  {
    topic: 'resolución de problemas frente a ejercicios',
    statement: 'Participación en el hilo sobre problemas y ejercicios rutinarios.',
    keywords: ['problema', 'ejercicio', 'rutina', 'polya', 'competencia'],
    post: `Sobre la distinción entre ejercicio y problema que planteaba Nuria: me parece útil, pero creo que se está usando como si fuera una propiedad de la tarea, y en realidad depende de quién la resuelve.

Un sistema de ecuaciones es un ejercicio para quien ya tiene el método automatizado y un problema para quien todavía tiene que decidir qué hacer. Por eso no creo que la solución sea sustituir ejercicios por problemas, sino cuidar el momento: la fase de automatización hace falta, y si la saltas, el alumnado no tiene con qué atacar el problema después.

Lo que sí cambiaría es el peso en la evaluación. Ahora mismo, en mis pruebas, el 80 % de la nota se juega en tareas donde el método ya está dado. Ahí sí que hay margen de mejora, y en eso doy la razón a Nuria.`,
    praise: [
      'Cuestiona la premisa del hilo con un argumento fino (que la distinción depende del resolutor, no de la tarea) y aun así reconoce lo que hay de válido en la postura contraria. Excelente.',
      'Aterriza el debate en la evaluación con un dato propio y admite el margen de mejora. Intervención honesta y bien construida.',
    ],
    faults: [
      {
        penalty: 0.5,
        text: 'La idea central está bien planteada pero no llega a concretarse en ninguna propuesta de tarea, que es lo que reclamaba el hilo; −0,5.',
      },
      {
        penalty: 0.25,
        text: 'Menciona el reparto de la evaluación sin explicar cómo lo cambiaría; queda a medias; −0,25.',
      },
    ],
  },
];

/** Coletillas que ensucian el manuscrito de forma creíble. */
const ILLEGIBLE_NOTES: readonly string[] = [
  'Fragmento tachado y reescrito encima; no se distingue el exponente.',
  'La línea queda cortada por el margen de la hoja.',
  'Escritura muy comprimida en el pie de página.',
];

const DOUBT_NOTES: readonly string[] = [
  'Podría ser un 1 o un 7; se interpreta por coherencia con el paso siguiente.',
  'No queda claro si el signo es un menos o un trazo de separación.',
  'La letra puede ser una a o una alfa.',
];

/** Descuento fijo cuando el escaneo no deja leer parte del desarrollo. */
const ILLEGIBLE_PENALTY = 0.25;

/** Probabilidad de que un apartado salga impecable, cuando la página se lee bien. */
const PERFECT_RATE = 0.4;

/** Probabilidad de que un apartado con fallo acumule un segundo error. */
const SECOND_FAULT_RATE = 0.3;

// ── Proveedor ───────────────────────────────────────────────────────────────

export interface MockAiProviderOptions {
  /**
   * Retardo simulado por llamada, en milisegundos. Por defecto 0 para que los
   * tests no esperen; súbelo a 400–800 en desarrollo si quieres ver los
   * estados intermedios de la UI.
   */
  readonly delayMs?: number;
  /**
   * Modelo que se reporta. El prefijo `mock-` es intencionado: deja claro en la
   * base de datos que la corrección es simulada y, a la vez, permite estimar el
   * coste con la tarifa del modelo real (ver `cost/pricing.ts`).
   */
  readonly model?: string;
  /** Hace visible en el mock que cambiar el prompt activo cambia la siguiente salida. */
  readonly promptSalt?: string;
}

const DEFAULT_MODEL = 'mock-claude-opus-4-8';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Operación cancelada.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Elige los ejercicios de una entrega. Transcripción y corrección llaman a esta
 * función con la misma semilla, de modo que el feedback habla de los ejercicios
 * que realmente aparecen en la transcripción.
 */
function selectExercises(submissionId: string, count: number): readonly Exercise[] {
  const rng = makeRng(`${submissionId}:ejercicios`);
  const pool = [...EXERCISES];
  const chosen: Exercise[] = [];
  for (let i = 0; i < count; i += 1) {
    if (pool.length === 0) pool.push(...EXERCISES);
    const index = rng.int(0, pool.length - 1);
    const [exercise] = pool.splice(index, 1);
    if (exercise !== undefined) chosen.push(exercise);
  }
  return chosen;
}

/**
 * Elige el hilo sobre el que va la intervención. Si la entrega trae texto, se
 * reconoce el tema por sus palabras clave para que el feedback hable de lo que
 * el alumno ha escrito de verdad; si no llega texto, se elige por semilla.
 */
function selectForumTopic(submissionId: string, textContent: string | null): ForumTopic {
  const text = nonEmpty(textContent);
  if (text !== null) {
    const haystack = text.toLowerCase();
    let best: ForumTopic | undefined;
    let bestScore = 0;
    for (const topic of FORUM_TOPICS) {
      const score = topic.keywords.filter((word) => haystack.includes(word)).length;
      if (score > bestScore) {
        best = topic;
        bestScore = score;
      }
    }
    if (best !== undefined) return best;
  }
  return makeRng(`${submissionId}:foro`).pick(FORUM_TOPICS);
}

/**
 * Material de corrección de cada apartado. En una entrega, un ejercicio por
 * apartado; en un foro, la misma intervención vista desde ángulos distintos
 * (se rota por el banco para que dos apartados no repitan comentario).
 */
function selectMaterial(
  submissionId: string,
  count: number,
  forumTopic: ForumTopic | undefined,
): readonly GradingMaterial[] {
  if (forumTopic === undefined) return selectExercises(submissionId, count);
  const start = FORUM_TOPICS.indexOf(forumTopic);
  return Array.from({ length: count }, (_unused, index) =>
    index === 0
      ? forumTopic
      : (FORUM_TOPICS[(start + index) % FORUM_TOPICS.length] ?? forumTopic),
  );
}

/** Nota máxima que se supone cuando una actividad puntuable no la declara. */
const FALLBACK_MAX_SCORE = 10;

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  readonly #delayMs: number;
  readonly #model: string;
  readonly #promptSalt: string;

  constructor(options: MockAiProviderOptions = {}) {
    this.#delayMs = options.delayMs ?? 0;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#promptSalt = options.promptSalt ?? '';
  }

  async transcribe(input: TranscribeInput, options?: AiCallOptions): Promise<TranscribeResult> {
    await sleep(this.#delayMs, options?.signal);

    const rng = makeRng(`${input.submissionId}:transcripcion:${input.reading ?? 'single'}:${this.#promptSalt}`);
    const pageManifest = input.pages.flatMap((source) =>
      (source.pageNumbers ?? [source.page]).map((page) => ({ ...source, page })),
    );
    const exercises = selectExercises(input.submissionId, pageManifest.length);

    const pages: TranscriptionPage[] = [];
    const flags: TranscriptionFlag[] = [];

    pageManifest.forEach((source, index) => {
      const exercise = exercises[index] ?? EXERCISES[0]!;
      const lines = [...exercise.lines];

      // La segunda lectura trae de forma determinista algunas diferencias
      // materiales para que el pipeline de revisión se ejercite también en dev.
      if (input.reading === 'b' && rng.chance(0.35)) {
        const lineIndex = rng.int(0, lines.length - 1);
        lines[lineIndex] = `${lines[lineIndex] ?? ''}\\;[lectura\ alternativa]`;
      }

      // Una de cada cinco páginas trae algo que el OCR no ve claro. La marca va
      // FUERA de la fórmula: dentro, KaTeX la interpretaría como matemáticas.
      const marks = new Map<number, TranscriptionFlagKind>();
      if (rng.chance(0.2)) {
        const lineIndex = rng.int(1, lines.length - 1);
        const original = lines[lineIndex] ?? '';
        const kind = rng.chance(0.5) ? 'ILEGIBLE' : 'DUDA';
        marks.set(lineIndex, kind);
        flags.push({
          kind,
          page: source.page,
          excerpt: original,
          note: kind === 'ILEGIBLE' ? rng.pick(ILLEGIBLE_NOTES) : rng.pick(DOUBT_NOTES),
        });
      }

      // Ver `TranscriptionPage.latex` en @vega/shared: texto con fórmulas
      // delimitadas, no un bloque LaTeX suelto.
      const body = lines
        .map((line, lineIndex) => {
          const formula = `$$${line}$$`;
          const mark = marks.get(lineIndex);
          return mark === undefined ? formula : `${formula}\n[${mark}]`;
        })
        .join('\n\n');

      pages.push({
        page: source.page,
        latex: `**Ejercicio ${index + 1}. ${exercise.statement}**\n\n${body}`,
        imageUrl: mockPageImageUrl(source.page, `Ejercicio ${index + 1}: ${exercise.statement}`),
      });
    });

    // Cada marca resta confianza; el suelo evita que una hoja muy sucia deje la
    // transcripción en cero y desordene la cola de revisión.
    const base = 0.82 + rng.next() * 0.16;
    const confidence = clamp01(base - flags.length * 0.06);

    const inputTokens = 1_400 + pageManifest.length * 1_150 + rng.int(0, 220);
    const outputTokens = 260 + pageManifest.length * 190 + rng.int(0, 120);
    const cachedInputTokens = rng.chance(0.65) ? 1_024 + rng.int(0, 512) : 0;

    return {
      pages,
      flags,
      confidence: round2(confidence),
      model: this.#model,
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens,
        costCents: estimateCostCents(this.#model, { inputTokens, outputTokens, cachedInputTokens }),
      },
    };
  }

  async grade(input: GradeInput, options?: AiCallOptions): Promise<GradeResult> {
    await sleep(this.#delayMs, options?.signal);

    const rng = makeRng(`${input.submissionId}:correccion:${this.#promptSalt}`);

    // En un foro no hay fichero ni transcripción: lo que se corrige es lo que
    // el alumno ha escrito. Si el LMS no manda el texto, el mock se inventa una
    // intervención creíble para tener algo sobre lo que comentar.
    const forumTopic = hasStudentFile(input.activityKind)
      ? undefined
      : selectForumTopic(input.submissionId, input.textContent);
    const studentText =
      forumTopic === undefined ? null : (nonEmpty(input.textContent) ?? forumTopic.post);

    const items = input.graded ? this.#gradeItems(input, forumTopic, rng) : [];
    const obtained = items.reduce((sum, item) => sum + item.aiPoints, 0);

    const aiSummary = buildSummary({
      graded: input.graded,
      forum: forumTopic !== undefined,
      obtained,
      maxScore: input.maxScore,
      items,
      rng,
    });

    const aiLatex = buildLatex({
      graded: input.graded,
      forumTopic,
      studentText,
      obtained,
      maxScore: input.maxScore,
      items,
      // El enunciado de cada apartado lo pone el profesor en el reparto, no la
      // IA: se recupera de ahí para encabezar cada sección del documento.
      statements: new Map(input.pointsAllocation.map((entry) => [entry.label, entry.statement])),
      summary: aiSummary,
    });

    // Sin apartados que promediar (actividad no puntuable), la confianza es la
    // del documento: se apoya en cuánto texto ha escrito el alumno, porque una
    // intervención de dos líneas deja mucho menos margen para valorar.
    const meanConfidence =
      items.length > 0
        ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length
        : clamp01(0.72 + Math.min((studentText?.length ?? 0) / 4_000, 0.2) + rng.next() * 0.06);

    const textTokens = Math.round((studentText?.length ?? 0) / 4);
    const contextLength = input.context.reduce((sum, segment) => sum + segment.content.length, 0);
    const inputTokens =
      2_100 + contextLength / 4 + textTokens + items.length * 320 + rng.int(0, 260);
    const outputTokens = 420 + items.length * 210 + aiLatex.length / 5 + rng.int(0, 180);
    // El contexto de la actividad es lo que se repite entre entregas: en
    // producción se sirve casi siempre desde caché, y el mock lo refleja.
    const cachedInputTokens = rng.chance(0.8) ? Math.round(contextLength / 4) : 0;
    const usageTokens = {
      inputTokens: Math.round(inputTokens),
      outputTokens: Math.round(outputTokens),
      cachedInputTokens,
    };

    return {
      items,
      aiLatex,
      aiSummary,
      teacherNotes: input.explanations !== false
        ? 'Contrasta las marcas de lectura y las citas antes de validar la propuesta.'
        : null,
      confidence: round2(meanConfidence),
      model: this.#model,
      usage: {
        ...usageTokens,
        costCents: estimateCostCents(this.#model, usageTokens),
      },
      escalate: input.route === 'standard' && rng.chance(0.12),
      noEsDuda: forumTopic !== undefined && /gracias|entendido|de acuerdo/i.test(studentText ?? ''),
    };
  }

  /** Apartados puntuados. Sólo se llama cuando la actividad se puntúa. */
  #gradeItems(
    input: GradeInput,
    forumTopic: ForumTopic | undefined,
    rng: Rng,
  ): GradedItem[] {
    const allocation: readonly PointsAllocation[] =
      input.pointsAllocation.length > 0
        ? input.pointsAllocation
        : [
            {
              label: forumTopic !== undefined ? 'Intervención' : 'Desarrollo',
              statement:
                forumTopic !== undefined ? 'Participación en el hilo' : 'Ejercicio completo',
              maxPoints: input.maxScore ?? FALLBACK_MAX_SCORE,
            },
          ];
    const material = selectMaterial(input.submissionId, allocation.length, forumTopic);

    // Las marcas del OCR se reparten entre apartados por orden: si la página 2
    // era ilegible, el apartado 2 debe salir señalado. En un foro no hay marcas.
    const flaggedPages = new Set((input.transcription?.flags ?? []).map((flag) => flag.page));

    return allocation.map((entry, index) => {
      const exercise = material[index] ?? EXERCISES[0]!;
      const pageHadFlag = flaggedPages.has(index + 1);

      // Un apartado cuya página no se lee bien nunca sale impecable: se descuenta
      // y se marca, porque la decisión final tiene que tomarla el profesor.
      const perfect = !pageHadFlag && rng.chance(PERFECT_RATE);
      const alternativeMethod = perfect && rng.chance(0.15);

      const feedbackParts: string[] = [];
      let deduction = pageHadFlag ? ILLEGIBLE_PENALTY : 0;

      if (alternativeMethod) {
        feedbackParts.push(
          forumTopic === undefined
            ? `Método alternativo válido: resuelve el apartado de ${exercise.topic} por una vía distinta a la de la solución de referencia y llega al mismo resultado. Se da por bueno.`
            : `Enfoque alternativo válido: aborda ${exercise.topic} desde una posición distinta a la que plantea el enunciado del hilo y la sostiene con argumentos. Se da por buena.`,
        );
      } else if (perfect) {
        feedbackParts.push(rng.pick(exercise.praise));
      } else {
        // Sólo fallos que quepan en el apartado: un −1,5 sobre un apartado de
        // 1 punto delataría al instante que el descuento es de pega.
        const affordable = exercise.faults.filter((fault) => fault.penalty <= entry.maxPoints);
        const first = rng.pick(affordable.length > 0 ? affordable : exercise.faults);
        feedbackParts.push(first.text);
        deduction += first.penalty;

        const remaining = exercise.faults.filter(
          (fault) => fault !== first && fault.penalty + deduction <= entry.maxPoints,
        );
        if (remaining.length > 0 && rng.chance(SECOND_FAULT_RATE)) {
          const second = rng.pick(remaining);
          feedbackParts.push(`Además: ${lowerFirst(second.text)}`);
          deduction += second.penalty;
        }
      }

      if (pageHadFlag) {
        feedbackParts.push(
          `Parte del desarrollo no se lee con claridad en el escaneo; se descuentan ${ILLEGIBLE_PENALTY.toLocaleString('es-ES')} y se marca el apartado para revisión del profesor.`,
        );
      }

      const confidence = clamp01(
        (pageHadFlag ? 0.55 : 0.8) + rng.next() * 0.18 - (alternativeMethod ? 0.1 : 0),
      );

      return {
        label: entry.label,
        maxPoints: entry.maxPoints,
        aiPoints: round2(Math.max(0, entry.maxPoints - deduction)),
        aiFeedback: feedbackParts.join(' '),
        aiQuote:
          deduction > 0
            ? (input.transcription?.pages[index]?.latex.slice(0, 160) ??
              input.textContent?.slice(0, 160) ??
              null)
            : null,
        aiQuotePage:
          deduction > 0 && input.transcription !== null
            ? (input.transcription.pages[index]?.page ?? index + 1)
            : null,
        confidence: round2(confidence),
        alternativeMethod,
      };
    });
  }

  async triage(input: TriageInput, options?: AiCallOptions): Promise<TriageResult> {
    await sleep(this.#delayMs, options?.signal);
    const normalized = input.message.toLowerCase();
    const rng = makeRng(`${input.submissionId}:triage:${this.#promptSalt}`);
    const label = /errata|typo|corregid/.test(normalized)
      ? 'errata'
      : /fecha|plazo|entrega|horario/.test(normalized)
        ? 'administrativa'
        : /gracias|de acuerdo|entendido/.test(normalized)
          ? 'no_es_duda'
          : rng.chance(0.45)
            ? 'sencilla'
            : 'dificil';
    const confidence = label === 'dificil' && rng.chance(0.3) ? 0.64 : 0.92;
    return {
      label,
      confidence,
      reason: `Clasificación simulada y determinista: ${label}.`,
      model: this.#model,
      usage: {
        inputTokens: 120,
        outputTokens: 24,
        cachedInputTokens: 0,
        costCents: 0,
      },
    };
  }

  async verify(input: VerifyInput, options?: AiCallOptions): Promise<VerifyResult> {
    await sleep(this.#delayMs, options?.signal);
    const rng = makeRng(`${input.submissionId}:verify:${this.#promptSalt}`);
    const severe = rng.chance(0.25);
    return {
      coherent: !severe,
      issues: severe
        ? [
            {
              kind: 'score_feedback_mismatch',
              itemLabel: input.items[0]?.label ?? null,
              detail: 'El feedback describe un descuento mayor que el reflejado en la puntuación.',
            },
          ]
        : [],
      confidence: severe ? 0.91 : 0.94,
      model: this.#model,
      usage: {
        inputTokens: 360,
        outputTokens: severe ? 70 : 28,
        cachedInputTokens: 0,
        costCents: 0,
      },
    };
  }

  async verifyConnection(options?: AiCallOptions): Promise<VerifyConnectionResult> {
    await sleep(this.#delayMs, options?.signal);
    return {
      ok: true,
      message:
        'Proveedor simulado: no se ha contactado con Anthropic y no se consumen tokens. Elige el proveedor «Anthropic» y configura una clave para probar la conexión real.',
      model: this.#model,
      usage: null,
    };
  }
}

function mockPageImageUrl(page: number, text: string): string {
  const safe = escapeXmlText(text).slice(0, 180);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100"><rect width="800" height="1100" fill="#fff"/><text x="64" y="88" font-family="sans-serif" font-size="24" fill="#334155">Original simulado · página ${page}</text><foreignObject x="64" y="130" width="672" height="850"><div xmlns="http://www.w3.org/1999/xhtml" style="font:22px monospace;white-space:pre-wrap;color:#1e293b">${safe}</div></foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface SummaryOptions {
  readonly graded: boolean;
  readonly forum: boolean;
  readonly obtained: number;
  readonly maxScore: number | null;
  readonly items: readonly GradedItem[];
  readonly rng: Rng;
}

function buildSummary(options: SummaryOptions): string {
  const { rng } = options;

  // Actividad no puntuable: el resumen es cualitativo y no menciona nota, que
  // es justo lo que el profesor espera ver en la cabecera de la cola.
  if (!options.graded) {
    const opening = rng.pick(
      options.forum
        ? [
            'Intervención bien argumentada: entra en el fondo del debate y no se queda en la anécdota.',
            'Aportación correcta, que dialoga con lo que han escrito los compañeros en lugar de repetirlo.',
            'Buena participación: fija una postura, la matiza y la apoya en la experiencia de aula.',
          ]
        : [
            'Trabajo entregado en plazo y con el contenido que pedía el enunciado.',
            'La entrega cumple con lo solicitado y muestra un trabajo cuidado.',
          ],
    );
    return `${opening} Al no ser una actividad puntuable, la corrección es cualitativa y no lleva nota asociada.`;
  }

  const maxScore = options.maxScore ?? FALLBACK_MAX_SCORE;
  const ratio = maxScore > 0 ? options.obtained / maxScore : 0;
  const weakest = options.items.reduce(
    (worst, item) =>
      item.maxPoints > 0 && item.aiPoints / item.maxPoints < worst.aiPoints / worst.maxPoints
        ? item
        : worst,
    options.items[0] ?? { label: '—', aiPoints: 0, maxPoints: 1 },
  );

  const opening = options.forum
    ? ratio >= 0.9
      ? 'Participación de mucha calidad: argumenta, responde a los compañeros y aporta ejemplos propios.'
      : ratio >= 0.6
        ? 'Participación correcta, aunque algunos argumentos se quedan sin apoyar.'
        : 'La intervención entra en el tema pero le falta desarrollo y diálogo con el resto del hilo.'
    : ratio >= 0.9
      ? 'Examen muy sólido: el desarrollo está bien estructurado y justificado en casi todos los apartados.'
      : ratio >= 0.6
        ? 'Examen correcto en lo esencial, con fallos de cálculo y de justificación que conviene repasar.'
        : ratio >= 0.35
          ? 'El planteamiento general se entiende, pero hay errores de método que impiden cerrar varios apartados.'
          : 'El examen presenta carencias importantes de método; conviene volver sobre la teoría antes del siguiente simulacro.';

  const advice = rng.pick(
    options.forum
      ? [
          'Apoya al menos una de tus afirmaciones en una referencia didáctica o en el currículo.',
          'Cierra la intervención con una propuesta concreta: es lo que hace avanzar el hilo.',
        ]
      : [
          'Recuerda justificar el tipo de indeterminación antes de aplicar cualquier regla.',
          'Cuida la simplificación final: varios apartados pierden décimas por dejar el resultado a medias.',
          'Escribe siempre la constante de integración; en un examen de oposición cuenta.',
          'Presenta los resultados con la coordenada completa cuando el enunciado pide puntos.',
        ],
  );

  return `${opening} El apartado ${weakest.label} es el que más margen de mejora tiene. ${advice}`;
}

// ── Documento de corrección en LaTeX ────────────────────────────────────────

interface LatexOptions {
  readonly graded: boolean;
  readonly forumTopic: ForumTopic | undefined;
  readonly studentText: string | null;
  readonly obtained: number;
  readonly maxScore: number | null;
  readonly items: readonly GradedItem[];
  /** Enunciado de cada apartado, por etiqueta. */
  readonly statements: ReadonlyMap<string, string>;
  readonly summary: string;
}

/**
 * La corrección redactada, que es la salida de primer nivel: es lo que el
 * profesor edita y lo que se convierte en las páginas de feedback del PDF.
 *
 * Se genera SIEMPRE, se puntúe o no la actividad. Cuando no se puntúa, es la
 * única salida con valor: no hay apartados ni nota que enseñar.
 */
function buildLatex(options: LatexOptions): string {
  const forum = options.forumTopic !== undefined;

  const head = [
    '\\documentclass[11pt,a4paper]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[spanish]{babel}',
    '\\usepackage{amsmath,amssymb}',
    '\\begin{document}',
    '',
    `\\section*{${forum ? 'Valoración de tu intervención' : 'Corrección de la entrega'}}`,
    '',
  ];

  const body: string[] = [];

  if (options.forumTopic !== undefined) {
    body.push(`\\textit{Hilo: ${escapeLatex(options.forumTopic.topic)}}`, '');
  }

  if (options.graded) {
    body.push(
      `\\textbf{Calificación propuesta: ${decimal(options.obtained)} sobre ${decimal(
        options.maxScore ?? FALLBACK_MAX_SCORE,
      )}}`,
      '',
    );
  } else {
    body.push(
      'Actividad no puntuable: esta corrección es cualitativa y no lleva calificación asociada.',
      '',
    );
  }

  // La intervención del alumno se cita para que la corrección se lea sola, sin
  // tener que abrir el foro en Moodle al lado.
  const excerpt = nonEmpty(options.studentText);
  if (excerpt !== null) {
    body.push(
      '\\subsection*{Tu intervención}',
      '',
      '\\begin{quote}',
      escapeLatex(truncate(excerpt.replace(/\s*\n+\s*/g, ' '), 600)),
      '\\end{quote}',
      '',
    );
  }

  if (options.items.length > 0) {
    for (const item of options.items) {
      const statement = nonEmpty(options.statements.get(item.label));
      body.push(
        `\\subsection*{Apartado ${escapeLatex(item.label)} \\quad (${decimal(item.aiPoints)} / ${decimal(item.maxPoints)})}`,
        '',
      );
      if (statement !== null) body.push(`\\textit{${escapeLatex(statement)}}`, '');
      body.push(escapeLatex(item.aiFeedback), '');
      if (item.alternativeMethod) {
        body.push('\\textit{Se ha admitido un procedimiento distinto al de la referencia.}', '');
      }
    }
  } else if (options.forumTopic !== undefined) {
    // Sin apartados, el comentario cualitativo es el cuerpo de la corrección.
    body.push(
      '\\subsection*{Comentario}',
      '',
      escapeLatex(options.forumTopic.praise[0] ?? ''),
      '',
      // Sin nota, el descuento del banco de fallos no pinta nada: se recorta.
      escapeLatex(
        `Margen de mejora: ${lowerFirst(
          (options.forumTopic.faults[0]?.text ?? '').replace(/;\s*−[\d,]+\.?$/u, '.'),
        )}`,
      ),
      '',
    );
  }

  body.push('\\subsection*{Valoración global}', '', escapeLatex(options.summary), '');

  return [...head, ...body, '\\end{document}', ''].join('\n');
}

/**
 * El texto de la corrección viene de un modelo y acaba dentro de un documento
 * LaTeX: sin escapar, un `%` en el comentario comentaría el resto de la línea y
 * un `&` rompería la compilación.
 */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

/** Coma decimal: es un documento en español y lo lee un profesor español. */
function decimal(value: number): string {
  return value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function nonEmpty(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function lowerFirst(text: string): string {
  return text.length > 0 ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
