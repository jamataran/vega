# ADR 0013 — Vega guarda la ficha del alumno, y el modelo ve sólo una parte

**Estado**: Aceptado

**Enmienda**: `HU-08` RN-4 y la entrada «Alumno» del glosario, que decían que Vega **no almacena el
nombre real** y que «a la API de IA nunca viaja más que `studentRef`». Ambas cosas dejan de ser
ciertas, y esconderlo sería peor que cambiarlas.

## Contexto

Hasta aquí, de un alumno Vega sabía un identificador (`moodle-4217`) y, opcionalmente, un alias que
**nadie rellenaba** —era la pregunta abierta 6 de HU-08—. Era una postura de minimización de datos
razonable mientras Vega sólo tenía que distinguir unas entregas de otras.

Deja de serlo por dos motivos distintos, y conviene no mezclarlos porque tienen fuerza muy desigual:

1. **La corrección depende de la comunidad autónoma.** Una oposición de matemáticas no se corrige
   igual en Andalucía que en Galicia: cambian el tribunal y los criterios. Ese dato existe en el
   Moodle del cliente como campo personalizado `CCAA` del perfil, y hasta ahora **no llegaba a
   Vega**, así que el modelo corregía sin saber contra qué convocatoria. Es un argumento de calidad
   de la corrección, no de comodidad.
2. **El profesor revisa de noche y firma notas.** «alumno-0003» no es un nombre. Saber de quién es
   lo que se está firmando no mejora la corrección, pero sí la revisión, que es donde está la
   responsabilidad.

El cliente ha pedido explícitamente que el nombre llegue también al modelo, sabiendo lo que implica.

## Decisión

### 1. Se guarda la ficha entera, en tabla propia

Tabla `students` (migración `0006`), con `student_ref` como clave natural —la identidad del LMS, que
es lo estable— y `submissions.student_id` apuntando a ella.

Tabla propia y no columnas en `submissions` porque **un alumno entrega muchas veces**: repetir su
perfil en cada fila haría que actualizar un dato exigiera recorrerlas todas, y que dos entregas
suyas pudieran discrepar.

La ficha se **refresca en cada ingesta**, también para entregas que ya existían: un opositor cambia
de comunidad entre convocatorias, y corregir con la del año pasado sería peor que no tener el dato.

### 2. Lo que Vega guarda y lo que el modelo ve no son lo mismo

Esta es la mitad importante del ADR.

| | Se guarda | Llega al modelo |
|---|---|---|
| Nombre y apellidos | Sí | **Sí** |
| Comunidad autónoma (`CCAA`) | Sí | **Sí** |
| Provincia, población | Sí | **Sí** |
| Correo, teléfono, nombre de usuario | Sí | No |
| Identificador del centro (`idnumber`) | Sí | No |
| NIF, DNI validado, dirección, código postal | Sí | **Nunca** |

El recorte lo hace **una sola función**, `studentContextFor()` en `@vega/shared`, y no está repartido
por el código: quien quiera cambiar qué se manda tiene que pasar por ahí, donde está escrito el
porqué y donde hay pruebas que fallan si se cuela un dato de identidad.

El mecanismo es una **lista de permitidos** ampliable por instalación, más una **lista de prohibidos
que gana siempre**. La segunda existe porque la primera es configurable: sin ella, añadir `NIF` a la
configuración por atajo o por descuido metería un documento de identidad en cada prompt, y nadie se
enteraría hasta que alguien preguntase.

**El criterio para decidir qué entra no es «¿es sensible?» sino «¿cambia la corrección?».** El NIF
de un opositor no mejora la corrección de una integral en absolutamente nada. La comunidad sí.

### 3. Los datos del alumno viajan con su trabajo, no con el contexto de la actividad

`GradeInput` gana un campo `student` **aparte** de `context`, y el proveedor lo escribe junto al
trabajo del alumno.

No es una cuestión de orden ni de estética: `context` es el prefijo que lleva `cache_control` y que
comparten todas las entregas de una misma actividad. Meter ahí un dato que cambia en cada entrega
**invalidaría la caché en todas ellas**, y el ahorro que justifica ordenar el lote por actividad
desaparecería. Un fallo así no da error: sólo multiplica la factura.

### 4. La comunidad se resuelve al ingerir y se guarda en su columna

`students.community`, además de quedar en `custom_fields`. Es el único campo del perfil que pesa en
la nota, y buscarlo dentro de un `jsonb` en cada entrega del lote sería caro y frágil.

Qué `shortname` la contiene es **configuración** (`STUDENT_COMMUNITY_FIELD`, por defecto `CCAA`),
porque el nombre del campo lo elige quien monta el Moodle.

Se guarda **tal cual llega**, sin partir ni normalizar, porque puede traer **varias separadas por
coma**: un opositor se presenta en más de una comunidad y todas condicionan el criterio. Quién sabe
interpretar esos valores es el contexto de corrección que escribe el profesorado, no el código.

## Consecuencias

**A favor**

- El modelo corrige sabiendo contra qué convocatoria, que era el agujero real.
- El profesor ve nombres en la cola y en la pantalla de revisión, y ve la comunidad justo donde
  decide si la propuesta parte de la referencia correcta.
- La frontera de qué sale hacia un tercero está en **una función con pruebas**, no en una regla
  escrita en una HU que nadie ejecuta. Es más difícil de romper por accidente que lo que había.

**En contra**

- **Vega pasa a ser responsable de datos personales de verdad**, y no sólo de identificadores. Un
  volcado de la base de datos ahora expone nombres, correos, teléfonos y —según la instalación— NIF
  y domicilios. Se suma a que los secretos ya se guardan en claro (ADR 0010): **no hay cifrado en
  reposo, y ahora importa más que ayer.**
- **No hay política de retención ni forma de borrar un alumno desde la aplicación.** Un derecho de
  supresión hoy se atiende con SQL a mano. La FK es `ON DELETE SET NULL` justamente para que borrar
  la ficha no se lleve por delante entregas ni correcciones firmadas, pero eso es la mitad del
  trabajo.
- **El nombre del alumno sale hacia Anthropic en cada corrección.** Es una decisión explícita del
  cliente y queda escrita aquí para que nadie tenga que reconstruirla después. Volver atrás es
  barato: quitar una línea de `studentContextFor()`.
- Una llamada más al LMS por ingesta, y un `UPSERT` por entrega listada.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| No traer nada y seguir con `studentRef` | Deja al modelo corrigiendo sin saber la convocatoria, que es el problema que había que resolver |
| Traer sólo la comunidad y no el nombre | Era la recomendación técnica y el cliente decidió lo contrario, con la implicación sobre la mesa. La decisión es suya |
| Mandar la ficha entera al modelo | Metería NIF, dirección y código postal en cada prompt, sin que ninguno de los tres pueda mejorar una corrección de matemáticas |
| Guardar la comunidad como una columna en `submissions` | Se desincronizaría entre entregas del mismo alumno y obligaría a reescribirlas todas al cambiar el dato |
| Meter los datos del alumno en el contexto resuelto | Invalidaría la caché de prompts de toda la actividad, en silencio y a cambio de nada |
| Lista de prohibidos sin lista de permitidos | Un campo personalizado nuevo en el Moodle del cliente empezaría a viajar al modelo sin que nadie lo hubiera decidido |
