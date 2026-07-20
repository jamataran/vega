# ADR 0009 — La interfaz `LmsConnector` crece a siete operaciones

**Estado**: Aceptado
**Sustituye a**: [ADR 0006](0006-conectores-lms-interfaz-minima.md)

## Contexto

El [ADR 0006](0006-conectores-lms-interfaz-minima.md) fijó una interfaz de cuatro operaciones
—`listSubmissions`, `download`, `publishGrade`, `publishFeedbackFile`— y anticipó en su propia
sección de consecuencias las dos formas en que se quedaría corta:

> «Ejemplos previsibles: **descubrir tareas del LMS** para crear buzones automáticamente (hoy no hay
> `listAssignments`…)».

> «**No hay contrato sobre los modos de fallo.** Un token caducado en Moodle y una carpeta sin
> permisos en `filesystem` son errores muy distintos, y la interfaz los aplana.»

H2 ha llegado a las dos a la vez. Dar de alta actividades desde la aplicación (HU-19) exige que
Vega pregunte al LMS qué hay, y hacerlo sobre un Moodle real —no sobre siete actividades de
ejemplo— obliga a tres cosas que la interfaz de cuatro operaciones no permitía:

1. **Elegir curso antes que actividad.** Un Moodle de departamento tiene decenas de cursos y
   cientos de actividades. Un catálogo completo obliga al LMS a resolver las actividades de todos
   los cursos para que el profesor mire uno: no escala en tiempo de respuesta ni en la pantalla.
2. **Comprobar que la credencial vale sin efectos secundarios.** El fallo más probable en
   producción no es un error del código: es un token caducado, revocado o sin permisos. El profesor
   necesita saberlo en Ajustes, cuando lo pega, no cuando el lote falle de madrugada.
3. **Distinguir «tu token no vale» de «Moodle no responde».** El primero lo arregla el profesor y
   no se reintenta; el segundo se reintenta sin cambiar nada. Aplanarlos en un `Error` genérico
   deja al profesor con una pantalla de fallo idéntica para dos problemas opuestos —los escenarios
   7 y 8 de HU-19.

Además, `listActivities()` ya existía en la interfaz —añadida sin ADR cuando el catálogo era una
constante simulada— pero devolvía el catálogo entero y sin filtro posible.

## Decisión

**Siete operaciones, y un contrato explícito de modos de fallo.**

```
listCourses()                        -> cursos que ve la credencial
verifyConnection()                   -> con qué sitio y como quién se ha conectado
listActivities(moodleCourseId?)      -> entregas y foros, de un curso o de todos
listSubmissions(activityRef)         -> metadatos de entregas disponibles
download(submissionRef)              -> el fichero de la entrega
publishGrade(ref, nota)              -> escribe la nota
publishFeedbackFile(ref, pdf)        -> adjunta el PDF de feedback
```

Lo que se conserva del ADR 0006 sin cambio: los conectores viven **fuera de `packages/`** porque son
puntos de extensión de terceros; el conector activo se fija con `LMS_CONNECTOR` y desde Ajustes;
siguen existiendo `mock`, `filesystem` y `moodle3`; `publishGrade` y `publishFeedbackFile` siguen
siendo operaciones separadas, y un conector puede implementar una y no la otra.

Lo que cambia:

1. **`listCourses()` es el primer paso del alta**, no un lujo. El curso es una entidad de Vega
   desde la migración `0003_courses.sql`, y el conector devuelve `DiscoveredCourse`
   (`moodleCourseId`, `name`, `shortName`).
2. **`listActivities(moodleCourseId?)` acepta curso.** Sin argumento devuelve el catálogo entero,
   que puede ser caro; el API siempre lo pasa, porque `GET /api/activities/discover` **exige**
   `?moodleCourseId=`.
3. **`verifyConnection()` devuelve `LmsConnectionInfo`** (`siteName`, `username`, `courseCount`) en
   lugar de un booleano. Un token válido pero del profesor equivocado no da ningún error: leer con
   quién se ha conectado es la única forma de detectarlo antes de dar de alta media programación en
   el curso que no era.
