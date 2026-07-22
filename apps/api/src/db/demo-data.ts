import type {
  ActivityKind,
  AutonomyMode,
  PointsAllocation,
  SubmissionStatus,
  TranscriptionFlag,
} from '@vega/shared';

/**
 * Datos de ejemplo con contenido matemático real.
 *
 * No es relleno: la cola de revisión sólo sirve para dar feedback de diseño si
 * lo que se lee dentro se parece a lo que corregiría un profesor de verdad. Por
 * eso hay entregas puntuables con su reparto de puntos **y** foros no
 * puntuables con intervenciones escritas, que es el otro caso del producto.
 */

// ── Cursos de Moodle ────────────────────────────────────────────────────────

export const COURSES = {
  manana: 'Academia Hipatia · Secundaria Matemáticas · Grupo de mañana',
  tarde: 'Academia Hipatia · Secundaria Matemáticas · Grupo de tarde',
} as const;

/**
 * Identificador de cada curso en el Moodle simulado.
 *
 * Tiene que coincidir con el que devuelve `listCourses()` del conector `mock`:
 * si no, re-sincronizar desde la aplicación crearía cursos duplicados en vez de
 * reconocer los sembrados.
 */
export const COURSE_MOODLE_IDS: Record<string, string> = {
  [COURSES.manana]: '101',
  [COURSES.tarde]: '102',
};

// ── Actividades ─────────────────────────────────────────────────────────────

export interface SeedActivity {
  slug: string;
  name: string;
  kind: ActivityKind;
  courseName: string;
  moodleRef: string;
  enabled: boolean;
  graded: boolean;
  /** `null` cuando la actividad no se puntúa. */
  maxScore: number | null;
  autonomy: AutonomyMode;
  referenceSolution: string | null;
  pointsAllocation: PointsAllocation[];
  /** Reserva del contexto de nivel `activity` si no hay fichero en `contexts/`. */
  gradingNotes: string;
}

