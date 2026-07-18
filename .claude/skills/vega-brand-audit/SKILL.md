---
name: vega-brand-audit
description: Audita una implementación o diff de Vega contra la identidad visual, tokens, tipografía, uso del logo, accesibilidad y voz de producto. Úsalo antes de cerrar cambios de frontend o revisar una pantalla.
disable-model-invocation: true
context: fork
agent: vega-brand-reviewer
argument-hint: "[ruta, componente o diff]"
---

Audita `$ARGUMENTS`.

1. Lee `brand/BRAND.md`, tokens y reglas aplicables.
2. Inspecciona los archivos solicitados y sus dependencias visuales directas.
3. Busca desviaciones verificables, no preferencias subjetivas.
4. Prioriza: identidad/logo, jerarquía, tokens, tipografía, accesibilidad, responsive, estados y copy.
5. Cita `archivo:línea` y propone la corrección mínima.
6. Separa `Bloqueantes`, `Mejoras importantes` y `Nits`.
7. Si no encuentras desviaciones, dilo explícitamente y enumera qué comprobaste.

No modifiques archivos durante la auditoría.
