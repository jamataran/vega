# HU-01 — Inicio de sesión y sesión persistente

| | |
|---|---|
| **Id** | HU-01 |
| **Épica** | Acceso y usuarios |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 3 |
| **Depende de** | ninguna |
| **Bloquea a** | HU-02, HU-14 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor de la academia
**quiero** entrar en Vega con mi correo y mi contraseña, y que la sesión aguante entre usos
**para** poder ponerme a corregir desde el móvil sin autenticarme cada vez que abro la aplicación.

Vega es autosuficiente en autenticación: no hay SSO, ni OAuth, ni dependencia del LMS. Un usuario
es una fila en `users` con un hash de contraseña. Es una decisión de simplicidad de despliegue —una
academia que instala Vega no debería tener que configurar un proveedor de identidad.

El contexto de uso manda sobre el diseño: el profesor corrige de pie, entre clases, con una mano y
con el móvil. Volver a escribir la contraseña cada vez que la PWA se cierra convierte la corrección
en algo que se pospone.

## Criterios de aceptación

### Escenario 1: inicio de sesión correcto

```gherkin
Dado que existe un usuario con email "profesor@academia.es", contraseña "correcta123" y active = true
Cuando envío POST /api/auth/login con ese email y esa contraseña
Entonces recibo 200 con un cuerpo que valida contra LoginResponse
Y el cuerpo contiene un "token" no vacío
Y "expiresAt" es una fecha futura acorde a JWT_EXPIRES_IN
Y "user.role" es "teacher"
Y el cuerpo NO contiene ningún campo con el hash de la contraseña
Y la columna users.last_login_at de ese usuario queda actualizada
```

### Escenario 2: contraseña incorrecta

```gherkin
Dado que existe un usuario con email "profesor@academia.es"
Cuando envío POST /api/auth/login con ese email y la contraseña "loquesea"
Entonces recibo 401 con error.code = "UNAUTHORIZED"
Y error.message es "Correo o contraseña incorrectos"
```

### Escenario 3: el correo no existe — mismo mensaje

```gherkin
Dado que no existe ningún usuario con email "nadie@academia.es"
Cuando envío POST /api/auth/login con ese email y cualquier contraseña
Entonces recibo 401 con error.code = "UNAUTHORIZED"
Y error.message es exactamente el mismo que en el escenario 2
Y el tiempo de respuesta es del mismo orden que en el escenario 2
```

### Escenario 4: usuario desactivado

```gherkin
Dado que existe un usuario con email "antiguo@academia.es" y active = false
Cuando envío POST /api/auth/login con sus credenciales correctas
Entonces recibo 403 con error.code = "FORBIDDEN"
Y error.message explica que la cuenta está desactivada
Y no se emite ningún token
```

### Escenario 5: validación del formulario

```gherkin
Dado que estoy en la pantalla de login
Cuando escribo "no-es-un-correo" en el campo de correo y envío
Entonces el formulario no llega a hacer la petición
Y se muestra el mensaje "Introduce un correo válido" junto al campo
```

### Escenario 6: la sesión sobrevive a cerrar la PWA

```gherkin
Dado que he iniciado sesión correctamente en la PWA
Y he cerrado la aplicación por completo
Cuando la vuelvo a abrir antes de que caduque el token
Entonces la aplicación llama a GET /api/auth/me con el token guardado
Y recibo 200 con MeResponse
Y aterrizo en la cola de revisión sin ver la pantalla de login
```

### Escenario 7: token caducado

```gherkin
Dado que tengo guardado un token cuyo expiresAt ya ha pasado
Cuando abro la aplicación
Entonces cualquier llamada al API responde 401 con error.code = "UNAUTHORIZED"
Y la aplicación descarta el token guardado
Y me lleva a la pantalla de login con un aviso de sesión caducada
Y tras iniciar sesión vuelvo a la pantalla que intentaba abrir
```

### Escenario 8: acceso sin token

```gherkin
Dado que no he iniciado sesión
Cuando envío GET /api/submissions sin cabecera Authorization
Entonces recibo 401 con error.code = "UNAUTHORIZED"
```

