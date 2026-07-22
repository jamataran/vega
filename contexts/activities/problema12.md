# problema12 — Integral definida: cálculo de áreas y aplicaciones

- **Tipo de tarea**: `simulacro_problema`
- **Nota máxima**: 10
- Aplica sobre el contexto global y la plantilla `simulacro-problema` resueltos por Vega.

## Estructura del examen

Cuatro problemas independientes. El reparto exacto de puntos está en el `pointsAllocation` del
buzón; el contenido de cada uno:

| Apartado | Contenido |
|---|---|
| 1 | Cálculo de una integral definida con cambio de variable o por partes |
| 2 | Área encerrada entre dos curvas, con determinación previa de los puntos de corte |
| 3 | Volumen de revolución (discos o capas) |
| 4 | Aplicación del teorema fundamental del cálculo: derivar una función definida por una integral |

Los apartados **son independientes**: no hay arrastre entre ellos. Sí lo hay dentro de cada uno.

## Qué exigir con dureza

**D1. Los límites de integración cambian con la variable.** Es el error más caro de este examen. En
un cambio $u = g(x)$, o se cambian los extremos a $g(a)$ y $g(b)$, o se deshace el cambio antes de
evaluar. Hacer el cambio, evaluar con los extremos originales y no darse cuenta es **error de
concepto** (§4.3 global): se pierde el desarrollo completo del apartado, no sólo el resultado.

**D2. El área es la integral del valor absoluto de la diferencia.** En el apartado 2, hay que
determinar los puntos de corte, **decidir qué función va por encima en cada tramo** y partir la
integral. Integrar $f-g$ de un extremo a otro sin comprobar si se cruzan dentro del intervalo es
error de concepto: el resultado puede ser menor que el área real, o incluso cero.

**D3. Si el resultado de un área sale negativo o cero** en una región claramente no degenerada y el
alumno lo escribe sin inmutarse, aplica §3.5 global: **0,25 puntos adicionales de descuento** por
falta de sentido crítico. Un área negativa es imposible y hay que verlo.

**D4. Los puntos de corte hay que resolverlos, no estimarlos.** Leerlos de un dibujo aproximado no
vale. Si el alumno los obtiene gráficamente sin resolver $f(x)=g(x)$, no hay puntos de
planteamiento en ese apartado.

**D5. El teorema fundamental exige continuidad del integrando.** En el apartado 4, aplicar
$F'(x) = f(x)$ sin mencionar que $f$ es continua en el intervalo es §6.1 global: 0,25 a 0,50
puntos. Y si el límite superior es una función $g(x)$, **hace falta la regla de la cadena**:

$$\frac{d}{dx}\int_{a}^{g(x)} f(t)\,dt = f(g(x)) \cdot g'(x)$$

Olvidar el factor $g'(x)$ es error de concepto, no descuido.

**D6. La variable de integración es muda.** Escribir $\int_a^x f(x)\,dx$ es notación que cambia el
significado (§7.7 global): error de concepto en un apartado donde el objeto de estudio es
precisamente esa función. En los demás apartados, trátalo como §7.6, aviso de 0,25 puntos.

**D7. Volumen de revolución: la fórmula depende del eje y del método.** Discos alrededor de $OX$:
$V = \pi\int_a^b [f(x)]^2 dx$. Capas alrededor de $OY$: $V = 2\pi\int_a^b x\,f(x)\,dx$. Confundir
métodos o ejes es error de concepto. **Olvidar el $\pi$ o el cuadrado** es error de concepto, no
aritmético: la fórmula está mal.

**D8. Integración por partes: hay que declarar $u$ y $dv$.** No exijas justificar la elección, pero
sí que quede escrita. Si el desarrollo salta directamente al resultado de aplicar la fórmula, no
hay puntos de desarrollo (§4.5 global).

## Qué no penalizar

**N1.** La constante de integración **no se pone en una integral definida**. Si el alumno la
arrastra y luego la cancela correctamente al evaluar, es notación descuidada: 0,25 puntos como
mucho, §7.6 global. No es error de concepto.

**N2.** Cualquier cambio de variable válido vale, aunque no sea el de la solución de referencia.
Márcalo como método alternativo y verifícalo (§5 global). Lo mismo con resolver un área integrando
respecto de $y$ en lugar de respecto de $x$: si funciona, puntúa completo.

**N3.** No exijas simplificar radicales ni racionalizar en el resultado final, salvo que el
enunciado lo pida. Sí exige el **valor exacto**: si el enunciado no pide aproximación, una respuesta
como $4{,}67$ en lugar de $\frac{14}{3}$ pierde el componente de resultado (§P7).

**N4.** Un dibujo de la región **no es obligatorio**, pero si aparece y es correcto, ayuda a
verificar el planteamiento: úsalo para dar por buena la decisión de qué función va encima. Si el
dibujo está mal pero el desarrollo bien, corrige el desarrollo y menciona el dibujo sin descontar.

## Unidades

Los apartados 2 y 3 son geométricos. **El resultado sin unidades cuadradas o cúbicas pierde el
componente de resultado** (§7.5 global). $u^2$ y $u^3$ son aceptables como unidades genéricas.

## Errores frecuentes en este buzón

1. Extremos de integración sin cambiar tras la sustitución (D1).
2. Área calculada sin partir la integral en los cortes intermedios (D2).
3. Olvidar el $\pi$ del volumen de revolución.
4. Al derivar la función integral, olvidar $g'(x)$ (D5).
5. Confundir el área encerrada con la integral definida y dar un resultado negativo.
6. Integrar por partes eligiendo $u$ y $dv$ de modo que la integral resultante es peor, y
   abandonar. Aquí puntúa el planteamiento y la parte ejecutada (§4.4 global): la elección
   desafortunada no es un error, sólo es ineficiente.