export const ACTIVITIES: SeedActivity[] = [
  {
    slug: 'tema04',
    name: 'Tema 04 · Derivadas y aplicaciones',
    kind: 'assignment',
    courseName: COURSES.manana,
    moodleRef: 'assign-tema04',
    enabled: true,
    graded: true,
    maxScore: 10,
    // Es la actividad con más marcas de OCR: aquí el profesor lo revisa todo.
    autonomy: 'review_all',
    referenceSolution: String.raw`\textbf{Apartado a)}\quad f(x)=\dfrac{3x^{2}-5x}{x+2}

f'(x)=\dfrac{(6x-5)(x+2)-(3x^{2}-5x)}{(x+2)^{2}}=\dfrac{3x^{2}+12x-10}{(x+2)^{2}}

\textbf{Apartado b)}\quad 3x^{2}+12x-10=0 \Longrightarrow x=\dfrac{-6\pm\sqrt{66}}{3}

\textbf{Apartado c)}\quad Como (x+2)^{2}>0, el signo de f' lo marca el numerador.
Creciente en (-\infty,-4{,}708)\cup(0{,}708,+\infty); decreciente en el resto.

\textbf{Apartado d)}\quad A.V. en x=-2. A.O.: y=3x-11.`,
    gradingNotes: `## Indicaciones de esta actividad

- La **regla del cociente** debe aparecer explícitamente. Si el alumno deriva
  "de memoria" sin mostrar el desarrollo, penaliza 0,25 en el apartado a).
- En el apartado b) se admite la solución exacta con radical **o** la aproximación
  decimal con dos cifras. No penalices la forma.
- El apartado d) exige calcular los dos límites laterales. Escribir sólo
  "asíntota vertical en x = −2" sin justificar vale la mitad.
- Error de arrastre: si la derivada del apartado a) es incorrecta pero el resto
  se desarrolla coherentemente con ella, puntúa los apartados siguientes sobre
  el procedimiento, no sobre el resultado.`,
    pointsAllocation: [
      { label: '1a', statement: 'Cálculo de la derivada por la regla del cociente', maxPoints: 2.5 },
      { label: '1b', statement: 'Puntos críticos', maxPoints: 2 },
      { label: '1c', statement: 'Monotonía y extremos relativos', maxPoints: 2.5 },
      { label: '1d', statement: 'Asíntotas y representación gráfica', maxPoints: 3 },
    ],
  },
  {
    slug: 'problema12',
    name: 'Problema 12 · Integrales definidas y áreas',
    kind: 'assignment',
    courseName: COURSES.manana,
    moodleRef: 'assign-problema12',
    enabled: true,
    graded: true,
    maxScore: 10,
    // Contexto ya afinado tras varias convocatorias: sólo suben a la cola las
    // correcciones dudosas.
    autonomy: 'review_low_confidence',
    referenceSolution: String.raw`\textbf{a)}\quad \int_{0}^{2}\left(x^{3}-4x\right)dx=\left[\dfrac{x^{4}}{4}-2x^{2}\right]_{0}^{2}=4-8=-4

\textbf{b)}\quad El recinto entre y=x^{3}-4x y el eje OX en [-2,2] tiene área
A=\displaystyle\int_{-2}^{0}(x^{3}-4x)\,dx-\int_{0}^{2}(x^{3}-4x)\,dx=4+4=8\ \text{u}^{2}

\textbf{c)}\quad Por partes: \int x e^{x}dx = xe^{x}-e^{x}+C`,
    gradingNotes: `## Indicaciones de esta actividad

- **El signo importa.** Confundir "integral definida" con "área" es el error más
  frecuente: si el alumno da −4 como área en el apartado b), la respuesta es
  incorrecta aunque el cálculo esté bien. Máximo 50 % del apartado.
- En el apartado b) hay que **partir el intervalo** por los cortes con el eje.
  Sin esa partición, el apartado no supera 1 punto.
- El apartado c) admite integración por partes con cualquier elección razonable
  de u y dv, siempre que se justifique.
- Exige unidades (u²) en las áreas. Sin unidades, −0,25.`,
    pointsAllocation: [
      { label: 'a', statement: 'Cálculo de la integral definida', maxPoints: 3 },
      { label: 'b', statement: 'Área del recinto (partición del intervalo y signo)', maxPoints: 4 },
      { label: 'c', statement: 'Integración por partes', maxPoints: 3 },
    ],
  },
  {
    slug: 'tema07',
    name: 'Tema 07 · Límites y continuidad',
    kind: 'assignment',
    courseName: COURSES.tarde,
    moodleRef: 'assign-tema07',
    enabled: true,
    graded: true,
    maxScore: 10,
    autonomy: 'review_all',
    referenceSolution: String.raw`\textbf{a)}\quad \lim_{x\to 0}\dfrac{\sin(3x)}{x}=3

\textbf{b)}\quad \lim_{x\to\infty}\left(1+\dfrac{2}{x}\right)^{x}=e^{2}

\textbf{c)}\quad f continua en x=1 \iff a+b=2 \text{ y } 2a=b`,
    gradingNotes: `## Indicaciones de esta actividad

- El apartado a) se puede resolver por el límite notable **o** por L'Hôpital.
  Ambas son correctas; no impongas el método.
- En b), aceptar el desarrollo con el número **e** como límite notable. Si el
  alumno aplica logaritmos y llega a e², es igualmente válido.
- El apartado c) exige plantear **las dos** condiciones (continuidad y, si se
  pide, derivabilidad). Resolver el sistema sin plantearlo vale la mitad.
- Cuidado con la notación: escribir "= ∞" sin especificar el lado en un límite
  lateral es impreciso pero no invalida el apartado; comenta y no penalices.`,
    pointsAllocation: [
      { label: '1', statement: 'Límite con indeterminación 0/0', maxPoints: 3 },
      { label: '2', statement: 'Límite de tipo 1^∞', maxPoints: 3 },
      { label: '3', statement: 'Continuidad de función definida a trozos', maxPoints: 4 },
    ],
  },
  {
    slug: 'foro-didactica',
    name: 'Foro · Didáctica: ¿límite antes que derivada?',
    kind: 'forum',
    courseName: COURSES.manana,
    moodleRef: 'forum-didactica',
    enabled: true,
    // Un foro de debate no se puntúa: sólo se devuelve feedback cualitativo.
    graded: false,
    maxScore: null,
    // El feedback de foro lleva meses sin corregirse a mano: va sin revisión.
    autonomy: 'autonomous',
    referenceSolution: null,
    pointsAllocation: [],
    gradingNotes: `## Indicaciones de este foro

- **No hay nota.** Devuelve sólo feedback cualitativo: qué argumenta bien, qué
  le falta apoyar y qué lectura le vendría bien.
- Valora que la intervención **entre en el fondo didáctico**: secuenciación,
  obstáculos epistemológicos, qué entiende el alumnado y en qué orden.
- Premia que cite experiencia de aula concreta o normativa; señala con suavidad
  las opiniones sin fundamento ("a mí me funciona") sin desanimar.
- Valora que responda a lo que dicen los compañeros y no suelte un monólogo.
- Nunca corrijas la ortografía como si fuera un examen: es un foro.`,
  },
  {
    slug: 'foro-dudas-analisis',
    name: 'Foro · Dudas de análisis entre compañeros',
    kind: 'forum',
    courseName: COURSES.tarde,
    moodleRef: 'forum-dudas-analisis',
    enabled: true,
    graded: false,
    maxScore: null,
    autonomy: 'review_low_confidence',
    referenceSolution: null,
    pointsAllocation: [],
    gradingNotes: `## Indicaciones de este foro

- **No hay nota.** El objetivo es que se resuelvan las dudas entre ellos.
- Lo que más valoramos: que quien responde **explique el porqué**, no que dé la
  solución. Una respuesta correcta sin explicación aporta poco al foro.
- Si alguien contesta con un error matemático, **corrígelo con claridad** en el
  feedback: es lo único que no se puede dejar pasar en un foro de dudas.
- Reconoce a quien pregunta bien: una duda bien formulada, con lo que ya ha
  intentado, vale tanto como una respuesta.`,
  },
];

/** Alias internos. Nunca sale de aquí el nombre real del alumno. */
/**
 * Alumnos de ejemplo, con ficha completa.
 *
 * Llevan nombre, comunidad autónoma y provincia porque son los datos que de
 * verdad viajan al modelo, y sin ellos la maqueta no enseña lo que el profesor
 * va a ver. Dos detalles buscados a propósito:
 *
 *  - Alguno se presenta en **dos comunidades**, separadas por coma, que es como
 *    las guarda el sistema de origen.
 *  - Todos llevan un `NIF` claramente falso. No está para usarlo: está para que
 *    se pueda comprobar —en la pantalla y en las pruebas— que ese campo se
 *    guarda y **no** acaba en el prompt.
 */