### Escenario 9: desactivado durante la sesión

```gherkin
Dado que tengo un token válido y sin caducar
Y un administrador ha puesto mi usuario en active = false
Cuando envío GET /api/auth/me
Entonces recibo 403 con error.code = "FORBIDDEN"
Y la aplicación cierra la sesión
```

## Reglas de negocio

**RN-1.** La autenticación es por JWT en cabecera `Authorization: Bearer <token>`. El token se
firma con `JWT_SECRET` y caduca según `JWT_EXPIRES_IN` (12 h por defecto).

**RN-2.** Credenciales inválidas y correo inexistente devuelven **la misma respuesta**: mismo
código, mismo mensaje y tiempo de respuesta comparable. No se filtra qué correos están dados de
alta. Esto obliga a ejecutar la verificación del hash también cuando el usuario no existe.

**RN-3.** `active = false` impide iniciar sesión **y** invalida los tokens ya emitidos: el estado
se comprueba en cada petición autenticada, no sólo al hacer login.

**RN-4.** Las contraseñas se almacenan hasheadas con un algoritmo de derivación con coste
configurable. `users.password_hash` **nunca** sale de la base de datos hacia la API: el esquema
`User` de `@vega/shared` ni siquiera tiene ese campo.

**RN-5.** El login correcto actualiza `users.last_login_at`.

**RN-6.** El token se guarda en el cliente de forma que sobreviva al cierre de la PWA. Al abrir la
aplicación se valida contra `GET /api/auth/me` antes de pintar nada que dependa de la sesión.

**RN-7.** Cualquier respuesta 401 del API provoca cierre de sesión en el cliente: descarta el
token y lleva al login. Un 403 por usuario desactivado también.

**RN-8.** Tras un login forzado por caducidad, el cliente vuelve a la ruta que el usuario intentaba
abrir.

**RN-9.** El primer administrador del sistema no se crea por esta HU: se crea con
`pnpm --filter api create-admin` desde la línea de comandos. No hay auto-registro.

## Casos límite

| Caso | Qué se hace |
|---|---|
| El token caduca mientras el profesor edita una corrección sin guardar | El cliente conserva las ediciones en memoria, pide login y, al volver, reintenta el guardado. **No** se pierden los cambios sin avisar |
| Reloj del dispositivo desfasado | `expiresAt` es informativo para la UI; la validez la decide el servidor. Un cliente adelantado pide login antes de tiempo; uno atrasado recibe 401 y cierra sesión |
| Correo con mayúsculas o espacios | Se normaliza a minúsculas y se recortan espacios antes de buscar. `users.email` es UNIQUE sobre el valor normalizado |
| Varias sesiones a la vez (móvil y escritorio) | Permitido. Los JWT son independientes y no hay registro de sesiones |
| `JWT_SECRET` cambia en un despliegue | Todos los tokens dejan de validar. Todo el mundo tiene que volver a entrar. Aceptado; no se documenta como incidencia |
| Fuerza bruta sobre el login | Fuera de alcance de esta HU. El endurecimiento (rate limiting) es una tarea de infraestructura, no de producto — ver preguntas abiertas |
| El usuario se desactiva a sí mismo | Imposible: es HU-02 quien lo impide con un 409 |

## Fuera de alcance

- **Recuperación de contraseña.** No hay «he olvidado mi contraseña»: el administrador la
  restablece desde HU-02. La academia tiene cinco profesores, no cinco mil.
- **Cambio de contraseña por el propio usuario.** Ver HU-03.
- **Refresh tokens y revocación en servidor.** No están en el contrato; ver preguntas abiertas.
- **Cierre de sesión explícito en servidor.** El botón de salir borra el token en el cliente; el
  JWT sigue siendo válido hasta que caduca.
- **Segundo factor, SSO, OAuth, LDAP.** Decisión de producto: Vega es autosuficiente.
- **Auto-registro de usuarios.** No existe.
- **Rate limiting y bloqueo por intentos fallidos.** Endurecimiento posterior.

