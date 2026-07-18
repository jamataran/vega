---
paths:
  - "src/**/*.{ts,tsx,js,jsx,vue,svelte,css,scss,html}"
  - "app/**/*.{ts,tsx,js,jsx,vue,svelte,css,scss,html}"
  - "components/**/*.{ts,tsx,js,jsx,vue,svelte,css,scss,html}"
---

# Accesibilidad de interfaz

- Usa HTML semántico antes que roles ARIA.
- Todo control debe tener nombre accesible y funcionar con teclado.
- Mantén un `focus-visible` inequívoco, con contraste y separación suficiente.
- No comuniques estado exclusivamente mediante color; acompaña con texto, icono o patrón.
- Respeta `prefers-reduced-motion`; las animaciones no son necesarias para comprender el flujo.
- Evita cambios de foco inesperados tras operaciones de IA. Anuncia resultados asíncronos de forma apropiada.
- Los mensajes de error deben asociarse al campo o bloque que los origina.
- En tablas, conserva encabezados y relaciones comprensibles para lectores de pantalla.
- Comprueba contraste de texto, controles y estados de foco conforme al nivel AA.
- El logo decorativo lleva texto alternativo vacío; cuando identifica el producto, su nombre accesible es `Vega`.