export const STUDENTS: {
  ref: string;
  alias: string;
  firstName: string;
  lastName: string;
  email: string;
  community: string;
  province: string;
}[] = [
  { ref: 'A-1042', alias: 'Ana Beltrán Ruiz', firstName: 'Ana', lastName: 'Beltrán Ruiz', email: 'ana.beltran@ejemplo.es', community: 'ANDALUCIA', province: 'Granada' },
  { ref: 'A-1078', alias: 'Diego Sanchís Mora', firstName: 'Diego', lastName: 'Sanchís Mora', email: 'diego.sanchis@ejemplo.es', community: 'COMUNIDAD_VALENCIANA', province: 'Valencia' },
  { ref: 'A-1103', alias: 'Lucía Ferrer Ibáñez', firstName: 'Lucía', lastName: 'Ferrer Ibáñez', email: 'lucia.ferrer@ejemplo.es', community: 'ANDALUCIA, MURCIA', province: 'Almería' },
  { ref: 'A-1119', alias: 'Marcos Otero Vidal', firstName: 'Marcos', lastName: 'Otero Vidal', email: 'marcos.otero@ejemplo.es', community: 'GALICIA', province: 'Pontevedra' },
  { ref: 'A-1156', alias: 'Nuria Aranda Gil', firstName: 'Nuria', lastName: 'Aranda Gil', email: 'nuria.aranda@ejemplo.es', community: 'MADRID', province: 'Madrid' },
  { ref: 'A-1187', alias: 'Javier Peris Lloret', firstName: 'Javier', lastName: 'Peris Lloret', email: 'javier.peris@ejemplo.es', community: 'COMUNIDAD_VALENCIANA', province: 'Castellón' },
  { ref: 'A-1204', alias: 'Marta Quintana Ávila', firstName: 'Marta', lastName: 'Quintana Ávila', email: 'marta.quintana@ejemplo.es', community: 'CASTILLA_Y_LEON', province: 'Valladolid' },
  { ref: 'A-1233', alias: 'Andrés Cuadrado Pons', firstName: 'Andrés', lastName: 'Cuadrado Pons', email: 'andres.cuadrado@ejemplo.es', community: 'CATALUNA', province: 'Tarragona' },
  { ref: 'A-1260', alias: 'Elena Vargas Nieto', firstName: 'Elena', lastName: 'Vargas Nieto', email: 'elena.vargas@ejemplo.es', community: 'ANDALUCIA', province: 'Sevilla' },
  { ref: 'A-1291', alias: 'Pablo Iriarte Sáez', firstName: 'Pablo', lastName: 'Iriarte Sáez', email: 'pablo.iriarte@ejemplo.es', community: 'NAVARRA', province: 'Navarra' },
  { ref: 'A-1318', alias: 'Carmen Roldán Prieto', firstName: 'Carmen', lastName: 'Roldán Prieto', email: 'carmen.roldan@ejemplo.es', community: 'MADRID, CASTILLA_LA_MANCHA', province: 'Madrid' },
  { ref: 'A-1344', alias: 'Iván Bermejo Lara', firstName: 'Iván', lastName: 'Bermejo Lara', email: 'ivan.bermejo@ejemplo.es', community: 'ARAGON', province: 'Zaragoza' },
  { ref: 'A-1370', alias: 'Sara Montalbán Ruiz', firstName: 'Sara', lastName: 'Montalbán Ruiz', email: 'sara.montalban@ejemplo.es', community: 'ANDALUCIA', province: 'Málaga' },
  { ref: 'A-1402', alias: 'Hugo Calvo Estévez', firstName: 'Hugo', lastName: 'Calvo Estévez', email: 'hugo.calvo@ejemplo.es', community: 'ASTURIAS', province: 'Asturias' },
  { ref: 'A-1435', alias: 'Alba Requena Soler', firstName: 'Alba', lastName: 'Requena Soler', email: 'alba.requena@ejemplo.es', community: 'MURCIA', province: 'Murcia' },
  { ref: 'A-1461', alias: 'Tomás Herrán Bilbao', firstName: 'Tomás', lastName: 'Herrán Bilbao', email: 'tomas.herran@ejemplo.es', community: 'PAIS_VASCO', province: 'Bizkaia' },
];

/**
 * Transcripciones por actividad y página. Sólo actividades con fichero.
 *
 * Convención de `TranscriptionPage.latex`: texto corriente con las fórmulas
 * delimitadas por `$$…$$`, y las marcas del OCR fuera de las fórmulas. Ver la
 * nota en `@vega/shared`.
 */
export const TRANSCRIPTION_PAGES: Record<string, string[]> = {
  tema04: [
    String.raw`**Apartado a)**

$$f(x)=\dfrac{3x^{2}-5x}{x+2}$$

Aplico la regla del cociente:

$$f'(x)=\dfrac{(6x-5)(x+2)-(3x^{2}-5x)\cdot 1}{(x+2)^{2}}$$

$$f'(x)=\dfrac{6x^{2}+12x-5x-10-3x^{2}+5x}{(x+2)^{2}}=\dfrac{3x^{2}+12x-10}{(x+2)^{2}}$$

**Apartado b)**

Puntos críticos:

$$3x^{2}+12x-10=0 \quad\Rightarrow\quad x=\dfrac{-12\pm\sqrt{144+120}}{6}=\dfrac{-12\pm\sqrt{264}}{6}$$

$$x_{1}\approx 0{,}708 \qquad x_{2}\approx -4{,}708$$`,
    String.raw`**Apartado c)**

Como $(x+2)^{2}>0$ para todo $x\neq -2$, el signo de $f'(x)$ coincide con el del numerador.

$$f \text{ creciente en } (-\infty,-4{,}708)\cup(0{,}708,+\infty)$$

$$f \text{ decreciente en } (-4{,}708,-2)\cup(-2,\,0{,}708)$$

Mínimo relativo en $x\approx 0{,}708$ y máximo relativo en $x\approx -4{,}708$.

**Apartado d)**

Asíntota vertical en $x=-2$:

$$\lim_{x\to -2^{-}}f(x)=-\infty$$
[DUDA]`,
    String.raw`Asíntota oblicua $y=mx+n$:

$$m=\lim_{x\to\infty}\dfrac{f(x)}{x}=3 \qquad n=\lim_{x\to\infty}\left(f(x)-3x\right)=-11$$

$$y=3x-11$$

Esquema de la gráfica:
[ILEGIBLE]

Corta al eje $OX$ en $x=0$ y $x=\tfrac{5}{3}$.`,
  ],
  problema12: [
    String.raw`**Apartado a)**

$$\int_{0}^{2}\left(x^{3}-4x\right)dx=\left[\dfrac{x^{4}}{4}-2x^{2}\right]_{0}^{2}$$

$$=\left(\dfrac{16}{4}-8\right)-(0)=4-8=-4$$

**Apartado b)**

Cortes con el eje $OX$:

$$x^{3}-4x=0 \Rightarrow x(x^{2}-4)=0 \Rightarrow x=-2,\,0,\,2$$`,
    String.raw`Parto el intervalo por los cortes y tomo valores absolutos:

$$A=\left|\int_{-2}^{0}(x^{3}-4x)dx\right|+\left|\int_{0}^{2}(x^{3}-4x)dx\right|$$

$$\int_{-2}^{0}(x^{3}-4x)dx=\left[\dfrac{x^{4}}{4}-2x^{2}\right]_{-2}^{0}=0-(4-8)=4$$

$$A=|4|+|-4|=8\ \text{u}^{2}$$

**Apartado c)**

Integro por partes con $u=x$ y $dv=e^{x}dx$, de donde $du=dx$ y $v=e^{x}$:

$$\int xe^{x}dx = xe^{x}-\int e^{x}dx = xe^{x}-e^{x}+C$$`,
  ],
  tema07: [
    String.raw`**Apartado a)**

$$\lim_{x\to 0}\dfrac{\sin(3x)}{x} \quad \left[\dfrac{0}{0}\right]$$

Multiplico y divido por 3 para reconducirlo al límite notable:

$$\lim_{x\to 0}\dfrac{3\sin(3x)}{3x}=3\cdot 1=3$$

**Apartado b)**

$$\lim_{x\to\infty}\left(1+\dfrac{2}{x}\right)^{x} \quad [1^{\infty}]$$

$$=e^{\lim_{x\to\infty} x\cdot\frac{2}{x}}=e^{2}$$`,
    String.raw`**Apartado c)**

$$f(x)=\begin{cases} ax+b & x\leq 1\\ x^{2}+1 & x>1\end{cases}$$

Continuidad en $x=1$:

$$\lim_{x\to 1^{-}}f(x)=a+b \qquad \lim_{x\to 1^{+}}f(x)=2 \quad\Rightarrow\quad a+b=2$$

Segunda condición:
[DUDA]

$$\text{Derivabilidad: } a = 2 \quad\Rightarrow\quad b=0$$`,
  ],
};