## Notas de implementación

**Entidades** (`@vega/shared`): `User`, `UserRole` (`teacher` | `admin`).

**Contrato**: `LoginRequest` (con los mensajes en español ya escritos en el esquema Zod:
«Introduce un correo válido», «La contraseña es obligatoria»), `LoginResponse`
(`{ token, expiresAt, user }`), `MeResponse` (`{ user }`).

**Endpoints** (`routes`): `login` → `POST /api/auth/login` (público); `me` → `GET /api/auth/me`
(autenticado).

**Errores** (`ApiError.code`): `BAD_REQUEST` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403.

**Esquema**: tabla `users` (`email UNIQUE`, `password_hash`, `role CHECK IN ('teacher','admin')`,
`active DEFAULT true`, `last_login_at`).

**UI**: pantalla de login mobile-first. Campo de correo con `inputmode="email"` y
`autocomplete="username"`; contraseña con `autocomplete="current-password"` para que el gestor de
contraseñas del móvil funcione. Botón de mostrar/ocultar contraseña. Los mensajes de validación
salen del propio esquema Zod, no se escriben otra vez en el front.

**Mock**: en la entrega mockeada el login es **real** (usuarios en base de datos, hash real, JWT
real). Lo simulado es el resto del sistema, no la autenticación: es barata de hacer bien desde el
principio y hacerla falsa obligaría a rehacerla.

## Preguntas abiertas

1. **¿Hace falta refresh token, o basta con alargar `JWT_EXPIRES_IN`?** El contrato no tiene
   refresh. Con 12 h, un profesor que corrige por la mañana y por la tarde entra dos veces.
   Opciones: (a) subir a 7 días y aceptar que un token robado vale una semana; (b) implementar
   refresh con rotación, lo que exige tabla de sesiones y ampliar el contrato; (c) dejarlo en 12 h
   y que se vuelva a entrar. Consecuencia: (b) es la única que permite revocar de verdad, y es
   también la única que añade una tabla y dos endpoints nuevos. **`[bloqueante]` para fijar el
   valor por defecto de `JWT_EXPIRES_IN` en producción.**

2. **¿Debe existir revocación de sesión?** Hoy, desactivar a un usuario le corta el acceso en la
   siguiente petición (RN-3), que cubre el caso realista de «se va un profesor». Un token robado,
   en cambio, sigue valiendo hasta caducar. ¿Es un riesgo aceptable para una academia, o hace falta
   una lista de revocación? Depende de la respuesta a la pregunta 1.

3. **¿Dónde se guarda el token en el cliente?** `localStorage` es lo que sobrevive con menos
   fricción al cierre de la PWA, pero es accesible desde JavaScript y por tanto vulnerable a XSS.
   Una cookie `HttpOnly` + `SameSite` es más segura, pero cambia el modelo de autenticación del
   contrato (que hoy es cabecera `Bearer`) y complica el CORS entre `apps/web` y `apps/api` en
   despliegues con dominios distintos. **`[bloqueante]`: condiciona el contrato.**

4. **¿Qué longitud mínima de contraseña?** `CreateUserRequest` exige 8 caracteres. Para un usuario
   con permiso para publicar notas en el LMS, 8 caracteres sin más requisitos es flojo. ¿Se sube el
   mínimo, se exige complejidad, o se confía en que la academia use un gestor de contraseñas?

5. **¿Debe la aplicación distinguir «cuenta desactivada» de «credenciales incorrectas» en el
   login?** Hoy la HU dice que sí (403 frente a 401, escenario 4), lo que es bueno para el usuario
   legítimo pero **filtra que ese correo existe** — justo lo que RN-2 evita en el otro caso. ¿Se
   sacrifica la usabilidad y se devuelve 401 también para los desactivados?

6. **¿Se registran los intentos fallidos de login?** Es la base de cualquier detección de fuerza
   bruta y de la auditoría de acceso, pero implica almacenar direcciones IP, lo que tiene lectura
   de RGPD. ¿Se registra, con qué retención?
