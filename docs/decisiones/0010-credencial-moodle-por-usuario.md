# ADR 0010 — La credencial de Moodle es de cada profesor, no de la instalación

**Estado**: Aceptado

## Contexto

Hasta H2, Vega hablaba con Moodle con **un solo token de instalación**: la variable de entorno
`MOODLE_TOKEN`, y luego la clave `moodle.token` de `app_settings`, que el administrador escribía en
Ajustes. Es lo natural mientras el conector sólo baja entregas de una tarea conocida.

Deja de serlo en cuanto la aplicación tiene que **enseñar cursos**. La función de Moodle que los
lista es `core_enrol_get_users_courses`, y devuelve los cursos **del dueño del token**, no los de
quien pregunta. Con un token compartido, las consecuencias no son de matiz:

- Todo el claustro vería los cursos de una sola persona. Un profesor de lengua entraría a dar de
  alta su foro de dudas y se encontraría la programación de matemáticas.
- El profesor que no aparezca en los cursos del token **no puede usar la aplicación**, y el mensaje
  de error no le diría por qué.
- Un token de Moodle lleva los permisos de su dueño. Compartir el del administrador reparte
  permisos de administrador de Moodle entre todos los usuarios de Vega.

Hay además un detalle operativo que tira en la dirección contraria y que conviene no esconder: en
Moodle un administrador **sí** puede emitir un token a nombre de otro usuario. Esperar a que cada
profesor navegue hasta sus claves de seguridad es, en la práctica, la diferencia entre desplegar
Vega en una tarde y no desplegarla.

## Decisión

**El token de Moodle es de cada usuario. La URL y el conector son de la instalación.**

| Qué | De quién | Dónde vive | Quién lo edita |
|---|---|---|---|
| `MOODLE_BASE_URL` / `moodle.baseUrl` | Instalación | `app_settings` | Administrador, en Ajustes |
| `LMS_CONNECTOR` / `moodle.connector` | Instalación | `app_settings` | Administrador, en Ajustes |
| Token | **Cada usuario** | `users.moodle_token` | **Su dueño, y sólo él** |

Reglas que sostienen la decisión:

1. **`app_settings.moodle.token` deja de existir.** La migración `0003_courses.sql` lo **borra** en
   lugar de migrarlo a alguien: no hay forma de saber de quién era, y adjudicárselo a un usuario al
   azar le daría los cursos de otro.
2. **Cada usuario gestiona el suyo**, con `PUT /api/auth/me/moodle-token` y
   `POST /api/auth/me/moodle-token/test`, que actúan siempre sobre el usuario en sesión, sea cual
   sea su rol.
3. **Un administrador puede además poner y probar el de otro**, con
   `PUT /api/users/{id}/moodle-token` y `POST /api/users/{id}/moodle-token/test`. Es una concesión
   deliberada al alta de una instalación, no un permiso de propósito general: existe porque Moodle
   permite emitir tokens a nombre de terceros y porque un token mal pegado no da la cara hasta que su
   dueño intenta importar algo, y para entonces el administrador ya no está delante. **El token
   sigue sin leerse nunca**, tampoco para quien acaba de guardarlo.
4. **El token nunca sale por la API.** `User.moodleTokenConfigured` es un booleano; el valor no
   aparece en ninguna respuesta. Se escribe, no se lee.
5. **`activities.imported_by` guarda quién dio de alta cada actividad**, y con ello **con qué
   credencial se ingerirán sus entregas**. Sin esa columna, el lote no sabría con qué token bajarlas.
6. **`/ajustes` deja de ser una pantalla sólo de administración.** Cualquier usuario entra y ve «Mi
   conexión con Moodle» y el estado del sistema; las secciones de instalación —Anthropic, Moodle,
   SMTP, planificación, marca— siguen siendo de administrador, y `GET /api/settings` sigue
   devolviendo 403 a un `teacher`.
7. **Probar la conexión responde 200 con `ok: false`**, no un código de error. Un token inválido no
   es un fallo de esa ruta: es su respuesta, y el profesor está justo comprobando si funciona.

### La frontera que el token abre, Vega tiene que mantenerla por dentro

Un token personal impide que un profesor **descubra o importe** lo que no es suyo. Pero una vez la
actividad está dentro de Vega, esa frontera desaparecía: `GET /api/activities` devolvía **todas** las
actividades a cualquier usuario autenticado, y el `PATCH` dejaba a un profesor editar la de otro. Y
con las actividades iban las entregas, que llevan trabajo de alumnos concretos. Eso no es un permiso
mal puesto: es un asunto de protección de datos.

`0004_course_access.sql` cierra el hueco:

8. **El alcance se decide por curso, no por quién importó la actividad.** Tabla `course_teachers`
   (`course_id`, `user_id`, `seen_at`). En un curso con dos profesores, atarlo a quien pulsó el botón
   haría que cada uno viera media asignatura, aunque en Moodle tengan el mismo acceso.
9. **El acceso se registra al listar cursos**, que es el único momento en que Moodle dice la verdad
   sobre a qué alcanza un profesor. `GET /api/courses/discover` da de alta los cursos y anota el
   acceso.
10. **El acceso no caduca.** No se borra lo que un día deja de aparecer: si Moodle se cae o el token
    expira, el profesor tiene que seguir pudiendo revisar y validar lo que ya está en Vega. Retirar
    a alguien se hace **dando de baja al usuario**, no dejando de verlo una mañana.
