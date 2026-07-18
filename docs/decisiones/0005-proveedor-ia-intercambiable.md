# ADR 0005 — Proveedor de IA intercambiable, con mock por defecto

**Estado**: Aceptado

## Contexto

Cada llamada a un modelo de visión sobre un examen escaneado de varias páginas cuesta dinero,
tarda segundos y devuelve algo distinto cada vez. Tres consecuencias prácticas:

- **No se puede desarrollar la UI contra el modelo real.** La pantalla de revisión necesita datos
  con forma exacta —apartados con confianzas variadas, marcas `[ILEGIBLE]`, un método alternativo—
  y necesitarlos en cada recarga, no cuando el modelo tenga a bien producirlos.
- **No se pueden escribir tests deterministas** contra una respuesta que cambia.
- **La primera entrega del proyecto es una maqueta navegable con todo mockeado.** Sin un modo mock
  de primera clase, esa entrega no existe.

Además, el modelo concreto es lo que más rápido envejece de todo el sistema. Atar `packages/core`
al SDK de Anthropic condena a tocar el motor cada vez que cambia el modelo, la forma de pedir
caché o el proveedor.

## Decisión

**El motor de corrección habla con una interfaz `AiProvider`, no con un SDK.** La implementación
se elige por variable de entorno, y **`mock` es el valor por defecto** (`AI_PROVIDER=mock` en
`.env.example`).

La interfaz cubre exactamente dos operaciones, las dos del flujo:

```
transcribe(escaneo, contexto)                -> Transcription + UsageMetrics
grade(transcripción, contextoResuelto, buzón) -> Correction   + UsageMetrics
```

Implementaciones:

| Valor | Comportamiento |
|---|---|
| `mock` | Respuestas simuladas deterministas. Sin red, sin clave, sin coste. `UsageMetrics` a cero |
| `anthropic` | SDK de Anthropic: Messages API, Batches API para el lote nocturno, `cache_control` sobre el prefijo de contexto |

Reglas que hacen que esto no sea una abstracción vacía:

1. **El mock devuelve datos incómodos, no bonitos.** Al menos un apartado con confianza baja, al
   menos una marca `[ILEGIBLE]` y otra `[DUDA]`, al menos un `alternativeMethod: true`, y algún
   caso en que la suma de `maxPoints` de los apartados no coincida con `maxScore`. Si el mock sólo
   produce el caso feliz, la UI se diseña para un mundo que no existe.
2. **El mock es determinista** dado el mismo `submissionId`: la misma entrega produce siempre la
   misma corrección. Los tests y las capturas son reproducibles.
3. **`UsageMetrics` viaja siempre**, también en mock (a cero). El código de metering se ejercita
   desde el primer día en lugar de aparecer al final.
4. **El proveedor activo se expone en `GET /api/health`** (`aiProvider`) y se muestra en la
   pantalla de estado. Que nadie confunda una demo con producción.
5. **`Correction.model` y `Transcription.model` guardan el modelo real usado.** Así una corrección
   antigua sigue diciendo con qué se hizo cuando el modelo por defecto haya cambiado tres veces.

## Consecuencias

**A favor**

- La entrega mockeada —front, back y UI completos— se construye y se enseña al cliente sin gastar
  un euro y sin clave de API.
- Los tests de `packages/core` y del API corren en CI sin secretos y sin red.
- Cambiar de modelo es cambiar `AI_MODEL_TRANSCRIPTION` / `AI_MODEL_GRADING`; cambiar de proveedor
  es escribir una implementación más.
- El desarrollo del front no se bloquea por el estado del motor de corrección.

**En contra**

- **Riesgo de divergencia**: el mock puede acabar produciendo una forma que el proveedor real no
  produce, y el fallo aparece el día que se enchufa de verdad. Se mitiga haciendo que **las dos
  implementaciones devuelvan tipos de `@vega/shared` validados con el mismo esquema Zod** — el
  proveedor real valida su salida antes de devolverla, igual que el mock.
- La interfaz sólo tiene dos métodos, y eso es una apuesta: si un proveedor futuro exige un flujo
  distinto (streaming, herramientas, varias vueltas), la interfaz se queda corta. Se asume; ampliar
  después es más barato que abstraer de más ahora.
- **Batches API y Messages API tienen latencias y modos de fallo muy distintos**, y la interfaz los
  oculta. El lote nocturno debe poder caer de Batches a Messages, y esa lógica vive dentro de la
  implementación `anthropic`, no en `core`.
- Es fácil olvidarse de que se está en mock. De ahí la exposición explícita en `/api/health` y en
  la UI.
