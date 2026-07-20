# HU-03 — Ajustes y estado del sistema

| | |
|---|---|
| **Id** | HU-03 |
| **Épica** | Acceso y usuarios |
| **Estado** | borrador |
| **Prioridad** | Could |
| **Estimación** | 2 |
| **Depende de** | HU-01 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor o administrador
**quiero** una pantalla donde ver mi cuenta, la marca de la academia y qué está corriendo el
sistema por debajo
**para** saber en qué entorno estoy antes de validar una nota, y no confundir la demo con
producción.

Vega se despliega en dos entornos idénticos en apariencia
([ADR 0007](../decisiones/0007-dos-entornos-portainer.md)) y puede correr con el proveedor de IA
en `mock` ([ADR 0005](../decisiones/0005-proveedor-ia-intercambiable.md)). Un profesor que valide
veinte entregas en test creyendo estar en producción pierde el trabajo; uno que las valide en
producción creyendo estar en test publica notas reales. La pantalla de estado es barata y evita las
dos cosas.

Es también donde vive lo que hay de «ajustes», y desde H2 hay bastante más que antes: la
configuración de instalación (proveedor de IA, Moodle, SMTP, planificación, marca), que edita el
administrador en `app_settings`, y **la conexión con Moodle de cada usuario**, que edita cada uno
para sí. Esto último cambió el reparto de la pantalla: **`/ajustes` ya no es sólo de
administración**. Un profesor entra, ve su tarjeta «Mi conexión con Moodle» y el estado del sistema,
y no ve las secciones de instalación.

> **Esta HU está enmendada por H2.** RN-2 («no hay endpoint de ajustes») y RN-7 («las credenciales
> son variables de entorno y no se editan desde aquí») describían el sistema anterior. Se han
> reescrito abajo; los escenarios de esta HU siguen siendo los del bloque de estado y cuenta, y no
> cubren todavía las secciones de configuración.

## Criterios de aceptación

### Escenario 1: ver mi cuenta

```gherkin
Dado que he iniciado sesión como "profesor@academia.es" con rol "teacher"
Cuando abro la pantalla de ajustes
Entonces veo mi nombre, mi correo y la etiqueta "Profesor" (USER_ROLE_LABEL)
Y veo la fecha de mi último inicio de sesión
```

### Escenario 2: estado del sistema

```gherkin
Dado que he iniciado sesión
Y el despliegue tiene AI_PROVIDER=mock y LMS_CONNECTOR=mock
Cuando abro la pantalla de ajustes
Entonces la aplicación llama a GET /api/health
Y veo la versión de la aplicación
Y veo "Proveedor de IA: mock" y "Conector LMS: mock"
Y veo un aviso destacado de que el sistema está en modo simulado
```

### Escenario 3: aviso de modo simulado en producción

```gherkin
Dado que el despliegue tiene AI_PROVIDER=anthropic y LMS_CONNECTOR=moodle3
Cuando abro la pantalla de ajustes
Entonces veo "Proveedor de IA: anthropic" y "Conector LMS: moodle3"
Y no aparece ningún aviso de modo simulado
```

### Escenario 4: base de datos caída

```gherkin
Dado que la base de datos no responde
Cuando la aplicación llama a GET /api/health
Entonces recibo 200 con status = "degraded" y database = "down"
Y la pantalla muestra el estado degradado de forma visible
Y no muestra una pantalla de error genérica
```

### Escenario 5: cerrar sesión

```gherkin
Dado que he iniciado sesión
Cuando pulso "Cerrar sesión" y confirmo
Entonces el token se borra del almacenamiento del cliente
Y aterrizo en la pantalla de login
Y volver atrás en el navegador no me devuelve a una pantalla con datos
```

### Escenario 6: marca de la academia

```gherkin
Dado que el despliegue tiene BRAND_NAME "Academia Ejemplo" y un logo montado
Cuando abro cualquier pantalla de la aplicación
Entonces la cabecera muestra ese nombre y ese logo
Y la pantalla de ajustes indica de qué instalación se trata
```

