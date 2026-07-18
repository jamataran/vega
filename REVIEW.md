# Vega — instrucciones de revisión

## Hallazgos importantes

Clasifica como **Important** cualquiera de estos casos:

- El símbolo de Vega se redibuja, deforma, recolorea fuera de las versiones autorizadas o se sustituye por iconografía genérica de IA.
- Se añaden tipografías o colores principales fuera de los tokens de marca sin una justificación funcional documentada.
- La interfaz hace creer que la IA toma una decisión académica definitiva sin control docente.
- Falta accesibilidad funcional: navegación por teclado, foco visible, etiqueta, nombre accesible o contraste suficiente en una acción esencial.
- Se rompe una variante responsive o un estado crítico del flujo de corrección.
- Se codifican secretos o datos personales en frontend, logs o fixtures compartidos.

## Nits

Espaciado, microcopy, consistencia de radios y pequeñas mejoras de jerarquía son **Nit** salvo que afecten a comprensión o uso. Publica como máximo ocho nits; agrupa repeticiones.

## No reportar

- Formato, lint o tipos que ya detecte el CI.
- Archivos generados, dependencias, lockfiles y snapshots sin cambio funcional.
- Preferencias subjetivas que no estén respaldadas por `brand/BRAND.md` o los tokens.

## Evidencia

Cada hallazgo debe incluir archivo y línea, explicar el impacto observable y proponer la corrección mínima. No afirmes un problema visual basándote solo en el nombre de una clase si no puedes verificar su definición.

## Resumen

Abre la revisión con una línea de estado: `Sin problemas de marca`, `N desviaciones de marca` o `N problemas importantes`. Separa después marca, accesibilidad y comportamiento.
