# HU-02 — Alta y gestión de usuarios

| | |
|---|---|
| **Id** | HU-02 |
| **Épica** | Acceso y usuarios |
| **Estado** | borrador |
| **Prioridad** | Should |
| **Estimación** | 5 |
| **Depende de** | HU-01 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** administrador de la academia
**quiero** dar de alta profesores, cambiarles el rol y desactivarlos cuando se van
**para** que cada persona que corrige tenga su propia cuenta y quede registrado quién validó cada
corrección.

Esto no es una funcionalidad de gestión: es la condición para que el
[ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md) signifique algo.
`corrections.validated_by` apunta a un usuario concreto, y si toda la academia comparte una cuenta,
esa columna no dice nada. La trazabilidad de quién firmó una nota depende de que haya cuentas
individuales.

El volumen es pequeño —una academia tiene entre dos y diez profesores— y eso justifica un listado
sin paginar y sin búsqueda, pero **no** justifica descuidar la parte delicada: qué pasa cuando se
va un profesor que ha validado cientos de correcciones.

## Criterios de aceptación

### Escenario 1: alta de un profesor

```gherkin
Dado que he iniciado sesión como usuario con rol "admin"
Cuando envío POST /api/users con email "nuevo@academia.es", name "Ana Ruiz",
      password "unaClaveLarga" y role "teacher"
Entonces recibo 201 con un cuerpo que valida contra el esquema User
Y el usuario creado tiene active = true
Y la respuesta no contiene la contraseña ni su hash
Y Ana puede iniciar sesión con esas credenciales
```

### Escenario 2: un profesor no puede gestionar usuarios

```gherkin
Dado que he iniciado sesión como usuario con rol "teacher"
Cuando envío GET /api/users
Entonces recibo 403 con error.code = "FORBIDDEN"
Y la pantalla de usuarios no aparece en la navegación de la aplicación
```

### Escenario 3: correo duplicado

```gherkin
Dado que ya existe un usuario con email "ana@academia.es"
Y he iniciado sesión como "admin"
Cuando envío POST /api/users con ese mismo email
Entonces recibo 409 con error.code = "CONFLICT"
Y error.message indica que ese correo ya está dado de alta
Y no se crea ningún usuario
```

### Escenario 4: contraseña demasiado corta

```gherkin
Dado que he iniciado sesión como "admin"
Cuando envío POST /api/users con password "corta"
Entonces recibo 400 con error.code = "BAD_REQUEST"
Y error.fields.password es "Mínimo 8 caracteres"
```

### Escenario 5: desactivar a un profesor que se va

```gherkin
Dado que existe un usuario "teacher" con 143 correcciones validadas
Y he iniciado sesión como "admin"
Cuando envío PATCH /api/users/{id} con active = false
Entonces recibo 200 y el usuario queda con active = false
Y sus 143 correcciones siguen mostrando su nombre como validador
Y ese usuario recibe 403 en su siguiente petición al API
```

### Escenario 6: no puedo desactivarme a mí mismo

```gherkin
Dado que he iniciado sesión como "admin" con id X
Cuando envío PATCH /api/users/X con active = false
Entonces recibo 409 con error.code = "CONFLICT"
Y error.message explica que no puedo desactivar mi propia cuenta
```

### Escenario 7: no me puedo quitar el último administrador

```gherkin
Dado que soy el único usuario con role "admin" y active = true
Cuando envío PATCH /api/users/{mi id} con role = "teacher"
Entonces recibo 409 con error.code = "CONFLICT"
Y error.message explica que debe quedar al menos un administrador activo
```

### Escenario 8: restablecer la contraseña de otro usuario

```gherkin
Dado que he iniciado sesión como "admin"
Y un profesor ha olvidado su contraseña
Cuando envío PATCH /api/users/{id} con password "otraClaveLarga"
Entonces recibo 200
Y el profesor puede iniciar sesión con la nueva contraseña
Y no puede iniciar sesión con la anterior
```

### Escenario 9: promover a administrador

