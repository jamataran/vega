# tema07 — Límite y continuidad de una función. Teoremas fundamentales

- **Tipo de tarea**: `simulacro_tema`
- **Nota máxima**: 10
- Aplica sobre `global.md` y `task-types/simulacro_tema.md`.

Es el tema donde el rigor pesa más de todo el temario: casi todo son definiciones con
cuantificadores y demostraciones cortas. Sé especialmente estricto con la precisión formal.

## Guion exigible

| # | Epígrafe | Peso de cobertura |
|---|---|---|
| 1 | Límite de una función en un punto: definición $\varepsilon$-$\delta$. Unicidad del límite **con demostración**. Límites laterales | 20 % |
| 2 | Límites infinitos y en el infinito. Caracterización por sucesiones | 10 % |
| 3 | Álgebra de límites. Indeterminaciones y técnicas de resolución | 15 % |
| 4 | Continuidad en un punto y en un intervalo. Tipos de discontinuidad | 15 % |
| 5 | Operaciones con funciones continuas. Continuidad de la función compuesta | 10 % |
| 6 | Teorema de Bolzano **con demostración**. Teorema de los valores intermedios (Darboux) | 15 % |
| 7 | Teorema de Weierstrass. Continuidad uniforme y teorema de Heine (mención) | 15 % |

## Qué exigir con dureza

**D1. La definición $\varepsilon$-$\delta$ tiene que estar completa y con los cuantificadores en el
orden correcto.** Es la piedra de toque del tema:

$$\lim_{x \to a} f(x) = L \iff \forall \varepsilon > 0,\ \exists \delta > 0:\ 0 < |x-a| < \delta \Rightarrow |f(x) - L| < \varepsilon$$

Tres exigencias, y ninguna es negociable:

- **El orden de los cuantificadores.** Escribir $\exists \delta\ \forall \varepsilon$ es una
  afirmación distinta y falsa. Error de concepto (§4.3 global), no descuido de notación.
- **La condición $0 < |x-a|$.** Sin ella se está exigiendo continuidad, no límite. Descuento de
  0,50 puntos y explícalo: es la diferencia entre los dos conceptos centrales del tema.
- **La dependencia $\delta(\varepsilon)$.** Basta con que quede claro que $\delta$ se elige después
  de $\varepsilon$; no exijas escribir $\delta(\varepsilon)$.

Una definición sólo intuitiva («los valores se acercan tanto como se quiera») **no puntúa como
definición** (§T2). Puede acompañarla, no sustituirla.

**D2. La unicidad del límite se demuestra**, y la demostración por reducción al absurdo con
$\varepsilon = \frac{|L_1 - L_2|}{2}$ es la esperada. Enunciarla sin demostrarla: sólo puntos de
enunciado (§T4).

**D3. Bolzano se demuestra.** Acepta cualquiera de las vías estándar —bisección con encaje de
intervalos, o supremo del conjunto $\{x \in [a,b] : f(x) < 0\}$— pero exige que **se use en algún
punto la completitud de $\mathbb{R}$**, explícita o implícitamente vía el axioma del supremo o el
principio de los intervalos encajados. Una «demostración» que no usa la completitud no demuestra
nada: el teorema es falso en $\mathbb{Q}$. Si el desarrollo no lo toca, no hay puntos de
demostración, y dilo con ese argumento.

**D4. Hipótesis completas en Bolzano y Weierstrass.** Continuidad en el **intervalo cerrado y
acotado** $[a,b]$; en Bolzano, además, $f(a) \cdot f(b) < 0$. Escribir el intervalo abierto es
enunciado falso (§T3).

**D5. Weierstrass afirma que el máximo y el mínimo se alcanzan**, no que la función esté acotada —
eso es la consecuencia débil. Confundir «acotada» con «alcanza sus extremos» es error de concepto.

**D6. Clasificación de discontinuidades: con los tres límites en la mano.** Evitable (existe el
límite y no coincide con $f(a)$, o $f$ no está definida en $a$), de salto finito (laterales
distintos y finitos), de segunda especie (algún lateral no existe o es infinito). **Clasificar sin
haber calculado los límites laterales no puntúa.**

**D7. Continuidad de la compuesta: el orden de las hipótesis importa.** $g$ continua en $a$ y $f$
continua en $g(a)$. Escribirlo al revés es error de concepto.

**D8. Continuidad uniforme.** El guion sólo pide mención, pero si aparece, exige que se vea la
diferencia con la continuidad puntual: en la uniforme $\delta$ **no depende del punto**. Un
desarrollo que trata la continuidad uniforme sin señalar esa diferencia no aporta nada; no lo
puntúes como cobertura del epígrafe 7.

## Qué no penalizar

**N1.** La definición por sucesiones como definición alternativa de límite es **válida** si se
enuncia bien. Si el alumno la usa como principal y la $\varepsilon$-$\delta$ como secundaria, no
descuentes: es método alternativo (§5 global). Márcalo.

**N2.** No exijas la demostración de Weierstrass ni la del teorema de Heine: el guion pide
enunciado y comprensión, no prueba.

**N3.** No exijas la construcción formal de $\mathbb{R}$ ni la teoría de la medida. Fuera de guion.

**N4.** Cualquier notación para los límites laterales es válida: $\lim_{x \to a^+}$,
$\lim_{x \to a, x > a}$, $f(a^+)$. Exige coherencia, no una elección concreta.

## Errores frecuentes en este buzón

1. **Cuantificadores intercambiados** en la definición de límite (D1). El más caro y el más
   frecuente.
2. Omitir $0 < |x-a|$ y con ello confundir límite con continuidad.
3. Enunciar Bolzano sobre un intervalo **abierto**.
4. Afirmar que el recíproco de Bolzano es cierto: existir un cero **no** implica cambio de signo
   ($f(x)=x^2$ en $[-1,1]$).
5. Aplicar el álgebra de límites sobre **indeterminaciones**: escribir $\infty - \infty = 0$ o
   $\frac{\infty}{\infty} = 1$. Error de concepto grave.
6. Tratar $\frac{1}{0}$ como si fuera $\infty$ sin distinguir los laterales.
7. Decir que una función es continua en un punto **donde no está definida** porque «el límite
   existe». Falta la tercera condición: $f(a)$ tiene que existir y coincidir.
8. Clasificar una discontinuidad como evitable sin comprobar que **ambos** laterales coinciden.

## Nota sobre el formalismo

Este tema se corrige con la vara del rigor. Una exposición larga, bien escrita y llena de
intuición, pero con la definición $\varepsilon$-$\delta$ mal cuantificada, **no puede aprobar el
epígrafe 1**. Dilo con claridad en el feedback: en el tribunal, ese error se paga igual.
