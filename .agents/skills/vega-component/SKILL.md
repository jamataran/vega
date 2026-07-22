---
name: vega-component
description: Diseña, crea o refactoriza un componente de interfaz de Vega respetando la identidad visual, los tokens, la accesibilidad y los patrones del repositorio. Úsalo para botones, formularios, paneles, tablas, navegación, tarjetas, estados y pantallas de Moodle/IA.
argument-hint: "[componente, pantalla o ruta]"
---

Construye o mejora `$ARGUMENTS` como parte del producto Vega.

## Procedimiento

1. Lee `brand/BRAND.md`, `brand/tokens.css` y las reglas relevantes.
2. Inspecciona el componente o patrón equivalente más cercano del repositorio.
3. Determina la responsabilidad, la acción primaria y los estados necesarios.
4. Reutiliza primitivas y tokens. No introduzcas una segunda librería visual.
5. Implementa con semántica, teclado, foco visible y responsive.
6. Mantén el degradado como acento escaso; no conviertas el componente en una pieza promocional.
7. Comprueba loading, vacío, error, éxito y disabled cuando sean aplicables.
8. Ejecuta lint, typecheck y pruebas disponibles para el área modificada.
9. Revisa el diff contra `brand/BRAND.md` y corrige cualquier desviación antes de terminar.

## Entrega

Resume los archivos modificados, las decisiones visuales relevantes, los estados cubiertos y las verificaciones ejecutadas. Señala con precisión cualquier comprobación que no haya podido ejecutarse.