```gherkin
Dado que he iniciado sesión como "admin"
Y existe un usuario con role "teacher"
Cuando envío PATCH /api/users/{id} con role = "admin"
Entonces recibo 200 y el usuario queda con role "admin"
Y en su próximo inicio de sesión ve las pantallas de administración
```

## Reglas de negocio

**RN-1.** Todas las rutas bajo `/api/users` exigen rol `admin`. Un `teacher` recibe 403 en todas,
incluida la lectura del listado.

**RN-2.** El correo es único en el sistema (`users.email UNIQUE`), normalizado a minúsculas y sin
espacios por los extremos.

**RN-3.** La contraseña mínima son 8 caracteres (`CreateUserRequest`). Se almacena hasheada; nunca
vuelve por la API.

**RN-4.** **Los usuarios se desactivan, no se borran.** Borrar rompe la trazabilidad de
`corrections.validated_by`, que está declarada `ON DELETE SET NULL`: se perdería quién validó
cientos de correcciones ya publicadas. `active = false` es la baja.

**RN-5.** Un usuario desactivado no puede iniciar sesión y sus tokens vigentes dejan de valer
(HU-01, RN-3).

**RN-6.** Siempre debe quedar **al menos un administrador activo**. Se rechaza con 409 cualquier
operación que lo incumpla: desactivar al último admin activo, o cambiarle el rol a `teacher`.

**RN-7.** Un administrador **no puede desactivarse ni cambiarse el rol a sí mismo**. Que otro
administrador lo haga. Evita quedarse fuera por accidente.

**RN-8.** Cambiar la contraseña de un usuario **no** invalida sus sesiones abiertas: el JWT sigue
valiendo hasta caducar. Si hace falta cortar el acceso ya, se desactiva la cuenta.

**RN-9.** El listado no se pagina ni se busca: `UserListResponse` es `{ items: User[] }` y una
academia tiene decenas de usuarios como mucho.

**RN-10.** Los dos roles son los de `UserRole`: `teacher` (corrige) y `admin` (corrige, gestiona
usuarios y lanza operaciones del sistema). No hay más granularidad.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Reactivar a un usuario dado de baja | Permitido: `PATCH` con `active = true`. Recupera acceso con su contraseña anterior |
| Dar de alta un correo que ya existe pero desactivado | 409. Se reactiva el existente, no se crea uno nuevo |
| El único admin se desactiva desde la base de datos a mano | El sistema se queda sin administrador. Se recupera con `pnpm --filter api create-admin`, que es idempotente sobre un correo existente |
| Cambiar el nombre de un usuario que ya ha validado | Permitido. El nombre se lee por FK, así que las correcciones antiguas muestran el nombre nuevo. No hay foto del nombre en el momento de validar |
| Un admin se degrada a `teacher` habiendo otro admin activo | Permitido si no es él mismo (RN-7). Si es él mismo, 409 |
| Dos administradores editan al mismo usuario a la vez | Último en escribir gana. Sin bloqueo optimista: el volumen no lo justifica |
| Correo con mayúsculas distintas del existente | Se normaliza y colisiona: 409 |

## Fuera de alcance

- **Borrado real de usuarios.** RN-4. Si alguna vez hace falta por RGPD, será una operación de
  anonimización específica, no un `DELETE`.
- **Invitación por correo.** El administrador fija la contraseña inicial y la comunica por el canal
  que quiera. No hay SMTP obligatorio para dar de alta.
- **Roles más finos** (corrector por buzón, sólo lectura, coordinador). Ver preguntas abiertas.
- **Multi-tenant.** Está en la hoja de ruta del README, no aquí. Ni siquiera hay columna
  `tenant_id` en `0001_init.sql`.
- **Registro de auditoría de acciones administrativas.** Quién dio de alta a quién no se guarda.
- **Cambio de la propia contraseña por el usuario.** Es HU-03.

## Notas de implementación

**Entidades** (`@vega/shared`): `User`, `UserRole`, `USER_ROLE_LABEL` (etiquetas «Profesor» /
«Administrador» para la UI).

**Contrato**: `UserListResponse`, `CreateUserRequest` (`email`, `name`, `password` min 8, `role`),
`UpdateUserRequest` (todos opcionales: `name`, `role`, `active`, `password`).