export const TRANSCRIPTION_FLAGS: Record<string, TranscriptionFlag[]> = {
  tema04: [
    {
      kind: 'DUDA',
      page: 2,
      excerpt: '\\lim_{x\\to -2^{-}}f(x)',
      note: 'El signo del infinito no se distingue con claridad; podría ser −∞ o +∞.',
    },
    {
      kind: 'ILEGIBLE',
      page: 3,
      excerpt: 'esquema de la gráfica',
      note: 'Trazo a lápiz muy tenue en el tercio inferior; no se puede transcribir.',
    },
  ],
  problema12: [],
  tema07: [
    {
      kind: 'DUDA',
      page: 2,
      excerpt: 'la segunda condición aparece tachada y reescrita',
      note: 'Hay dos versiones superpuestas; se ha transcrito la que parece definitiva.',
    },
  ],
};

// ── Intervenciones en los foros ─────────────────────────────────────────────

/**
 * Lo que el alumno ha escrito en el foro, ya concatenado, tal y como llega a
 * `Submission.textContent`. Un foro no trae fichero: esto **es** la entrega.
 */
export interface SeedForumPost {
  studentRef: string;
  text: string;
}

export const FORUM_POSTS: Record<string, SeedForumPost[]> = {
  'foro-didactica': [
    {
      studentRef: 'A-1042',
      text: `Yo lo tengo bastante claro después de dos años dando 1.º de Bachillerato: el límite hay que darlo antes, pero no como se da normalmente.

El problema no es el orden, es que llegamos a la derivada con el límite mal asentado. Si el alumnado ha visto el límite sólo como "sustituyo y si sale 0/0 hago trucos", cuando le pones la definición de derivada como límite del cociente incremental no ve nada: ve otra fórmula más que memorizar.

Lo que a mí me ha funcionado es dedicar tiempo a la idea de tendencia con tablas de valores y gráficas, sin formalismo, y sólo después meter la definición. Cuando llega la derivada, el cociente incremental ya no es un monstruo: es "lo que le pasa a la pendiente de la secante cuando acerco los puntos".

Lo que no haría nunca es lo que vi en un libro de texto el año pasado: presentar la derivada como una tabla de reglas y dejar el límite para el final "porque es más difícil". Eso produce alumnos que derivan muy rápido y no saben qué están calculando.`,
    },
    {
      studentRef: 'A-1078',
      text: `No estoy del todo de acuerdo con lo que dice el compañero, o al menos lo matizaría.

Estoy con él en que el límite formal (épsilon-delta o incluso la definición con entornos) no aporta nada antes de la derivada en Bachillerato. Pero de ahí a decir que hay que dar límite antes hay un trecho. Hay propuestas serias (Freudenthal, y en España el enfoque de algunos materiales de la LOMLOE) que entran por la variación: velocidad media, velocidad instantánea, pendiente. Y el límite aparece cuando hace falta, como respuesta a un problema, no como capítulo previo.

Creo que la pregunta del foro está mal planteada, con perdón. No es "antes o después", es "para qué introduzco el límite". Si lo introduzco para poder definir la derivada, entonces el orden ya no importa tanto: van juntos.

Lo que sí comparto es lo del obstáculo. He visto muchísimas veces al alumnado interpretar el límite como "un valor al que no se llega nunca", y eso viene de darlo con ejemplos donde la función no está definida en el punto. Luego les pones f(x) = x² y el límite en x = 2 y te dicen que "no puede ser 4 porque el 4 sí se alcanza". Ese obstáculo lo fabricamos nosotros.`,
    },
    {
      studentRef: 'A-1103',
      text: `A mí me parece que estáis los dos hablando de Bachillerato y el tema del temario es más amplio.

En la ESO no hay límite y sin embargo sí se puede trabajar la idea de variación: tasa de variación media está en 4.º de ESO y es exactamente el cociente incremental sin llamarlo así. Si eso se trabaja bien en 4.º, en 1.º de Bachillerato la derivada tiene dónde agarrarse.

Sobre el orden concreto, en mi experiencia (soy interina, tres cursos) el orden del libro da igual porque nadie sigue el libro. Lo que importa es que cuando llegue la definición de derivada, el alumnado tenga tres cosas: idea de tendencia, idea de pendiente y soltura con el álgebra de fracciones. Si falla la tercera, da igual la didáctica que uses, porque no van a poder simplificar el cociente incremental y se van a frustrar.

Perdón si me he ido del tema.`,
    },
  ],
  'foro-dudas-analisis': [
    {
      studentRef: 'A-1119',
      text: `Buenas, tengo una duda del simulacro de la semana pasada que no consigo cerrar.

En el problema de calcular el área entre y = x³ − 4x y el eje OX en [−2, 2], yo calculé la integral definida de −2 a 2 directamente y me dio 0. Puse que el área era 0 y obviamente está mal, pero no acabo de entender por qué el resultado sale exactamente 0.

Sé que hay que partir el intervalo por los cortes, eso ya lo he visto en la corrección. Lo que no entiendo es qué significa ese 0 que me sale. ¿Es un error de cálculo mío o el 0 significa algo?

He probado con otra función impar y me vuelve a pasar, así que intuyo que va por ahí pero no sé rematarlo.`,
    },
    {
      studentRef: 'A-1156',
      text: `El 0 que te sale no es un error, es correcto: la integral definida de −2 a 2 de esa función vale 0. Lo que pasa es que la integral definida no es el área.

La integral definida suma áreas con signo: lo que queda por encima del eje suma positivo y lo que queda por debajo suma negativo. Tu función es impar y el intervalo es simétrico respecto al origen, así que el trozo de la izquierda y el de la derecha tienen la misma área pero signos opuestos y se cancelan. De ahí el 0 exacto.

Por eso hay que partir por los cortes con el eje (x = −2, 0, 2) y tomar valor absoluto de cada trozo, o cambiar el signo del trozo negativo. Te sale 4 + 4 = 8 u².

Un truco para no olvidarlo nunca: si te piden área y te sale 0 o un número negativo, algo has hecho mal seguro, porque un área no puede ser ninguna de las dos cosas. Es una comprobación que cuesta dos segundos y salva el apartado.`,
    },
    {
      studentRef: 'A-1187',
      text: `Añado a lo que ha dicho el compañero, porque creo que hay un matiz que en el examen cuesta puntos.

Que la función sea impar y el intervalo simétrico te garantiza que la integral da 0, sí. Pero cuidado con generalizar: eso vale para calcular la integral, no para calcular el área. El área en un intervalo simétrico de una función impar es el doble del área de la mitad, no cero.

O sea: integral de −a a a de f impar = 0, pero área = 2 · (área de 0 a a). En el examen puedes ahorrarte la mitad del trabajo usando la simetría, pero tienes que decirlo explícitamente, porque si escribes directamente "por simetría, A = 2·4 = 8" sin justificar, te lo pueden bajar por falta de justificación.

Yo lo escribiría así: como f es impar, el recinto de [−2,0] es simétrico del de [0,2] respecto al origen, luego tienen la misma área; calculo una y multiplico por dos.`,
    },
  ],
};