### Escenario 7: instalar como PWA

```gherkin
Dado que abro Vega en un móvil con un navegador compatible
Y la aplicación no está instalada
Cuando abro la pantalla de ajustes
Entonces veo la opción de instalar la aplicación
Y al aceptarla, Vega queda como icono en la pantalla de inicio
```

## Reglas de negocio

**RN-1.** La pantalla es accesible para cualquier usuario autenticado, con rol `teacher` o `admin`,
y **enseña cosas distintas según el rol**. Un `teacher` ve su conexión con Moodle y el estado del
sistema. Un `admin` ve además las secciones de instalación. No hay pantalla de ajustes exclusiva de
administración: hay secciones que sí lo son.

**RN-2.** Los datos de cuenta salen de `GET /api/auth/me`; los de sistema, de `GET /api/health`; la
configuración de instalación, de `GET /api/settings`, que es **sólo de administrador** y devuelve
403 a un `teacher`. El cliente ni siquiera la pide si el usuario no es `admin`: pintar un error en
una pantalla que para él funciona sería confundirlo.

**RN-3.** Cuando `aiProvider` o `lmsConnector` valen `mock`, la UI muestra un aviso **persistente y
visible desde cualquier pantalla**, no sólo en ajustes. El profesor tiene que poder saberlo
mientras valida, no sólo si va a mirar.

**RN-4.** Cuando `HealthResponse.status` es `degraded`, la UI lo indica en la cabecera. Un sistema
con la base de datos caída no debe aparentar normalidad.

**RN-5.** «Cerrar sesión» borra el token del cliente. **No hay revocación en servidor**: el JWT
sigue siendo válido hasta caducar (HU-01, fuera de alcance).

**RN-6.** La marca (`BRAND_NAME` y el logo montado como volumen) es configuración de despliegue, no
de aplicación: no se edita desde la UI.

**RN-7.** ~~La configuración operativa es por variable de entorno y no se edita desde aquí.~~
**Enmendada en H2.** La configuración operativa —proveedor y modelos de IA, URL y conector de
Moodle, SMTP, planificación, nombre de marca— **se edita desde esta pantalla** y vive en
`app_settings`, que **manda sobre el fichero de entorno**. El `.env` pasa a ser el valor de partida
de una instalación nueva. Lo que sigue siendo sólo de entorno: `DATABASE_URL`, `JWT_SECRET`,
`JWT_EXPIRES_IN`, `WEB_ORIGIN`, `API_PORT`/`API_HOST` y `LMS_FILESYSTEM_ROOT`.

**RN-7 bis.** **Los secretos se escriben, nunca se leen.** La clave de Anthropic y la contraseña de
SMTP salen por la API como un booleano `…Configured`; enviar `null` los borra y omitirlos los deja
como están. Ningún secreto se devuelve, ni siquiera enmascarado.

**RN-8.** **El token de Moodle es de cada usuario, no de la instalación.** Vive en
`users.moodle_token` y cada uno edita el suyo con `PUT /api/auth/me/moodle-token`. El motivo es de
Moodle, no de Vega —`core_enrol_get_users_courses` devuelve los cursos del dueño del token—, así que
la credencial decide qué cursos ofrece la aplicación. La URL y el conector sí son de instalación.
Ver [ADR 0010](../decisiones/0010-credencial-moodle-por-usuario.md).

**RN-8 bis.** **Un administrador puede además poner y probar el token de otro usuario**, con
`PUT /api/users/{id}/moodle-token` y `POST /api/users/{id}/moodle-token/test` (HU-02). Existe porque
en Moodle un administrador sí puede emitir tokens a nombre de terceros, y esperar a que cada profesor
navegue hasta sus claves de seguridad es donde se atasca una instalación. **El valor sigue sin
leerse nunca**, tampoco para quien acaba de guardarlo.

