# ADR 0004 — El profesor siempre valida antes de publicar

**Estado**: Aceptado

## Contexto

Vega corrige exámenes de una academia de oposiciones. La nota que se publica no es un ejercicio de
clase: es la señal con la que un opositor decide dónde invertir meses de estudio. Y la academia
responde de ella ante quien paga.

La tentación de automatizar del todo es real y tiene números a favor: si la IA acierta el 95 % de
las veces, publicar automáticamente ahorra el 100 % del tiempo del profesor. Se descarta por tres
razones.

1. **El 5 % restante no se distribuye al azar.** Se concentra en los alumnos con letra peor y en
   los que resuelven por caminos no estándar — es decir, se ceba con quien más perjudica.
2. **La responsabilidad no es delegable.** Un error de nota se le reclama al profesor, y el
   profesor tiene que poder decir «lo revisé». Un umbral de confianza automático no es una defensa.
3. **Sin bucle humano no hay medición.** La diferencia entre `aiPoints` y `teacherPoints` es lo
   único que dice si el sistema está mejorando o empeorando (ADR 0008). Publicar automáticamente
   destruye la señal.

## Decisión

**Ninguna nota ni ningún feedback llega al alumno sin un acto explícito de validación por parte de
un usuario identificado.**

Se hace cumplir de forma estructural, no por convención de UI:

1. El ciclo de vida de `SubmissionStatus` **no tiene arista `graded -> published`**. Sólo se
   publica desde `validated`.
2. `POST /api/submissions/{id}/publish` devuelve `409 CONFLICT` si la entrega no está en
   `validated`. La comprobación está en el API, no en el front.
3. `corrections.validated_by` guarda **quién** validó (FK a `users`) y `validated_at`, **cuándo**.
   Ambos son obligatorios para el estado `validated` (invariante 2 de `modelo-de-datos.md`).
4. `validate` y `saveCorrection` comparten esquema de petición (`ValidateRequest =
   SaveCorrectionRequest`) para que validar sea **una sola acción atómica**: guarda los cambios
   pendientes y valida. No existe la ventana en la que el profesor pulsa «Validar» y se publica
   una versión anterior a sus últimas ediciones.
5. La IA **nunca escribe en `teacherPoints`**. Ese campo sólo lo toca una petición autenticada.

Corolario: la validación no es una aprobación en bloque de un lote. Es por entrega.

## Consecuencias

**A favor**

- El techo de responsabilidad está claro: Vega propone, una persona con nombre y apellidos firma.
- El registro de auditoría es intrínseco al modelo, no un añadido.
- La métrica de desviación queda garantizada: toda corrección publicada ha pasado por un humano
  que pudo cambiarla.
- Permite ser agresivo en otras partes del sistema (probar prompts, cambiar de modelo) sin riesgo
  para el alumno, porque hay una red debajo.

**En contra**

- **El profesor es el cuello de botella**, y eso es una decisión de producto, no un accidente. Si
  llegan 200 entregas una noche, hay 200 validaciones que hacer. La respuesta no puede ser saltarse
  la validación; tiene que ser hacer que validar cueste segundos: la pantalla de revisión móvil
  (`HU-15`) es la contrapartida obligatoria de este ADR.
- Validar puede degenerar en pulsar el botón sin mirar, que es lo peor de los dos mundos: la
  responsabilidad formal sin la revisión real. Se mitiga —no se elimina— señalando en la cola qué
  entregas merecen atención (baja confianza, marcas de OCR, método alternativo) para que la
  atención del profesor se gaste donde sirve.
- La **validación en bloque** para entregas de alta confianza es una petición previsible y tienta
  a romper este ADR. Si se implementa, debe seguir dejando `validated_by` por entrega y seguir
  siendo un acto explícito sobre un conjunto que el profesor ha visto. No está en el contrato
  actual: ver `HU-16`.
- Publicar queda como paso separado y puede quedarse a medias (validada pero no publicada) si el
  LMS falla. Es el precio de separar la decisión humana de la operación de red — y a cambio el
  reintento no molesta al profesor.