**Endpoints** (`routes`): `users` → `GET`/`POST /api/users`; `user(id)` →
`GET`/`PATCH`/`DELETE /api/users/{id}`. Todos con rol `admin`.

> **Hueco del contrato**: `api.ts` incluye `routes.user(id)` pero no define esquema de respuesta
> para `DELETE`. Coherente con RN-4, la decisión provisional es **no implementar `DELETE`** y
> devolver 405, o directamente no registrar la ruta. Ver pregunta abierta 1.

**Esquema**: tabla `users`. Las restricciones RN-6 y RN-7 **no están en la base de datos** (un
`CHECK` no puede expresar «al menos un admin activo»): se hacen cumplir en el API, dentro de la
misma transacción que la modificación, con un `SELECT ... FOR UPDATE` para evitar la carrera de dos
administradores degradándose a la vez.

**UI**: pantalla accesible sólo con rol `admin`; el elemento de navegación no se pinta para
`teacher`. Lista con nombre, correo, rol y estado. Alta en un formulario simple. Acciones por fila:
editar, restablecer contraseña, activar/desactivar. La desactivación pide confirmación explícita.

**Mock**: en la entrega mockeada la pantalla existe con una lista simulada de tres o cuatro
usuarios y los formularios funcionando contra el API. Las reglas RN-6 y RN-7 se implementan de
verdad desde el principio: son baratas y son las que evitan quedarse fuera del sistema.

## Preguntas abiertas

1. **¿Qué hace `DELETE /api/users/{id}`?** La ruta está en el contrato pero no tiene respuesta
   definida, y RN-4 dice que los usuarios no se borran. Opciones: (a) eliminar la ruta del contrato
   y quitar la ambigüedad; (b) implementarla como desactivación, lo que es engañoso; (c)
   implementar borrado real aceptando que `validated_by` quede a `NULL` en las correcciones
   afectadas. Consecuencia de (c): se pierde para siempre quién validó, y con ello la defensa ante
   una reclamación de nota. **`[bloqueante]`: hay una ruta en el contrato que hoy no se sabe qué
   hace.**

2. **¿Hace falta un rol de sólo lectura?** El caso real: el director de la academia quiere ver el
   panel de coste y la desviación IA↔profesor, pero no debe poder validar ni publicar notas. Hoy
   sólo hay `teacher` y `admin`, y `teacher` puede publicar. Añadir un tercer rol toca el enum de
   `@vega/shared`, el `CHECK` de la tabla y la matriz de permisos entera.

3. **¿Debe un profesor ver sólo sus buzones?** Hoy todo profesor ve toda la cola de todos los
   buzones. En una academia con varios departamentos, o con profesores por asignatura, eso es ruido
   y posiblemente un problema de privacidad. Asignar buzones a profesores requiere una tabla de
   relación y una migración nueva. ¿Es un caso real de esta academia o una generalidad prematura?

4. **¿Cómo llega la contraseña inicial al profesor nuevo?** Hoy: el administrador la teclea y la
   comunica como puede (WhatsApp, en persona). Es la vía más frágil del sistema. Opciones: (a)
   dejarlo así y confiar en el canal; (b) generar una contraseña temporal que **obligue** a
   cambiarla en el primer acceso, lo que exige una columna `must_change_password` y una migración;
   (c) enviar un enlace de alta por SMTP, lo que convierte la configuración de correo en obligatoria
   para dar de alta usuarios.

5. **¿Se registran las acciones administrativas?** Que un administrador cambie el rol de otro, o
   restablezca su contraseña, no deja rastro. Para una academia con dos administradores es
   probablemente innecesario. Para una con diez, no. ¿Se añade una tabla de auditoría o se asume?

6. **¿Debe el sistema avisar cuando queda un solo administrador activo?** RN-6 impide quedarse a
   cero, pero quedarse en uno es un riesgo operativo real: si esa persona se va o pierde el acceso,
   la academia se queda sin poder gestionar usuarios. ¿Un aviso persistente en la UI, o nada?