**RN-9.** **Probar la conexión responde 200 con `ok: false`** cuando el token no vale, no un código
de error. `POST /api/auth/me/moodle-token/test` devuelve `MoodleConnectionResponse` con el sitio, el
usuario y cuántos cursos alcanza el token: un token válido pero del profesor equivocado no da
ningún error, y leer con quién se ha conectado es la única forma de detectarlo. Un fallo es una
respuesta legítima de esta ruta, y el profesor necesita leer *por qué* en el mismo sitio donde
acaba de pegar el token.

**RN-10.** **El token se guarda en claro en la base de datos.** No sale nunca por la API, pero no
hay cifrado en reposo: quien pueda leer Postgres tiene los tokens de todo el claustro. Es una
limitación conocida y declarada, no un descuido. Ver ADR 0010.

## Casos límite

| Caso | Qué se hace |
|---|---|
| `GET /api/health` no responde | Se muestra el bloque de estado como «no disponible». El resto de la pantalla (cuenta) sigue funcionando con los datos de la sesión |
| Sin logo montado | Se usa el logo por defecto de Vega. `BRAND_NAME` sigue aplicándose |
| `uptimeSeconds` muy bajo tras abrir la pantalla | Indica que el contenedor acaba de reiniciarse. Se muestra el dato tal cual, sin interpretarlo |
| El navegador no soporta instalación de PWA | No se muestra la opción de instalar. Nada más cambia |
| Cerrar sesión con ediciones sin guardar en otra pantalla | Se pide confirmación explícita advirtiendo de la pérdida |
| Un `teacher` abre ajustes | Ve su tarjeta «Mi conexión con Moodle» y el estado del sistema. No ve las secciones de instalación, y el cliente no llega a pedir `GET /api/settings` |
| Un `admin` abre ajustes | Ve primero su propia conexión con Moodle y después las secciones de instalación: un administrador también da de alta actividades y también necesita su token |
| El conector configurado es `mock` o `filesystem` | La tarjeta de conexión no exige token: esos conectores no usan credenciales de nadie |
| El profesor pega un token válido pero de otra persona | La prueba de conexión responde `ok: true` y muestra el sitio, el usuario y el número de cursos. Es lo único que permite detectarlo antes de importar actividades del curso que no era |
| El token es válido pero el servicio no tiene habilitada `core_enrol_get_users_courses` | `ok: true` con `courseCount: 0`, y el mensaje menciona esa función por su nombre. No se puede distinguir de «no tiene cursos» |

## Fuera de alcance

- ~~**Editar la configuración del sistema desde la UI.**~~ **Ya no lo está**: `GET`/`PATCH
  /api/settings` existen y la pantalla los usa (RN-7). Lo que sigue fuera es el **umbral de
  confianza** (0,75, constante en `batch.ts` y en un comentario de `domain.ts`) y el **destinatario
  del resumen nocturno**. Ver pregunta abierta 1.
- ~~**Editar credenciales desde la UI.**~~ **Ya no lo está**: la clave de Anthropic, la contraseña de
  SMTP y el token de Moodle de cada usuario se escriben desde aquí (RN-7 bis, RN-8).
- **Mostrar secretos.** Ni la clave de Anthropic, ni el token de Moodle, ni `JWT_SECRET`, ni
  siquiera enmascarados. Se escriben, no se leen.
- **Cifrar los tokens de Moodle en reposo.** Reconocido como limitación (RN-10); exige clave de
  despliegue, rotación y migración de lo ya guardado.
- **Gestionar el token de otro usuario desde esta pantalla.** Se hace desde la de usuarios (HU-02),
  y sólo un administrador (RN-8 bis).
- **Gestión de usuarios.** Es HU-02.
- **Preferencias de usuario** (tema claro/oscuro, idioma, densidad). No hay columna donde
  guardarlas.
- **Cambiar la propia contraseña.** Ver pregunta abierta 2.
- **Panel de métricas.** Es HU-18.

## Notas de implementación

**Contrato**: `MeResponse` (`{ user }`), `HealthResponse` (`status`, `version`, `database`,
`aiProvider`, `lmsConnector`, `uptimeSeconds`), `SettingsResponse` / `UpdateSettingsRequest`
(`AppSettings`: `anthropic`, `moodle`, `smtp`, `schedule`, `branding`),
`UpdateMoodleTokenRequest` y `MoodleConnectionResponse`.

