# ADR 0012 — Ingesta idempotente por `remoteId`, almacén en sistema de ficheros y publicación en dos fases

**Estado**: Aceptado

**Relacionado con**: [ADR 0009](0009-interfaz-lms-siete-operaciones.md) (la interfaz que se
implementa aquí), [ADR 0010](0010-credencial-moodle-por-usuario.md) (de quién es el token con el que
se ingiere) y [ADR 0002](0002-migraciones-sql-planas.md) (forma de la migración).

## Contexto

Hasta ahora Vega hablaba con el LMS **sólo para el catálogo**: descubrir cursos, descubrir
actividades e importarlas. Las entregas las creaba el script de demostración y publicar era escribir
una fecha en la base de datos con un `TODO(vega)` al lado.

Eso convertía el circuito en una maqueta convincente con dos huecos que no se veían desde la
interfaz: el lote fabricaba rutas de fichero falsas (`examen.pdf#1`) que sólo el proveedor de IA
simulado toleraba —el real habría hecho `readFile` sobre ellas y habría reventado—, y una entrega
«publicada» no había llegado a ningún alumno.

Cerrar esos huecos obligaba a tomar tres decisiones que no eran obvias.

## Decisión

### 1. La identidad de una entrega ingerida es `(activity_id, remote_id)`

La clave natural existente —`UNIQUE (activity_id, student_ref, original_filename)`— se creó cuando
toda entrega tenía fichero. Desde que hay foros, `original_filename` es `NULL`, y en PostgreSQL dos
`NULL` **no colisionan** en un índice único: reingerir el mismo foro creaba entregas nuevas del
mismo alumno cada vez.

Con el proveedor simulado eso era ruido en la cola. **Con el motor encendido, cada duplicado se paga
en tokens**: una intervención de foro reingerida diez noches seguidas se corrige diez veces.

Se añade `submissions.remote_id` —el `SubmissionRef.remoteId` que el conector ya devolvía y que Vega
tiraba a la basura— con un índice único **parcial**:

```sql
CREATE UNIQUE INDEX submissions_remote_key
  ON submissions (activity_id, remote_id)
  WHERE remote_id IS NOT NULL;
```

Parcial porque las entregas sembradas y las anteriores a la ingesta no tienen `remote_id` y no deben
colisionar entre sí. La clave natural anterior **se conserva**: son dos redes, no una sustitución, y
`ON CONFLICT DO NOTHING` sin `target` respeta las dos.

De las tres opciones que `modelo-de-datos.md` dejaba planteadas —`NULLS NOT DISTINCT`, índice
parcial por tipo de actividad, o clave por `remoteId`— se elige la tercera porque es la única que
expresa la identidad real: **quien decide si dos entregas son la misma es el sistema de origen**, no
el nombre del fichero. `NULLS NOT DISTINCT` habría funcionado para foros y habría dejado el problema
inverso: un alumno con dos mensajes en el mismo foro pasaría a ser una sola entrega.

**Lo que esto no resuelve**: las reentregas. Quien vuelve a subir un fichero con el mismo nombre
sigue sin crear entrega nueva, y su versión buena se pierde en silencio. Es la pregunta abierta 1 de
HU-08 y sigue abierta a propósito: resolverla exige decidir si se corrige la primera o la última, y
eso es una decisión de producto, no de esquema.

### 2. Los ficheros del alumno viven en el sistema de ficheros, no en Postgres ni en S3

Un directorio (`STORAGE_ROOT`, un volumen del contenedor), con una ruta **relativa** guardada en
`submissions.storage_path`.

- **No en Postgres como `bytea`**: hincharía la base de datos con megas de escaneos que nunca se
  consultan por SQL, y encarecería cada copia de seguridad de lo único que de verdad importa
  respaldar.
- **No en un almacén de objetos S3-compatible**: el despliegue objetivo es una academia con un
  Docker y decenas de entregas por noche. Añadir S3 es una pieza más que mantener, respaldar y
  explicar, a cambio de nada que se note a ese volumen.

Dos reglas que hacen esto reversible y seguro:

- **La ruta guardada es relativa.** Guardar la absoluta ataría las filas al punto de montaje de hoy:
  mover el volumen dejaría inservible media tabla.
- **Todo pasa por `storage/files.ts`.** El día que el volumen se quede corto, se reescribe ese
  fichero y nadie más se entera. Y el nombre del fichero —que lo elige un alumno a través de Moodle,
  y `../../etc/passwd` es un nombre válido para Moodle— se sanea ahí, en un solo sitio, con pruebas.