// ── Correcciones ────────────────────────────────────────────────────────────

/** Apartados corregidos por actividad, con el feedback que escribiría un profesor. */
export interface SeedItem {
  label: string;
  statement: string;
  maxPoints: number;
  aiPoints: number;
  aiFeedback: string;
  confidence: number;
  alternativeMethod: boolean;
}

export const CORRECTION_ITEMS: Record<string, SeedItem[]> = {
  tema04: [
    {
      label: '1a',
      statement: 'Cálculo de la derivada por la regla del cociente',
      maxPoints: 2.5,
      aiPoints: 2.5,
      aiFeedback:
        'Aplica correctamente la regla del cociente y desarrolla el numerador sin errores. La simplificación a (3x² + 12x − 10)/(x+2)² es exacta. Nada que objetar.',
      confidence: 0.96,
      alternativeMethod: false,
    },
    {
      label: '1b',
      statement: 'Puntos críticos',
      maxPoints: 2,
      aiPoints: 1.75,
      aiFeedback:
        'Plantea y resuelve bien la ecuación de segundo grado. Las raíces aproximadas son correctas. Se descuenta 0,25 porque deja √264 sin simplificar: 2√66 habría sido la forma exacta esperada.',
      confidence: 0.88,
      alternativeMethod: false,
    },
    {
      label: '1c',
      statement: 'Monotonía y extremos relativos',
      maxPoints: 2.5,
      aiPoints: 2.25,
      aiFeedback:
        'Razona muy bien que el signo de la derivada lo marca el numerador porque (x+2)² es siempre positivo. Identifica correctamente los intervalos y excluye x = −2 del dominio. Falta indicar explícitamente que en x = −2 no hay extremo por no pertenecer al dominio.',
      confidence: 0.91,
      alternativeMethod: false,
    },
    {
      label: '1d',
      statement: 'Asíntotas y representación gráfica',
      maxPoints: 3,
      aiPoints: 1.5,
      aiFeedback:
        'La asíntota oblicua y = 3x − 11 está bien calculada mediante los límites de m y n. Sin embargo, el límite lateral por la izquierda en x = −2 no se puede leer con seguridad (ver marca [DUDA] en la página 2) y la gráfica es ilegible, por lo que no se puede evaluar la representación. Conviene revisar el original antes de cerrar la nota.',
      confidence: 0.52,
      alternativeMethod: false,
    },
  ],
  problema12: [
    {
      label: 'a',
      statement: 'Cálculo de la integral definida',
      maxPoints: 3,
      aiPoints: 3,
      aiFeedback:
        'Primitiva correcta y regla de Barrow bien aplicada. El resultado −4 es el valor de la integral definida, y el alumno no lo confunde con un área. Perfecto.',
      confidence: 0.97,
      alternativeMethod: false,
    },
    {
      label: 'b',
      statement: 'Área del recinto (partición del intervalo y signo)',
      maxPoints: 4,
      aiPoints: 4,
      aiFeedback:
        'Calcula los cortes con el eje OX y parte el intervalo por ellos, que es justo lo que exige el enunciado. Usa valores absolutos en lugar de cambiar el signo de la segunda integral: es un procedimiento distinto al de la solución de referencia pero igualmente válido y llega a 8 u². Incluye las unidades.',
      confidence: 0.93,
      alternativeMethod: true,
    },
    {
      label: 'c',
      statement: 'Integración por partes',
      maxPoints: 3,
      aiPoints: 2.75,
      aiFeedback:
        'Elección de u y dv adecuada, desarrollo limpio y constante de integración incluida. Se descuenta 0,25 por no justificar la elección de u = x, que el criterio del departamento pide de forma explícita.',
      confidence: 0.9,
      alternativeMethod: false,
    },
  ],
  tema07: [
    {
      label: '1',
      statement: 'Límite con indeterminación 0/0',
      maxPoints: 3,
      aiPoints: 3,
      aiFeedback:
        "Identifica la indeterminación y la resuelve multiplicando y dividiendo por 3 para reconducirla al límite notable. Método correcto y bien justificado; no necesita L'Hôpital.",
      confidence: 0.95,
      alternativeMethod: false,
    },
    {
      label: '2',
      statement: 'Límite de tipo 1^∞',
      maxPoints: 3,
      aiPoints: 2.5,
      aiFeedback:
        'Reconoce la indeterminación 1^∞ y aplica la fórmula del número e correctamente, llegando a e². Se descuenta 0,5 porque escribe el resultado del exponente sin desarrollar el límite intermedio, y el criterio de la actividad pide ver ese paso.',
      confidence: 0.86,
      alternativeMethod: false,
    },
    {
      label: '3',
      statement: 'Continuidad de función definida a trozos',
      maxPoints: 4,
      aiPoints: 2,
      aiFeedback:
        'Plantea bien la condición de continuidad (a + b = 2) y calcula los límites laterales. La segunda condición está tachada y reescrita, y de la transcripción no se deduce si llegó a plantear 2a = b o simplemente asignó a = 2. El resultado final (a = 2, b = 0) es coherente, pero el desarrollo no se puede verificar: revisa el original.',
      confidence: 0.48,
      alternativeMethod: false,
    },
  ],
};