**Endpoints** (`routes`):

| Clave | Método y ruta | Permiso |
|---|---|---|
| `health` | `GET /api/health` | Público, también sonda del proxy inverso |
| `me` | `GET /api/auth/me` | Autenticado |
| `settings` | `GET` / `PATCH /api/settings` | **Administrador** |
| `myMoodleToken` | `PUT /api/auth/me/moodle-token` | Autenticado, sólo el suyo |
| `testMyMoodleConnection` | `POST /api/auth/me/moodle-token/test` | Autenticado, sólo el suyo |

**Etiquetas**: `USER_ROLE_LABEL` de `@vega/shared` para el rol. No se escriben otra vez en el front.

**Precedencia de configuración**: `app_settings` primero, `.env` como respaldo. `lmsSettings()` en
`apps/api/src/lms/factory.ts` es el ejemplo: lee la fila y, si está vacía, cae en
`config.LMS_CONNECTOR` / `config.MOODLE_BASE_URL`.

**UI**: `apps/frontend/src/pages/SettingsPage.tsx`, última pestaña de la navegación inferior. Con
rol `teacher` devuelve una pantalla corta —`MoodleConnectionCard` + `SystemStatus`— y ni siquiera
lanza la consulta de ajustes. El aviso de modo simulado (RN-3) es un elemento global de la cabecera,
no de esta pantalla: se pinta a partir del `GET /api/health` que la aplicación hace al arrancar.

**Mock**: completa en la entrega mockeada. `GET /api/health` es real desde el primer día — es la
sonda del proxy inverso y la fuente del aviso de modo simulado, que es precisamente lo que hace
falta durante una demo.

## Preguntas abiertas

1. **¿Qué configuración debería ser editable desde la UI?** **Resuelta a medias.** La tabla
   `app_settings` y `GET`/`PATCH /api/settings` existen, y con ellas la periodicidad del lote
   (`schedule.everyMinutes`), los modelos, el proveedor, SMTP, la marca y la conexión con Moodle.
   Siguen sin ser editables el **umbral de confianza** (0,75, constante `AUTONOMY_CONFIDENCE_THRESHOLD`
   en `batch.ts` y comentario en `domain.ts`) y el **destinatario del resumen nocturno**. Para esos
   dos la pregunta sigue en pie, pero ya no cuesta una tabla ni un endpoint: cuesta dos claves.

2. **¿Puede un usuario cambiar su propia contraseña?** Hoy no: sólo un administrador puede, vía
   HU-02. Para un profesor al que el administrador le dio una contraseña por WhatsApp, eso es un
   problema real de seguridad. Implementarlo exige un endpoint nuevo (`PATCH /api/auth/password`)
   que pida la contraseña actual. No está en el contrato.

3. **¿Cómo debe verse el aviso de modo simulado sin volverse invisible por costumbre?** Una banda
   permanente en la cabecera se ignora a la semana. Opciones: (a) banda permanente; (b) color de
   fondo distinto en toda la aplicación para el entorno de test; (c) el nombre del entorno en la
   marca (`BRAND_NAME=Academia Ejemplo (TEST)`), que no requiere código. La (c) es gratis y
   probablemente la mejor: ¿basta con documentarlo como convención de despliegue?

4. **¿Debe la pantalla mostrar el modelo de IA en uso?** `HealthResponse` expone `aiProvider` pero
   no el modelo (`AI_MODEL_GRADING`). Saber con qué modelo se está corrigiendo es útil cuando se
   compara la desviación IA↔profesor entre periodos. Añadirlo exige ampliar `HealthResponse`.

5. **¿Hay algo que enseñar sobre privacidad y RGPD en esta pantalla?** El README dice que quien
   despliega Vega es responsable de reflejar en su política de privacidad que las entregas se
   envían a la API de Anthropic. ¿Debe la aplicación mostrar un enlace configurable a esa política,
   o queda del todo fuera del producto?
