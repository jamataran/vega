# Vega — sistema de marca

## 1. Esencia

Vega es una herramienta de corrección asistida que conecta Moodle con modelos de IA. Su valor no es «tener IA», sino convertir volumen de trabajo en feedback claro y revisable, manteniendo al docente al mando.

**Promesa:** menos trabajo mecánico, más tiempo para enseñar.

**Tagline autorizado:** `IA que corrige. Tú que enseñas.`

## 2. Símbolo

El icono es una V asimétrica formada por dos planos:

- El brazo izquierdo representa la entrega que entra y se analiza.
- El brazo derecho asciende como check, feedback y progreso.
- La tensión entre ambos crea un gesto propio sin recurrir a estrellas ni símbolos literales de educación o IA.

El SVG maestro es `vega-icon.svg`. No debe redibujarse.

## 3. Paleta

### Núcleo

| Token | Valor | Uso |
|---|---:|---|
| Ink 950 | `#080B14` | fondos oscuros y texto de máxima jerarquía |
| Ink 900 | `#0B1020` | texto principal en claro |
| Cloud 50 | `#F7F9FC` | superficie clara |
| Slate 500 | `#667085` | texto secundario |
| Violet 400 | `#B98CFF` | inicio luminoso del degradado |
| Violet 500 | `#8A5CFF` | identidad y acentos |
| Violet 600 | `#5B39FF` | acción primaria y extremo profundo |
| Blue 500 | `#277BFF` | transición y foco |
| Cyan 400 | `#22D7F6` | extremo ascendente del símbolo |

### Degradado maestro

```css
linear-gradient(135deg, #B98CFF 0%, #8A5CFF 30%, #277BFF 68%, #22D7F6 100%)
```

No es un relleno universal. Úsalo en marca, hero controlado o un indicador excepcional.

### Estados

Los estados mantienen semántica independiente de la marca:

- Éxito: `#16A36A`
- Aviso: `#D97706`
- Error: `#DC2626`
- Información: `#2563EB`

## 4. Tipografía

### Space Grotesk

Títulos, display, navegación destacada, métricas y encabezados. Pesos 500–600. Su geometría aporta personalidad sin competir con el contenido.

### Inter

Cuerpo, formularios, tablas, rúbricas, botones, feedback y texto denso. Pesos 400–600.

No uses una tercera familia por defecto.

## 5. Lenguaje visual

- Minimalismo funcional y contraste limpio.
- Superficies neutras; la marca guía, no invade.
- Bordes sutiles y elevación escasa.
- Radios controlados, no todo en forma de píldora.
- Iconos lineales coherentes, sin mezcla de familias.
- Animación breve y explicativa: estado, progreso o transición; nunca decoración continua.

## 6. Evitar

- Apariencia tipo «IA genérica»: destellos, galaxias, neón, cerebros y robots.
- Libro, birrete o lápiz integrados en el logo.
- Degradados en todas las tarjetas y botones.
- Glassmorphism, blur y glow como lenguaje principal.
- Copy como `Vega piensa`, `Vega sabe` o `corrección perfecta`.
- Pantallas con varias acciones primarias compitiendo.

## 7. Voz

Vega es precisa, calmada y útil. Explica procesos complejos en términos operativos.

**Sí:** `Hemos preparado una propuesta de feedback para 12 entregas.`

**No:** `Vega ha pensado por ti y ha corregido mágicamente a toda la clase.`

## 8. Principio rector

Cuando existan dos soluciones igualmente funcionales, elige la que use menos formas, menos efectos, menos texto y una jerarquía más clara.