export const AI_SUMMARY: Record<string, string> = {
  tema04:
    'Examen sólido en la parte de cálculo diferencial: la derivada y el estudio de la monotonía están muy bien resueltos y bien justificados. El punto débil es el último apartado, donde la representación gráfica no es legible en el escaneo y el límite lateral queda en duda. Recomiendo revisar el original antes de cerrar la nota.',
  problema12:
    'Muy buen ejercicio. Distingue con claridad entre integral definida y área, que es el error más habitual en este problema, y parte el intervalo por los cortes con el eje. Resuelve el área con valores absolutos en lugar de cambiando el signo: es un camino alternativo perfectamente válido. Sólo falta justificar la elección de u en la integración por partes.',
  tema07:
    'Los dos primeros límites están bien resueltos, con reconocimiento correcto de las indeterminaciones y uso adecuado de los límites notables. El tercer apartado es el problemático: hay una tachadura que impide verificar si planteó la condición de derivabilidad o si el resultado es casual. Conviene mirar el original.',
  'foro-didactica':
    'Intervención de nivel alto: entra en el fondo didáctico, distingue entre el orden de los contenidos y la función que cumple cada uno, y aporta un obstáculo de aprendizaje concreto y bien identificado. Le falta apoyarse en alguna referencia y responder de forma más directa a lo que plantean los compañeros.',
  'foro-dudas-analisis':
    'Respuesta muy buena: no da la solución, explica el porqué, y añade una comprobación práctica que el compañero puede reutilizar en el examen. El matiz sobre simetría es correcto y pertinente. Nada que corregir en lo matemático.',
};

/**
 * Documento LaTeX de corrección tal y como lo propone la IA. Es la salida
 * principal del motor y lo que se convierte en las páginas de feedback del PDF.
 * En español y con coma decimal, como pide el contexto global.
 */
export const AI_LATEX: Record<string, string> = {
  tema04: String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\usepackage{amsmath,amssymb}
\begin{document}

\section*{Tema 04 · Derivadas y aplicaciones}

\subsection*{Apartado a) — 2,5 / 2,5}

Has aplicado la regla del cociente correctamente y el desarrollo del numerador
no tiene errores:

\[ f'(x)=\frac{(6x-5)(x+2)-(3x^{2}-5x)}{(x+2)^{2}}=\frac{3x^{2}+12x-10}{(x+2)^{2}} \]

La simplificación es exacta y el resultado está bien presentado.

\subsection*{Apartado b) — 1,75 / 2}

Planteas y resuelves bien la ecuación $3x^{2}+12x-10=0$, y las raíces
aproximadas $x\approx 0{,}708$ y $x\approx -4{,}708$ son correctas.

Dejas $\sqrt{264}$ sin simplificar. La forma exacta esperada era
$x=\frac{-6\pm\sqrt{66}}{3}$, y en un tribunal eso se pide. Descuento 0,25.

\subsection*{Apartado c) — 2,25 / 2,5}

