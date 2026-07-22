# ADR 0014 — El original manda, la lectura es doble y el transporte admite lotes

**Estado**: Aceptado

**Enmienda**: ADR 0011.

## Contexto

Una sola transcripción convertía una hipótesis de OCR en fuente de verdad. Además, enviar una
entrega por llamada síncrona desaprovecha el descuento garantizado del transporte Batches.

## Decisión

- `grade()` recibe el original visual y la transcripción consolidada. Ante conflicto manda el original.
- Cada manuscrito se transcribe dos veces en paralelo; ninguna lectura recibe la otra.
- `normalizeCanonical()` elimina diferencias tipográficas de LaTeX. Una diferencia material conserva
  ambas lecturas, crea `DISCREPANCIA` y reduce la confianza.
- Los PDF se parten sin rasterizar en bloques con manifiesto. Una página ausente, duplicada o inesperada
  hace fallar la entrega.
- El lote usa fases lectura A/B → corrección → verificación. El reproceso individual conserva transporte
  síncrono y `grade_only` reutiliza la lectura persistida.
- El lote termina en `graded`. Publicar en Moodle requiere una acción posterior y queda fuera del motor.

## Consecuencias

La visión se paga dos veces, pero un error de lectura deja de ser silencioso. El ledger conserva cada
intento y su fase. Las rutas fabricadas con `#N` sólo son válidas para datos simulados.

