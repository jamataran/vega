---
name: vega-copy
description: Redacta o revisa microcopy de la interfaz de Vega: botones, estados, errores, onboarding, feedback de corrección y mensajes relacionados con Moodle. Mantiene una voz docente, precisa y no antropomórfica.
argument-hint: "[flujo, textos o archivo]"
---

Redacta o revisa `$ARGUMENTS` según la voz de Vega.

## Criterios

- La primera lectura debe revelar qué ha ocurrido y qué puede hacer el usuario.
- Diferencia propuesta de IA, revisión docente y publicación.
- Usa verbos concretos y evita lenguaje promocional dentro del producto.
- No atribuyas certeza, intención o comprensión humana a la IA.
- Conserva la terminología del dominio y la longitud apropiada al componente.
- Para errores: explica el problema, el impacto y la siguiente acción sin culpar al usuario.

Devuelve el texto final en contexto. Cuando exista una ambigüedad funcional que cambie el significado, identifícala en lugar de inventar el comportamiento.