El nombre original **no se pierde**: se conserva intacto en `submissions.original_filename`, que es
el que se le enseña al profesor. El del disco es un detalle interno.

### 3. Publicar son dos operaciones y se registran por separado

`publishGrade` y `publishFeedbackFile` son dos llamadas de red distintas, y la segunda puede fallar
con la primera ya hecha: **la nota está en Moodle y el alumno la ve, pero el PDF no llegó**.

Con una sola columna `published_at` no había forma de saber qué se había llegado a publicar, así que
un reintento habría vuelto a mandar la nota. Se añaden dos marcas —`grade_published_at` y
`feedback_file_published_at`— y `published_at` se reserva para «publicación completa», que es lo que
el resto del sistema ya lee.

Eso contesta la **pregunta abierta 2 de HU-17**, que planteaba tres opciones:

| Opción | Por qué no / por qué sí |
|---|---|
| (a) Dejar la entrega en `error` y reintentar sólo lo que falta | Se adopta el reintento parcial, **pero no el estado `error`**: ver abajo |
| (b) Marcar `published` con aviso | Se adopta, con la condición de que el aviso sea explícito y visible |
| (c) Invertir el orden y publicar antes el fichero | Se descarta: dejaría al alumno con explicación y sin nota, que es peor |

La resolución concreta es una mezcla deliberada de (a) y (b). **Si falla la nota**, no hay nada
publicado: la entrega queda en `error` con el motivo y se puede reintentar sin volver a validar. **Si
falla sólo el fichero**, la entrega llega a `published` y se guarda el porqué en
`corrections.publish_notice`, que la pantalla de revisión enseña.

El razonamiento: dejar en `error` una entrega cuya nota **ya está puesta y el alumno ya ve** obliga
al profesor a reintentar algo que no puede salir mejor —hay conectores donde el fichero no va a
llegar nunca— y le enseña a ignorar el estado `error`. Un aviso que dice exactamente qué falta es más
honesto que un estado que promete un reintento imposible.

Como consecuencia, **un conector que no admite el fichero de feedback deja de ser un caso de error**
y pasa a ser un caso soportado. Es exactamente la situación de Moodle 3 con `assignfeedback_file`
(HU-17, escenario 10), que era el riesgo técnico número uno del proyecto: ahora la nota llega aunque
ese spike nunca se resuelva.

## Consecuencias

**A favor**

- El circuito está completo de punta a punta: las siete operaciones de `LmsConnector` se invocan
  desde `apps/api`, y ya no hay ningún `TODO(vega)` donde debería haber una llamada al LMS.
- **El motor deja de recibir rutas falsas.** Es el hueco que `motor-ia.md` §14 señalaba como camino
  crítico oculto, y sin cerrarlo la transcripción no podía funcionar con el proveedor real.
- Reingerir es barato y seguro, que es lo que permite ejecutar el proceso a menudo sin miedo.
- El riesgo de `assignfeedback_file` deja de bloquear la publicación.

**En contra**

- **Los ficheros de los alumnos pasan a estar en un volumen, y eso son datos personales.** No hay
  política de retención, ni forma de borrarlos desde la aplicación, ni cifrado en reposo. Antes el
  problema no existía porque no se guardaba nada. Es la pregunta abierta 3 de HU-08 y ahora es real.
- El almacén es local a la máquina: dos réplicas del API no comparten ficheros. Es coherente con el
  despliegue de una réplica que ya asume el planificador, pero es una frontera más que cruzar el día
  que se escale.
- `remote_id` añade una segunda clave de unicidad. Dos redes son más difíciles de razonar que una, y
  hay que recordar que `ON CONFLICT DO NOTHING` sin `target` las cubre las dos.
- **Un PDF real llega al motor como un documento, no como N páginas.** Partirlo exigiría rasterizar.
  Mientras esa decisión no se tome, el proveedor simulado recibe una página donde antes recibía
  cuatro.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Ingesta como endpoint propio por actividad | HU-08 RN-9 lo excluye del contrato, y multiplicaría los sitios desde los que se llama al LMS. El lote es el único punto de entrada |
| Descargar siempre y decidir después si es nueva | Bajaría el examen de toda la clase cada noche para tirarlo. Se descarga sólo si el `INSERT` creó fila |
| Descartar las entregas ilegibles | Las haría invisibles: el alumno habría entregado y nadie lo sabría. Se registran en `error` con el motivo (HU-08, RN-8) |
| Publicar con la credencial del profesor que pulsa el botón | Falla en cuanto dos docentes comparten curso y sólo uno tiene permiso de calificación en Moodle. Se usa la de quien importó la actividad, que es la misma con la que se ingirió |
