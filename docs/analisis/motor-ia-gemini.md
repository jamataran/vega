# Visión Diferencial y Optimización de Arquitectura IA (Ecosistema Anthropic)

**Fecha:** 21 de julio de 2026  
**Modelo de Análisis:** Gemini 3.6 Flash  
**Estado:** Propuesta de arquitectura, volumetría y optimización de costes  
**Alcance:** Adaptación de la arquitectura IA a las **volumetrías reales** (manuscritos de 10 a 16 páginas en PDF, ventanas de 8h/24h, prioridad absoluta de calidad y cero alucinaciones).

---

## 1. Impacto de las Nuevas Volumetrías en la Arquitectura

La incorporación de las volumetrías reales en `requisitos-mvp.md` introduce tres restricciones críticas que cambian el diseño:

1. **Volumen de Imágenes:** Simulacros de **12-16 páginas manuscritas** (temas) y **~10 páginas** (problemas) con alto contenido matemático (demostraciones, fórmulas, símbolos).
   - *Cálculo de tokens:* 16 páginas escaneadas en alta resolución equivalen a **~25.600 tokens de imagen** por entrega.
2. **Ventanas de Latencia Permitidas (SLA Flexibles):**
   - Correcciones de simulacros: ventana de ejecución cada **24 horas**.
   - Dudas de foros: envío agrupado cada **8 horas**.
3. **Prioridad Calidad sobre Coste ("Cero Alucinaciones"):**
   - Se exige optimizar costes porque los cobros son mínimos/nulos, pero la **calidad del rigor matemático prima sobre el ahorro**. El sistema no puede cometer errores en demostraciones.

---

## 2. La Decisión Arquitectónica Clave: Pipeline en Dos Etapas Desacopladas

Realizar la transcripción OCR y la corrección matemática en una sola llamada enviando 16 imágenes junto con la rúbrica es un **error grave de diseño**:
- Perdería la caché de prompts (las imágenes cambian por alumno y romperían el prefijo).
- Mezclaría la carga de visión con el razonamiento profundo, aumentando el riesgo de alucinación.
- Si el profesor pide recalificar una entrega tras ajustar la rúbrica, se volverían a pagar 25.600 tokens de visión por alumno.

### Flujo Optimizado en 2 Etapas:

```
[ PDF Manuscrito 12-16 págs ]
       │
       ▼
 ┌───────────────────────────────────────────────────────────┐
 │ ETAPA 1: Transcripción OCR (Visión)                       │
 │  - Convierte imágenes a LaTeX + marcas [ILEGIBLE]/[DUDA]   │
 │  - Parámetros: temperature 0.0, top_p 0.1 (sin creatividad)│
 │  - Salida: Texto LaTeX normalizado (~2.500 tokens)        │
 └───────────────────────────────────────────────────────────┘
       │
       ▼  (Persistencia en BD: `transcriptions`)
 ┌───────────────────────────────────────────────────────────┐
 │ ETAPA 2: Corrección Matemática y Rúbrica (Razonamiento)   │
 │  - Input: Texto LaTeX (~2.500 tokens) + Contexto Caché    │
 │  - Modelo: Claude 3.5/3.7 Sonnet con Extended Thinking    │
 │  - System Prompt: Rúbrica + Solución en Caché (>4.096 tks)│
 └───────────────────────────────────────────────────────────┘
```

#### Ventajas Económicas y de Calidad:
- **Reducción masiva de tokens en Etapa 2:** Pasar de 25.600 tokens de imagen a ~2.500 tokens de texto LaTeX.
- **Cache Hit del 100% en la Rúbrica:** El contexto de la actividad (solución de referencia + criterios) se cachea para las 50 entregas en la Etapa 2.
- **Recalificación Gratuita de Visión:** Si se edita la rúbrica, la Etapa 1 NO se repite. La recalificación (Etapa 2) cuesta solo céntimos.

---

## 3. Confirmación del 100% de uso de la Message Batches API

Dado que el nuevo requisito establece que las correcciones pueden realizarse **cada 24 horas** y las dudas **cada 8 horas**, la aplicación **NO requiere llamadas síncronas**.

* **Procesamiento de Simulacros (Cada 24h):** Se encolan los PDFs recibidos durante el día y se dispara un batch nocturno.
* **Procesamiento de Dudas (Cada 8h):** Se agrupan los mensajes de foros acumulados y se envían en 3 lotes diarios.
* **Resultado:** **Descuento del 50% en TODOS los tokens del sistema** (visión, razonamiento, entrada, salida y creación de caché).

---

## 4. Garantía de Calidad: Sonnet + Extended Thinking (Sin Opus)

Para cumplir el mandato de **máxima calidad matemática sin alucinaciones**, la estrategia de modelos se afina así:

1. **Etapa 1 (Visión / OCR):** `claude-3-5-sonnet` (alta resolución y precisión de lectura manuscrita) a `temperature: 0.0`.
2. **Etapa 2 (Corrección y Razonamiento):** `claude-3-5-sonnet` o `claude-3-7-sonnet` con **Extended Thinking** (`budget_tokens: 4096`).
   - El modelo "piensa" en una cadena privada de razonamiento antes de emitir la corrección. Verifica la validez de los teoremas, comprueba si un camino alternativo del alumno es matemáticamente válido y detecta fallos sutiles en las demostraciones.
   - Evita el sobrecoste de Opus (5x más caro) ofreciendo un nivel de rigor superior en matemáticas avanzadas.

---

## 5. Salida Estructurada y Verificación Mecánica (0 Tokens)

Para asegurar cero errores de suma o formateo:

1. **Feedback por Excepción (Solo Diffs):**
   - Si un ejercicio de 16 páginas está perfecto, el JSON devuelve `feedback: null`. No se pagan tokens de salida redactando prosa innecesaria.
2. **Verificación Mecánica Infranqueable (TypeScript):**
   - El código local comprueba que las puntuaciones parciales no superen el máximo del apartado.
   - Comprueba que toda cita de error devuelva la línea/página existente en la transcripción persistida.
   - Si la aritmética o la cita fallan, el estado pasa a `needs_review` con confianza reducida y **veto estricto de auto-publicación**.

---

## 6. Cuadro Recapitulativo de Costes con Volumetría Real

Para un simulacro de **16 páginas manuscritas** (Tema teórico) procesado vía Batch con Caché:

| Fase | Tokens Entrada | Tokens Salida | Coste Aprox. Sin Batch | Coste Real con Batch + Caché |
| :--- | :---: | :---: | :---: | :---: |
| **Etapa 1: Visión OCR (16 págs)** | ~25.600 (Imágenes) | ~2.500 (LaTeX) | ~0,14 € | **~0,07 €** |
| **Etapa 2: Corrección Sonnet + Thinking** | ~2.500 (LaTeX) + 6.000 (Caché) | ~800 (JSON) | ~0,11 € | **~0,03 €** |
| **TOTAL POR SIMULACRO (16 Págs)** | — | — | ~0,25 € | **~0,10 €** |

### Conclusión Financiera:
Incluso en simulacros extensos de 16 páginas manuscritas, el coste total por corrección completa de alta precisión ronda los **0,10 €**, permitiendo mantener la plataforma en costes totalmente sostenibles mientras se ofrece una corrección con el máximo rigor matemático exigido.
