# tema04 — Derivada de una función. Aplicaciones

- **Tipo de tarea**: `simulacro_tema`
- **Nota máxima**: 10
- Aplica sobre `global.md` y `task-types/simulacro_tema.md`.

## Guion exigible

Un desarrollo completo debe cubrir estos seis epígrafes. La ausencia de cualquiera de ellos es
pérdida de cobertura (§T1) por el peso indicado.

| # | Epígrafe | Peso de cobertura |
|---|---|---|
| 1 | Derivada en un punto: definición como límite del cociente incremental. Interpretación geométrica (recta tangente) y física (velocidad instantánea) | 15 % |
| 2 | Derivabilidad y continuidad: derivadas laterales, teorema «derivable ⟹ continua» **con demostración**, y contraejemplo del recíproco | 20 % |
| 3 | Función derivada. Álgebra de derivadas: suma, producto, cociente. **Regla de la cadena con demostración o justificación seria** | 20 % |
| 4 | Derivada de la función inversa y derivación implícita | 15 % |
| 5 | Aplicaciones al estudio local: monotonía, extremos relativos, concavidad, puntos de inflexión, con el criterio de la derivada primera y segunda | 20 % |
| 6 | Teoremas del valor medio (Rolle, Lagrange) y aplicación a la regla de L'Hôpital | 10 % |

## Qué exigir con dureza

**D1. La definición del epígrafe 1 tiene que ser un límite bien escrito**, con la existencia del
límite como condición:

$$f'(a) = \lim_{h \to 0} \frac{f(a+h) - f(a)}{h}$$

Escribir la derivada como «la pendiente de la tangente» **no es la definición**: es la
interpretación. Si sólo aparece eso, no hay puntos de definición.

**D2. El teorema «derivable ⟹ continua» hay que demostrarlo**, no enunciarlo. La demostración es
corta y está en el guion: si sólo se enuncia, sólo los puntos de enunciado (§T4).

**D3. El contraejemplo del recíproco es obligatorio.** $f(x) = |x|$ en $x=0$ es suficiente y es el
esperado. Acepta cualquier otro correcto ($\sqrt[3]{x}$ para tangente vertical, la función de
Weierstrass si se justifica). **Un contraejemplo mal justificado no cuenta**: hay que ver las dos
derivadas laterales, $-1$ y $1$, no basta con decir «tiene un pico».

**D4. La regla de la cadena es el resultado central de este tema.** Exige, como mínimo, enunciado
completo con la hipótesis de derivabilidad de $g$ en $a$ y de $f$ en $g(a)$, y una justificación
seria de $(f \circ g)'(a) = f'(g(a)) \cdot g'(a)$. La demostración ingenua que multiplica y divide
por $g(a+h)-g(a)$ **sin tratar el caso en que ese incremento se anula** es incompleta: descuento de
0,50 puntos, y dilo. Si el alumno lo advierte y lo trata, aunque sea con una función auxiliar
esbozada, puntos completos.

**D5. Extremos relativos: el criterio es de condición necesaria, no suficiente.** «Si $f'(a)=0$
entonces hay extremo en $a$» es **falso** y es el error de concepto más caro de este tema. Cuenta
como §4.3 global. El contraejemplo $f(x)=x^3$ en $x=0$ debería aparecer; si no aparece pero el
enunciado es correcto, descuenta 0,25 puntos de rigor.

**D6. Rolle y Lagrange se enuncian con las tres hipótesis completas**: continuidad en el cerrado
$[a,b]$, derivabilidad en el abierto $(a,b)$, y en Rolle además $f(a)=f(b)$. Faltar una hipótesis
es enunciado falso (§T3). El error clásico es escribir derivabilidad en el cerrado.

**D7. L'Hôpital sólo se aplica sobre indeterminación** $\frac{0}{0}$ o $\frac{\infty}{\infty}$, y
requiere que exista el límite del cociente de derivadas. Si el desarrollo lo aplica sin nombrar la
indeterminación, es §6.1 global: 0,25 a 0,50 puntos.

## Qué no penalizar

**N1.** La notación de Leibniz ($\frac{dy}{dx}$), la de Lagrange ($f'$) y la de Newton ($\dot y$)
son todas aceptables. **Exige coherencia dentro de la exposición**, no una notación concreta.

**N2.** No exijas la demostración de las derivadas de las funciones elementales
($\sin$, $\cos$, $e^x$, $\ln$) salvo que el alumno las use como pieza central de otra cosa. Basta
con la tabla.

**N3.** No exijas la definición de derivada por sucesiones ni el tratamiento de la diferencial: no
están en el guion de este tema. Si aparecen y son correctas, no suman ni restan (§T10).

**N4.** El orden de los epígrafes 4 y 5 es indiferente. Cualquier orden que sea lógicamente
consistente es válido; no descuentes estructura por ello.

## Errores frecuentes en este buzón

Detéctalos y nómbralos explícitamente en el feedback: son los que más se repiten.

1. Confundir **$f'(a)$ con la función derivada $f'$**. Escribir «la derivada es $2x$» al preguntar
   por $f'(3)$.
2. **Regla del cociente con el numerador invertido**:
   $\frac{u'v + uv'}{v^2}$ o $\frac{uv' - u'v}{v^2}$ en lugar de $\frac{u'v - uv'}{v^2}$.
3. **Olvidar el factor interno de la cadena**: derivar $\sin(3x)$ como $\cos(3x)$.
4. Afirmar que **todo punto con $f''(a)=0$ es de inflexión**. Es condición necesaria, no
   suficiente: $f(x)=x^4$ en $x=0$.
5. Estudiar la monotonía **sin excluir los puntos que no pertenecen al dominio** al construir la
   tabla de signos. Es §6.2 global.
6. Decir que $|x|$ «no es derivable porque no es continua». Es continua; lo que falla son las
   derivadas laterales.

## Reparto de puntos

Los apartados y sus puntos vienen del `pointsAllocation` del buzón. Si un desarrollo mezcla varios
epígrafes en un bloque continuo sin separarlos, **reparte tú los puntos según a qué epígrafe
corresponde cada contenido** y explica el reparto en el feedback. No penalices por no haber
numerado los epígrafes igual que el guion, pero sí menciónalo en estructura si dificulta seguir la
exposición.