Muy bien razonado que, al ser $(x+2)^{2}>0$ para todo $x\neq -2$, el signo de
$f'(x)$ lo marca únicamente el numerador. Los intervalos de monotonía son
correctos y excluyes $x=-2$ del dominio, que es donde suele fallar la gente.

Te falta decir explícitamente que en $x=-2$ no hay extremo relativo por no
pertenecer al dominio. Descuento 0,25.

\subsection*{Apartado d) — 1,5 / 3}

La asíntota oblicua $y=3x-11$ está bien obtenida por los límites de $m$ y $n$.

El problema es la lectura: el límite lateral $\lim_{x\to -2^{-}}f(x)$ no se
distingue con seguridad en el escaneo y el esquema de la gráfica es ilegible.
No puedo evaluar la representación con lo que hay en el papel.

\subsection*{Valoración global}

Examen sólido en cálculo diferencial. El punto débil es el último apartado, y
buena parte del problema es de legibilidad, no de matemáticas. Antes de cerrar
la nota conviene mirar el original.

\end{document}`,
  problema12: String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\usepackage{amsmath,amssymb}
\begin{document}

\section*{Problema 12 · Integrales definidas y áreas}

\subsection*{Apartado a) — 3 / 3}

Primitiva correcta y regla de Barrow bien aplicada:

\[ \int_{0}^{2}\left(x^{3}-4x\right)dx=\left[\frac{x^{4}}{4}-2x^{2}\right]_{0}^{2}=4-8=-4 \]

Muy importante: das $-4$ como valor de la integral definida y \textbf{no} lo
confundes con un área. Es el error más frecuente de este problema y lo evitas.

\subsection*{Apartado b) — 4 / 4}

Calculas los cortes con el eje $OX$ y partes el intervalo por ellos, que es
exactamente lo que exige el enunciado.

\[ A=\left|\int_{-2}^{0}(x^{3}-4x)dx\right|+\left|\int_{0}^{2}(x^{3}-4x)dx\right|=|4|+|-4|=8\ \text{u}^{2} \]

Usas valores absolutos en lugar de cambiar el signo de la segunda integral: es
un camino distinto al de la solución de referencia, igualmente válido, y llegas
al mismo resultado. Incluyes las unidades.

\subsection*{Apartado c) — 2,75 / 3}

Elección de $u$ y $dv$ adecuada, desarrollo limpio y constante de integración
incluida:

\[ \int x e^{x}\,dx = x e^{x}-e^{x}+C \]

Descuento 0,25 porque no justificas por qué eliges $u=x$; el criterio del
departamento lo pide de forma explícita.

\subsection*{Valoración global}

Muy buen ejercicio, con el concepto clave (integral definida frente a área)
bien asentado. Cuida sólo la justificación de las elecciones.

\end{document}`,
  tema07: String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\usepackage{amsmath,amssymb}
\begin{document}

\section*{Tema 07 · Límites y continuidad}

\subsection*{Apartado 1 — 3 / 3}

Identificas la indeterminación $\left[\frac{0}{0}\right]$ y la reconduces al
límite notable multiplicando y dividiendo por 3:

\[ \lim_{x\to 0}\frac{\sin(3x)}{x}=\lim_{x\to 0}\frac{3\sin(3x)}{3x}=3 \]

Método correcto y bien justificado. No necesitas L'Hôpital y haces bien en no
usarlo.

\subsection*{Apartado 2 — 2,5 / 3}

Reconoces la indeterminación $[1^{\infty}]$ y aplicas la regla del número $e$
correctamente, llegando a $e^{2}$.

Descuento 0,5 porque escribes el resultado del exponente sin desarrollar el
límite intermedio $\lim_{x\to\infty} x\cdot\frac{2}{x}$. El criterio de esta
actividad pide ver ese paso.

\subsection*{Apartado 3 — 2 / 4}

Planteas bien la condición de continuidad en $x=1$ y calculas los dos límites
laterales, obteniendo $a+b=2$.

La segunda condición aparece tachada y reescrita en el original, y de la
transcripción no se deduce si llegaste a plantear $2a=b$ o si asignaste $a=2$
directamente. El resultado $a=2$, $b=0$ es coherente, pero no puedo verificar
el desarrollo.

\subsection*{Valoración global}

Los dos primeros límites están muy bien. El tercer apartado se queda a medias
por un problema de legibilidad; conviene revisarlo sobre el papel original.

\end{document}`,
  'foro-didactica': String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\begin{document}

\section*{Foro · Didáctica: ¿límite antes que derivada?}

\textit{Actividad no puntuable. Feedback cualitativo.}

\subsection*{Lo que haces bien}

Entras en el fondo didáctico y no te quedas en la preferencia personal. La
distinción que estableces entre \textbf{el orden de los contenidos} y \textbf{la
función que cumple cada uno} es la clave del debate, y la formulas con claridad.

El obstáculo que identificas —interpretar el límite como «un valor al que no se
llega nunca»— está bien descrito y, además, señalas su origen didáctico: los
ejemplos en los que la función no está definida en el punto. Eso es
exactamente el tipo de análisis que se espera en este tema.

\subsection*{Lo que conviene reforzar}

Apoya la argumentación en alguna referencia. Mencionas propuestas «serias» sin
citarlas; una referencia a Freudenthal o a la investigación en pensamiento
matemático avanzado daría mucho más peso a lo que dices.

Respondes a los compañeros en bloque, pero no llegas a dialogar con lo concreto
que plantean. Citar la afirmación a la que respondes y matizarla hace el foro
mucho más útil para quien lo lee después.

\subsection*{Para seguir}

Merece la pena que mires cómo se secuencia la tasa de variación media en 4.º de
ESO: refuerza justo la tesis que defiendes.

\end{document}`,
  'foro-dudas-analisis': String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\usepackage{amsmath,amssymb}
\begin{document}

\section*{Foro · Dudas de análisis entre compañeros}

\textit{Actividad no puntuable. Feedback cualitativo.}

\subsection*{Lo que haces bien}

