# Vega — instrucciones de proyecto

## Producto

Vega conecta Moodle con APIs de IA para ayudar a corregir entregas y generar feedback. La experiencia debe transmitir precisión, control docente, claridad y ahorro de tiempo. La IA asiste; el profesorado conserva la decisión.

## Fuentes de verdad

1. `brand/BRAND.md` define la identidad visual y verbal.
2. `brand/tokens.css` y `brand/tokens.json` definen los valores de diseño.
3. `brand/vega-icon.svg` es el símbolo maestro. No redibujarlo ni sustituirlo.
4. Las reglas de `.claude/rules/` son obligatorias para los archivos a los que se aplican.
5. Los patrones existentes del repositorio prevalecen en arquitectura y stack, salvo que contradigan la marca o la accesibilidad.

## No negociables

- Mantén el icono minimalista: V asimétrica y gesto de check/progreso.
- No introduzcas estrellas, destellos, cerebros, robots, birretes, libros, circuitos ni iconografía genérica de IA en la marca.
- No recrees el símbolo con CSS, texto, emojis ni otra librería de iconos.
- Usa Space Grotesk para display/títulos e Inter para interfaz y lectura.
- Usa los tokens; evita colores, sombras, radios y espaciados ad hoc.
- El degradado violeta–azul–cian es un acento escaso, no el fondo de toda la aplicación.
- Evita glassmorphism, neón, brillos, fondos espaciales, tarjetas flotantes innecesarias y decoración que compita con el contenido.
- Nunca presentes una corrección de IA como decisión definitiva cuando existe intervención docente.
- Todo flujo debe ser accesible por teclado y mostrar foco visible.

## Flujo de trabajo

Antes de modificar UI:

1. Lee `brand/BRAND.md`, los tokens y los componentes relacionados.
2. Identifica el patrón existente más cercano; reutiliza antes de crear.
3. Explica brevemente qué jerarquía visual y estado de interacción vas a mantener.
4. Implementa el cambio más pequeño que resuelva la necesidad.
5. Comprueba estados: carga, vacío, error, éxito, deshabilitado y foco cuando sean aplicables.
6. Ejecuta los scripts reales del repositorio. Inspecciona `package.json`, Makefile o documentación; no inventes comandos.
7. Ejecuta `/vega-brand-audit` cuando el cambio afecte a navegación, layout, componentes reutilizables, colores, tipografía o copy.

## Definición de terminado para UI

- Usa tokens de marca y componentes existentes.
- Funciona en móvil y escritorio cuando la pantalla sea responsive.
- No hay overflow, saltos de layout ni texto truncado sin alternativa.
- Contraste, foco, etiquetas y semántica son adecuados.
- El copy es breve, específico y centrado en la tarea docente.
- Las pruebas, lint y typecheck disponibles pasan o se documenta con precisión por qué no se pudieron ejecutar.
- No se han modificado activos de marca sin una petición explícita.
