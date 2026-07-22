# Visión Diferencial y Optimización de Arquitectura IA (Anthropic) - Revisión Profunda

**Fecha:** 21 de julio de 2026
**Modelo de Análisis:** Gemini 3.1 Pro (High)
**Contexto:** Revisión crítica tras la inclusión de volumetrías reales (12-16 páginas manuscritas por examen) y SLAs flexibles (8h/24h) en `requisitos-mvp.md`.

Tras una relectura minuciosa y en profundidad de los documentos de arquitectura (`motor-ia.md`, `diseno-motor-ia.md`, `arquitectura-ia-analisis-diferencial.md`), expongo una visión rectificada y mucho más quirúrgica.

El diseño original documentado en `motor-ia.md` no solo es bueno, sino que contiene decisiones visionarias (como la separación explícita en dos llamadas: OCR y Corrección, o la capa de verificación mecánica). Sin embargo, el volumen extremo de **16 páginas de matemáticas manuscritas** tensa este diseño hasta sus límites. Aquí detallo cómo la arquitectura debe evolucionar para soportarlo.

---

## 1. El Desafío de las 16 Páginas: Chunking de Visión (NUEVO)

El diseño de `motor-ia.md` ya separa correctamente la **Transcripción (Etapa 1)** de la **Corrección (Etapa 2)**. Esta separación es obligatoria para mostrar el escaneo junto a la transcripción (defensa anti-alucinación) y para abaratar futuras recalificaciones si cambia la rúbrica.

Sin embargo, **16 páginas escaneadas generan ~25.600 tokens de imagen.**
Si enviamos esas 16 páginas en una sola llamada de Visión:
1. **Degradación de atención:** El modelo sufrirá el efecto *needle in a haystack* visual, saltándose signos o párrafos enteros al final del documento.
2. **Riesgo de Truncamiento:** Generar el código LaTeX de 16 páginas de matemáticas densas puede exceder el límite de tokens de salida (típicamente 8.192), dejando el examen cortado por la mitad.

**Optimización Arquitectónica (Map-Reduce de Visión):**
La Etapa 1 debe paralelizarse. El motor debe dividir el PDF de 16 páginas en lotes de 3 o 4 páginas (ej. 4 llamadas a la API en paralelo). Una vez resueltas, el sistema concatena el LaTeX resultante en el orden correcto y lo pasa completo a la Etapa 2. Esto garantiza fidelidad absoluta en la transcripción sin aumentar el coste (ya que el consumo de tokens de entrada/salida es lineal).

---

## 2. Abandono de Opus e Integración de "Extended Thinking"

El documento `motor-ia.md` preveía `claude-opus-4-8` para la capa de corrección experta. **Esa decisión debe ser revocada.**

*   **El Relevo:** Las versiones modernas de Sonnet (`claude-3-5-sonnet` / `claude-3-7-sonnet`) destrozan a Opus 3.0 en razonamiento matemático formal, costando una fracción del precio.
*   **Activación de Razonamiento:** Para garantizar la directriz de "Cero Alucinaciones" en matemáticas, la Etapa 2 debe invocar a Sonnet con `thinking: { type: 'adaptive' }` (o `budget_tokens`). Esto fuerza al modelo a abrir un bloque de deducción lógica oculta donde resuelve la demostración del alumno antes de emitir la nota.
*   **Visión (Etapa 1):** Como se le prohíbe evaluar y solo debe transcribir fielmente, se debe configurar con `temperature: 0.0`. Se recomienda pilotar `claude-3-5-haiku` (que ya soporta visión) para esta etapa; si su precisión leyendo LaTeX manuscrito es suficiente, **hundiría los costes un 80% adicional**. Si falla, usar Sonnet 3.5.

---

## 3. Consolidación Hacia la Batches API (El impacto del SLA)

El nuevo requisito establece explícitamente: *“las dudas se envíen cada 8h y las correcciones se realicen cada 24h”*.
Esto cambia las reglas del juego: **la arquitectura de IA pesada no necesita ser síncrona en absoluto.**

*   En lugar de tratar la *Batches API* como una mejora futura "diferida" (`motor-ia.md` §10), debe ser el **motor por defecto** para simulacros y dudas de foro no urgentes.
*   El descuento garantizado del 50% de la Batches API amortigua el inmenso coste de generar miles de tokens de salida en LaTeX durante la transcripción de las 16 páginas.

---

## 4. El Matiz Oculto del Prompt Caching (El umbral de los 4.096)

El diseño actual asume que segmentar el contexto (`installation` -> `global` -> `activity`) y añadir `cache_control` generará ahorros (leyendo a 0.30 $/M en lugar de 3.00 $/M).
**El problema:** Anthropic requiere que el prefijo tenga un mínimo estricto de **4.096 tokens** para activar `cache_creation_input_tokens` en modelos Sonnet/Opus. Si la rúbrica y la solución de un ejercicio suman solo 2.000 tokens, **la caché jamás se activará silenciosamente**, y se pagará precio completo por alumno.

**La Solución:** 
El compilador de contextos de Vega debe asegurar que el bloque estático del `system prompt` supere este umbral, consolidando todo el contexto de la instalación y las directrices de formateo globales en un solo bloque con un único `cache_control` al final. El texto del alumno iría en el array de `messages`.

---

## 5. Output Tokens: Feedback por Excepción y Citas Estrictas

El token de salida es el recurso más caro y lento del sistema.
Para la Etapa 2 (Corrección con Structured Outputs):

1.  **Excepción Positiva:** Si el alumno resuelve el apartado 1a de forma perfecta y obtiene la máxima nota, el JSON Schema debe forzar que el campo `aiFeedback` sea explícitamente nulo. La IA no debe redactar prosa explicando por qué algo está bien.
2.  **Citas por Puntero:** En lugar de pedir a la IA que copie textualmente la cita del error en su JSON (`"quote": "derivamos \\sin(2x)..."`), si la Etapa 1 indexa las líneas del LaTeX, el JSON debe devolver un puntero numérico (`"lineId": 45`). La **Verificación Mecánica** (código puro) busca la línea 45 y extrae el texto para la interfaz del profesor. Esto recorta drásticamente el volumen del JSON devuelto.

---

## Resumen Financiero Realista (Para 16 Páginas)

Calculando sobre la tarifa estándar (que se reduce a la mitad vía Batch) usando Sonnet 3.5:

1.  **Etapa 1 (Visión OCR Fragmentada, 16 págs):** ~25.600 input / ~4.000 output.
    *   *Coste Batch:* ~0,04 € (input) + ~0,03 € (output) = **~0,07 €**
2.  **Etapa 2 (Corrección con Thinking + Caché):** ~4.000 LaTeX + >4.096 Caché input / ~800 output.
    *   *Coste Batch:* ~0,006 € (input) + ~0,006 € (output) = **~0,012 €**

**Coste Total (16 páginas densas, máxima calidad analítica): ~0,08 € por alumno.**
Esta arquitectura respeta al 100% los postulados fundacionales de Vega (verificación mecánica, sin autonomía irresponsable), pero blinda el sistema contra el fallo por sobrecarga de contexto visual y recorta el gasto al mínimo técnico posible dentro de Anthropic.