4. **Dos errores tipados, obligatorios para cualquier conector**, en `connectors/lms/src/types.ts`:

   | Clase | `code` | Significado | ¿Reintentar? |
   |---|---|---|---|
   | `LmsAuthError` | `LMS_AUTH` | Credencial caducada, revocada o sin permisos | No: hay que pasar por Ajustes |
   | `LmsUnavailableError` | `LMS_UNAVAILABLE` | El LMS no responde o devuelve algo ininteligible | Sí, sin cambiar nada |

   Se reconocen por su `code` y no con `instanceof`: entre dos copias del paquete —dos
   `node_modules`, un bundle duplicado— `instanceof` falla en silencio y la interfaz acabaría
   enseñando el error genérico justo cuando más importa distinguirlo. Eso es lo que hace
   `isLmsError()`.
5. **Esos errores llegan al cliente sin aplanarse.** `apps/api/src/lms/factory.ts` los traduce a los
   códigos `LMS_AUTH` (422) y `LMS_UNAVAILABLE` (502) del contrato HTTP. **`LMS_AUTH` no es 401 a
   propósito**: el cliente cierra la sesión al recibir un 401, y echar al profesor de Vega porque su
   token de Moodle ha caducado sería absurdo.
6. **`alreadyImported` lo decide Vega, no el conector.** El conector no sabe qué hay dado de alta y
   devuelve siempre `false`; la capa de aplicación lo corrige. Es la regla que impide que el
   conector necesite consultar la base de datos de Vega.

## Consecuencias

**A favor**

- El alta de actividades funciona sobre un Moodle real y no sobre una constante. `MOODLE_CATALOGUE`
  ha desaparecido de `apps/api/src/routes/activities.ts`.
- El fallo más probable en producción tiene un mensaje que lleva a la solución, y la pantalla sabe
  si ofrecer «Reintentar» o «Ir a Ajustes».
- `verifyConnection()` da a Ajustes un botón de probar conexión que no tiene efectos secundarios:
  en `moodle3` es `core_webservice_get_site_info`, la llamada más barata del web service y sin
  parámetros, así que si falla el problema es el token o el sitio, nunca lo que se ha pedido.
- La cifra sigue siendo pequeña. Siete métodos se implementan en una tarde, que era el criterio del
  ADR 0006 y no ha cambiado.

**En contra**

- **Ampliar la interfaz obliga a tocar todas las implementaciones.** Ha pasado ya con `mock`,
  `filesystem` y `moodle3`, y volverá a pasar. Cualquier conector de terceros escrito contra el
  ADR 0006 deja de compilar.
- **La cifra crecerá otra vez.** Quedan carencias conocidas y legítimas: saber si una entrega es una
  reentrega, leer la fecha límite, importar la rúbrica o el reparto de puntos. Cada una es un método
  más. «Mínima» es una dirección, no un número.
- **`verifyConnection()` no puede comprobarlo todo.** En `moodle3` responde bien con un token que
  ve el sitio pero no las funciones de tareas o de foros: la lista de cursos sale vacía y el mensaje
  lo dice, pero la aplicación no puede distinguir «no tiene cursos» de «al servicio le falta habilitar
  `core_enrol_get_users_courses`».
- **Nada de esto está verificado contra un Moodle real.** `moodle3` tiene tests unitarios con
  `fetchImpl` inyectado y varios `TODO(vega)` sin cerrar: si un profesor ve aquí los cursos que
  imparte —y no sólo aquellos en los que figura como alumno—, qué pasa con los cursos ocultos o
  archivados, y el formato de `duedate`. Sigue siendo el riesgo principal del proyecto.
- **`pendingCount` sigue sin ser comparable entre tipos.** En una entrega se devuelve `0` a
  propósito, porque contarlo exigiría `mod_assign_get_submissions` completo por actividad; en un foro
  es `numdiscussions`, que cuenta debates y no mensajes. La UI nombra la unidad («3 debates», «6
  entregas pendientes») en lugar de fingir que son lo mismo, pero el `0` de las entregas sigue
  siendo falso. Ver HU-19, pregunta abierta 5.
