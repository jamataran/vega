# ADR 0006 — Conectores LMS tras una interfaz mínima

**Estado**: Aceptado

## Contexto

Vega nace para una academia que usa **Moodle 3.x**. Pero el producto es AGPL y aspira a que otras
academias lo autoalojen, y cada una tiene su LMS: Moodle 4, Canvas, Classroom, o ninguno —hay
academias que reciben los exámenes escaneados en una carpeta compartida.

Hay dos formas de equivocarse aquí:

- **Acoplar el núcleo a Moodle 3.** El motor de corrección acabaría sabiendo qué es un
  `assignfeedback_file` y qué devuelve `mod_assign_get_submissions`. Cualquier otro LMS obligaría a
  reescribir por dentro.
- **Diseñar una abstracción de LMS completa** (cursos, matrículas, calendarios, competencias). Es
  la trampa clásica: se paga el coste de la generalidad antes de tener un segundo caso real que la
  valide, y cuando llega, no encaja igual.

Además, Moodle 3 tiene un riesgo concreto y conocido: **subir un fichero al área
`assignfeedback_file` por web services no es una operación limpia**. Puede exigir una secuencia
poco documentada o directamente no ser viable según la configuración. Ese riesgo no puede
propagarse al resto del sistema.

## Decisión

**Una interfaz de cuatro métodos, en `connectors/`, al mismo nivel que `apps/` y `packages/`.**

```
listSubmissions(mailboxRef)   -> metadatos de entregas disponibles
download(submissionRef)       -> el fichero de la entrega
publishGrade(ref, nota)       -> escribe la nota
publishFeedbackFile(ref, pdf) -> adjunta el PDF de feedback
```

Nada más. Ni cursos, ni usuarios, ni matrículas, ni sincronización bidireccional.

- El conector activo por buzón se guarda en `mailboxes.connector` (texto libre: `mock`,
  `filesystem`, `moodle3`), y el identificador de la tarea en el LMS en `mailboxes.lms_ref`.
- El conector por defecto del despliegue se fija con `LMS_CONNECTOR`, y `mock` es el valor por
  defecto en desarrollo.
- Se incluyen desde el principio tres implementaciones: `mock` (entregas simuladas en memoria),
  `filesystem` (lee de un directorio local; sirve para desarrollo **y** para academias sin LMS) y
  `moodle3`.
- Los conectores viven **fuera de `packages/`** a propósito: son puntos de extensión de terceros.
  Quien tenga otro LMS añade un directorio, implementa cuatro métodos y abre un PR sin necesidad de
  entender el resto del monorepo.
- **`publishGrade` y `publishFeedbackFile` son operaciones separadas.** Un conector puede
  implementar la primera y no la segunda.

## Consecuencias

**A favor**

- `packages/core` no sabe que existe Moodle. Se ejecuta por CLI sobre un PDF suelto, sin LMS
  ninguno.
- El conector `filesystem` convierte «no tengo LMS» en un caso soportado, no en un bloqueo. Amplía
  el mercado del producto sin código adicional.
- El conector `mock` permite construir toda la ingesta y probarla en CI sin un Moodle levantado.
- La superficie a implementar para contribuir un conector nuevo cabe en una tarde.
- El riesgo de `assignfeedback_file` queda **encapsulado en un método de una implementación**. Si
  resulta inviable en Moodle 3, el plan B (nota más feedback como comentario, PDF por otro canal)
  se implementa dentro de `moodle3` sin que nada más se entere.

**En contra**

- **La interfaz se queda corta para cosas legítimas.** Ejemplos previsibles: descubrir tareas del
  LMS para crear buzones automáticamente (hoy no hay `listAssignments`, y por eso tampoco hay
  `POST /api/mailboxes` — ver `HU-04`); saber si una entrega es una reentrega del alumno; leer la
  fecha límite. Cada una exigirá ampliar la interfaz, y ampliarla obliga a tocar todas las
  implementaciones.
- **No hay contrato sobre los modos de fallo.** Un token caducado en Moodle y una carpeta sin
  permisos en `filesystem` son errores muy distintos, y la interfaz los aplana. Mínimo exigible:
  todo conector distingue *fallo transitorio* (reintentable) de *fallo de configuración* (no
  reintentable), porque de eso depende si la publicación se reintenta sola o pasa a `error`.
- **`mailboxes.connector` es texto libre, sin `CHECK`.** Un valor mal escrito no lo detecta la base
  de datos; falla al resolverlo en tiempo de ejecución. Es deliberado —permite conectores de
  terceros sin migración— pero exige un error claro cuando el conector no existe.
- Los conectores de terceros no los podemos probar. Riesgo asumido de un proyecto abierto: se
  exige test de contrato contra la interfaz en el PR.