No das la solución: explicas \textbf{por qué} la integral vale 0. Distinguir
entre la integral definida (que suma áreas con signo) y el área (que no puede
ser negativa) es exactamente lo que el compañero necesitaba para desbloquearse.

El argumento de la simetría está bien traído: función impar en intervalo
simétrico respecto al origen, los dos trozos se cancelan. Correcto.

La comprobación práctica que propones —«si te piden área y sale 0 o negativo,
algo está mal»— es de las cosas que de verdad salvan un apartado en un examen.

\subsection*{Precisión matemática}

Todo lo que afirmas es correcto. Conviene subrayar el matiz que aparece después
en el hilo: la simetría permite calcular el área como

\[ A = 2\int_{0}^{2}\left|x^{3}-4x\right|dx = 8\ \text{u}^{2} \]

pero \textbf{hay que justificarlo}. Escribir «por simetría, $A=2\cdot 4=8$» sin
explicar de dónde sale la simetría cuesta puntos.

\subsection*{Para seguir}

Sigue respondiendo así. Una explicación como ésta vale por tres correcciones.

\end{document}`,
};

// ── Reparto de entregas ─────────────────────────────────────────────────────

export interface SeedSubmissionPlan {
  status: SubmissionStatus;
  /**
   * `true` si Vega la publicó sola por el modo de autonomía de la actividad,
   * sin pasar por el profesor. Sólo tiene sentido con `status: 'published'`.
   */
  autoPublished?: boolean;
  /**
   * `true` si el profesor la validó **sin cambiar nada**: ni puntos, ni
   * feedback, ni resumen. Es lo que mide `untouchedRatio` en el panel, y la
   * señal de que la actividad ya se puede pasar a un modo con más autonomía.
   */
  untouched?: boolean;
}

/**
 * Estados por actividad. Pensado para que la UI tenga de todo que enseñar:
 * cola con trabajo pendiente, entregas ya cerradas, un error y —en los foros
 * con autonomía— correcciones publicadas sin intervención humana.
 */
export const SUBMISSION_PLAN: Record<string, SeedSubmissionPlan[]> = {
  tema04: [
    { status: 'graded' },
    { status: 'graded' },
    { status: 'graded' },
    { status: 'validated' },
    { status: 'error' },
    { status: 'pending' },
  ],
  problema12: [
    { status: 'graded' },
    { status: 'graded' },
    // El profesor la validó tal cual: coincide con la IA y no toca nada. Es lo
    // que empuja hacia arriba el `untouchedRatio` de esta actividad, que ya
    // está en modo "sólo las dudosas".
    { status: 'validated', untouched: true },
    // Validada por el profesor y publicada a mano: `publishedAutomatically` false.
    { status: 'published' },
    { status: 'pending' },
  ],
  tema07: [
    { status: 'graded' },
    { status: 'graded' },
    { status: 'validated', untouched: true },
    { status: 'transcribed' },
    { status: 'grading' },
  ],
  'foro-didactica': [
    // Actividad en modo autónomo: se publican solas.
    { status: 'published', autoPublished: true },
    { status: 'published', autoPublished: true },
    { status: 'graded' },
  ],
  'foro-dudas-analisis': [
    // Modo "sólo las dudosas": ésta iba segura y se publicó sola.
    { status: 'published', autoPublished: true },
    { status: 'graded' },
    { status: 'pending' },
  ],
};

// ── Ficheros de contexto ────────────────────────────────────────────────────

/**
 * Enunciado en LaTeX de una entrega puntuable.
 *
 * Es el caso real del producto: el profesor sube el `.tex` con el que preparó
 * el examen y Vega lo tiene delante al corregir, sin transcribirlo ni pagarlo
 * en cada llamada.
 */
export const SEED_ENUNCIADO_TEMA04 = String.raw`\documentclass{article}
\begin{document}
\section*{Tema 04 · Derivadas y aplicaciones}

\textbf{Ejercicio 1.} Sea $f(x) = \dfrac{3x^{2} - 5x}{x + 2}$.

\begin{enumerate}
  \item[a)] Calcula $f'(x)$ aplicando la regla del cociente. \hfill (2,5 puntos)
  \item[b)] Determina los puntos críticos de $f$. \hfill (2 puntos)
  \item[c)] Estudia la monotonía e identifica los extremos relativos. \hfill (2,5 puntos)
  \item[d)] Halla las asíntotas y esboza la gráfica. \hfill (3 puntos)
\end{enumerate}

\textbf{Nota:} se admite la solución exacta con radical o su aproximación
decimal con dos cifras. Todo resultado debe ir justificado.
\end{document}`;

/**
 * Material asociado a un foro de dudas.
 *
 * En una actividad no puntuable no hay solución que contrastar: lo que se sube
 * es aquello sobre lo que los alumnos preguntan. Mismo campo, otro papel.
 */
export const SEED_MATERIAL_FORO = String.raw`\section*{Análisis · material de referencia}

\subsection*{Definición de límite}
$\displaystyle\lim_{x \to a} f(x) = L$ si para todo $\varepsilon > 0$ existe
$\delta > 0$ tal que $0 < |x - a| < \delta \implies |f(x) - L| < \varepsilon$.

\subsection*{Continuidad}
$f$ es continua en $a$ si $\displaystyle\lim_{x \to a} f(x) = f(a)$. Exige las
tres condiciones: que exista $f(a)$, que exista el límite y que coincidan.

\subsection*{Derivabilidad implica continuidad}
Si $f$ es derivable en $a$, entonces es continua en $a$. El recíproco es falso:
$f(x) = |x|$ es continua en $0$ y no derivable ahí.

\subsection*{Teorema del valor medio}
Si $f$ es continua en $[a,b]$ y derivable en $(a,b)$, existe $c \in (a,b)$ con
$f'(c) = \dfrac{f(b) - f(a)}{b - a}$.`;
