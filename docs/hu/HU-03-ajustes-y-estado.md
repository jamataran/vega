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

Es también donde vive lo poco que hay de «ajustes»: cuenta, marca y salir. Casi toda la
configuración de Vega es por variables de entorno, y eso es una decisión, no una carencia — pero
significa que esta pantalla es sobre todo de **lectura**.

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

**RN-1.** La pantalla es accesible para cualquier usuario autenticado, con rol `teacher` o `admin`.

**RN-2.** Los datos de cuenta salen de `GET /api/auth/me`; los de sistema, de `GET /api/health`.
No hay endpoint de ajustes: **no existe en el contrato**.

**RN-3.** Cuando `aiProvider` o `lmsConnector` valen `mock`, la UI muestra un aviso **persistente y
visible desde cualquier pantalla**, no sólo en ajustes. El profesor tiene que poder saberlo
mientras valida, no sólo si va a mirar.

**RN-4.** Cuando `HealthResponse.status` es `degraded`, la UI lo indica en la cabecera. Un sistema
con la base de datos caída no debe aparentar normalidad.

**RN-5.** «Cerrar sesión» borra el token del cliente. **No hay revocación en servidor**: el JWT
sigue siendo válido hasta caducar (HU-01, fuera de alcance).

**RN-6.** La marca (`BRAND_NAME` y el logo montado como volumen) es configuración de despliegue, no
de aplicación: no se edita desde la UI.

**RN-7.** La configuración operativa —hora del lote, umbrales de confianza, modelo, credenciales—
**es por variable de entorno y no se edita desde aquí**. La pantalla puede mostrar valores no
sensibles en lectura; nunca secretos.

## Casos límite

| Caso | Qué se hace |
|---|---|
| `GET /api/health` no responde | Se muestra el bloque de estado como «no disponible». El resto de la pantalla (cuenta) sigue funcionando con los datos de la sesión |
| Sin logo montado | Se usa el logo por defecto de Vega. `BRAND_NAME` sigue aplicándose |
| `uptimeSeconds` muy bajo tras abrir la pantalla | Indica que el contenedor acaba de reiniciarse. Se muestra el dato tal cual, sin interpretarlo |
| El navegador no soporta instalación de PWA | No se muestra la opción de instalar. Nada más cambia |
| Cerrar sesión con ediciones sin guardar en otra pantalla | Se pide confirmación explícita advirtiendo de la pérdida |
| Un `teacher` abre ajustes | Ve lo mismo que un `admin` salvo los enlaces a gestión de usuarios y a lanzar el lote |

## Fuera de alcance

- **Editar la configuración del sistema desde la UI.** Hora del lote, modelo, umbrales de confianza
  y credenciales son variables de entorno (RN-7). Ver preguntas abiertas.
- **Mostrar secretos.** Ni la clave de Anthropic, ni el token de Moodle, ni `JWT_SECRET`, ni
  siquiera enmascarados.
- **Gestión de usuarios.** Es HU-02.
- **Preferencias de usuario** (tema claro/oscuro, idioma, densidad). No hay columna donde
  guardarlas.
- **Cambiar la propia contraseña.** Ver pregunta abierta 2.
- **Panel de métricas.** Es HU-18.

## Notas de implementación

**Contrato**: `MeResponse` (`{ user }`) y `HealthResponse` (`status`, `version`, `database`,
`aiProvider`, `lmsConnector`, `uptimeSeconds`).

**Endpoints** (`routes`): `me` → `GET /api/auth/me`; `health` → `GET /api/health` (público, también
sonda del proxy inverso).

**Etiquetas**: `USER_ROLE_LABEL` de `@vega/shared` para el rol. No se escriben otra vez en el front.

> **Hueco del contrato**: no existe ninguna ruta de ajustes de aplicación. Todo lo configurable vive
> en `.env.example`: `AI_PROVIDER`, `AI_MODEL_TRANSCRIPTION`, `AI_MODEL_GRADING`, `LMS_CONNECTOR`,
> `JWT_EXPIRES_IN`, `BRAND_NAME`, SMTP. Si se decide hacer algo editable, hay que ampliar el
> contrato y probablemente añadir una tabla de configuración.

**UI**: última pestaña de la navegación inferior. El aviso de modo simulado (RN-3) es un elemento
global de la cabecera, no de esta pantalla: se pinta a partir del `GET /api/health` que la
aplicación hace al arrancar.

**Mock**: completa en la entrega mockeada. `GET /api/health` es real desde el primer día — es la
sonda del proxy inverso y la fuente del aviso de modo simulado, que es precisamente lo que hace
falta durante una demo.

## Preguntas abiertas

1. **¿Qué configuración debería ser editable desde la UI?** Candidatas concretas: la **hora del
   lote nocturno** (hoy variable de entorno; cambiarla exige tocar Portainer y reiniciar), el
   **umbral de confianza** que la UI resalta (hoy 0,75, fijado en un comentario de `domain.ts`) y
   el **destinatario del resumen nocturno**. Hacerlas editables exige tabla de configuración,
   endpoints nuevos y decidir quién puede tocarlas. ¿Merece la pena para tres valores?
   **`[bloqueante]` si la respuesta es sí: cambia el contrato.**

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
