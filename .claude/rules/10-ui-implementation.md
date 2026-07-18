---
paths:
  - "src/**/*.{ts,tsx,js,jsx,vue,svelte,css,scss,less,html}"
  - "app/**/*.{ts,tsx,js,jsx,vue,svelte,css,scss,less,html}"
  - "components/**/*.{ts,tsx,js,jsx,vue,svelte,css,scss,less,html}"
  - "pages/**/*.{ts,tsx,js,jsx,vue,svelte,css,scss,less,html}"
  - "styles/**/*.{css,scss,less,ts,js}"
---

# Implementación de interfaz Vega

## Jerarquía

- Una acción primaria por vista o bloque funcional.
- Títulos cortos, información secundaria subordinada y controles próximos a su consecuencia.
- Usa espacio en blanco para separar responsabilidades; evita encerrar cada elemento en una tarjeta.
- Prefiere layouts estables y alineaciones claras frente a composiciones diagonales o decorativas.

## Color

- Usa variables de `brand/tokens.css` o su equivalente existente en el proyecto.
- Reserva el degradado de marca para el logo, hero, indicadores de progreso destacados o una acción excepcional.
- Las superficies de trabajo son neutras. El contenido académico debe dominar sobre la marca.
- No uses violeta para todos los estados; éxito, aviso y error conservan semántica propia.

## Tipografía

- Display y títulos: Space Grotesk, peso 500 o 600.
- Texto, formularios y tablas: Inter, peso 400, 500 o 600.
- No uses mayúsculas sostenidas en párrafos ni tracking amplio en controles.
- Evita texto menor de 12 px. El tamaño habitual de interfaz es 14–16 px.

## Forma y profundidad

- Radios preferentes: 8, 12 y 16 px. Usa píldoras solo para chips, estados o controles que lo requieran.
- Bordes sutiles antes que sombras. Una única elevación suave cuando la jerarquía lo necesite.
- No uses glow, blur de fondo, glassmorphism ni sombras coloreadas en componentes de trabajo.

## Componentes

- Reutiliza el sistema existente antes de crear variantes.
- Cada componente interactivo debe cubrir hover, active, focus-visible, disabled y loading cuando proceda.
- Tablas y rúbricas priorizan legibilidad, alineación y densidad controlada.
- Los porcentajes o puntuaciones necesitan contexto, no solo color.