11. **`imported_by` sigue valiendo como llave de respaldo**, y no es redundante: cubre las
    actividades anteriores a que existieran los cursos y las importadas antes de que el profesor
    volviera a listar los suyos. Quien dio de alta una actividad no la pierde de vista nunca.
12. **Un administrador lo ve todo.** No es un atajo: es quien da de alta al profesorado, quien
    publica lo que se queda sin dueño y quien tiene que poder mirar cualquier corrección cuando
    alguien reclama una nota.
13. **Acceder a la actividad de otro devuelve 403, no 404.** Dentro de una academia, decirle a un
    profesor que la actividad existe pero es de otro le ahorra pensar que ha perdido su trabajo, y no
    revela nada que no supiera: comparten claustro y comparten Moodle.

## Consecuencias

**A favor**

- Cada profesor ve sus cursos y sólo los suyos. Es la única configuración en la que el paso de
  «elegir curso» de HU-19 significa algo.
- Nadie hereda los permisos de Moodle de otra persona. Revocar el acceso de un profesor en Moodle
  surte efecto en Vega sin tocar Vega.
- El fallo más probable —token caducado— afecta a un usuario, no a la instalación entera.
- Un administrador puede seguir usando la aplicación como profesor: la pantalla de Ajustes le pinta
  su tarjeta de conexión antes que las secciones de administración, porque un administrador también
  da de alta actividades.
- Las entregas de los alumnos dejan de ser visibles para todo el claustro. La regla vive en un solo
  módulo (`apps/api/src/auth/scope.ts`) para que ninguna ruta se olvide de aplicarla.

**En contra**

- **El token se guarda en claro en la base de datos.** `users.moodle_token` es una columna `text`
  sin cifrar. La API no lo devuelve nunca, pero cualquiera con acceso de lectura a Postgres —una
  copia de seguridad, un volcado para depurar, el propio administrador de la máquina— tiene los
  tokens de todo el claustro, y con ellos sus permisos en Moodle. **Es una limitación conocida y no
  resuelta.** Cifrar en reposo exige una clave de despliegue, decidir qué pasa cuando se rota y un
  camino de migración para los tokens ya guardados; nada de eso está hecho.
- **El lote nocturno no tiene credencial propia.** Corre sin usuario en sesión, así que la única
  respuesta a «¿con qué token bajo estas entregas?» es `activities.imported_by`. Consecuencias
  directas:
  - Si quien importó la actividad **se da de baja**, `imported_by` pasa a `NULL`
    (`ON DELETE SET NULL`): la actividad sobrevive, con sus entregas y sus correcciones, pero su
    ingesta se queda sin credencial. La política del modelo de datos es **desactivar usuarios, no
    borrarlos**, precisamente para que esto no pase por accidente.
  - Si su token **caduca o se revoca**, la ingesta de esa actividad falla y las demás siguen. El
    fallo hay que atribuirlo a un profesor concreto y avisarle a él, no al administrador. **Eso aún
    no está implementado**: la ingesta sigue sin cablear (H3) y no hay ninguna alerta.
  - Dos profesores del mismo curso importan cada uno sus actividades con su propio token. Es
    correcto, pero significa que el lote de una noche puede usar varias credenciales distintas.
- **Reponer un token es trabajo manual y personal.** Nadie puede hacerlo por el profesor, ni
  siquiera en una urgencia.
- **En desarrollo hay que pegar el token tras cada `db:seed`.** Se mitiga con `MOODLE_TOKEN`, que
  pasa a ser **sólo semilla**: `db:seed` se lo asigna a los dos usuarios de ejemplo. No es
  configuración de producción, y ningún camino de la aplicación lo lee en tiempo de ejecución.
- **`GET /api/health` sigue sin decir nada sobre credenciales.** Expone el conector configurado, no
  si el token de nadie sirve. Comprobarlo es, por definición, por usuario.
- **La ruta de administración debilita el argumento del punto 2.** Si un administrador puede pegar
  el token de otro, el token deja de ser estrictamente personal en el sentido fuerte: alguien más lo
  ha tenido en la mano. Se acepta a cambio de que la instalación sea viable, y se acota a que el
  valor no se lea nunca desde ninguna ruta.
- **Un profesor que nunca haya abierto el alta de actividades no tiene ningún acceso registrado.** No
  aparecerá en `course_teachers` hasta que liste sus cursos por primera vez, así que hasta entonces
  sólo ve lo que él mismo importó. La migración `0004` da acceso retroactivo a partir de
  `imported_by`, pero lo que no tenga ni eso sólo lo verá un administrador.
- **Nada limpia `course_teachers`.** Un profesor que cambia de departamento conserva el acceso a sus
  cursos antiguos hasta que se le da de baja. Es la contrapartida directa del punto 10, y es
  deliberada: preferimos un acceso de más a que alguien pierda el suyo porque Moodle no respondió.
- **El alcance no llega a los contextos de corrección, y ahí queda un agujero.** `GET /api/contexts`
  devuelve los de todas las actividades, y `PUT /api/contexts/activity/{slug}` deja a cualquier
  profesor reescribir el criterio con el que se corrige a alumnos que no son suyos. No es una entrega
  ni un dato personal, así que no es el mismo problema que motivó la `0004`, pero contradice su
  premisa. **Pendiente de decidir en HU-06.**
