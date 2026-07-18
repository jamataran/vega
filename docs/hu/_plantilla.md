# HU-XX — Título

| | |
|---|---|
| **Id** | HU-XX |
| **Épica** | Acceso y usuarios / Buzones y contexto de corrección / Ingesta / Transcripción / Corrección / Revisión y validación / Publicación / Observabilidad y coste |
| **Estado** | borrador · refinada · lista · implementada |
| **Prioridad** | Must · Should · Could · Won't |
| **Estimación** | 1 · 2 · 3 · 5 · 8 · 13 |
| **Depende de** | HU-YY, HU-ZZ · o «ninguna» |
| **Bloquea a** | HU-AA · o «ninguna» |
| **Entrega mockeada** | Sí · Parcial · No |

## Narrativa

**Como** \<rol: profesor / administrador / sistema\>
**quiero** \<capacidad concreta\>
**para** \<beneficio observable, no una repetición de la capacidad\>.

> Uno o dos párrafos de contexto: por qué esto importa, qué pasa hoy sin ello, qué se ha decidido
> ya en otro sitio (ADR, otra HU) y no hace falta volver a discutir aquí.

## Criterios de aceptación

### Escenario 1: \<nombre descriptivo del caso\>

```gherkin
Dado que <estado inicial concreto y verificable>
Y <condición adicional si hace falta>
Cuando <acción del actor, una sola>
Entonces <resultado observable y comprobable>
Y <resultado adicional>
```

### Escenario 2: \<caso alternativo o de error\>

```gherkin
Dado que <...>
Cuando <...>
Entonces <...>
```

> Escribe al menos un escenario de camino feliz, uno de error y uno de permisos, cuando apliquen.
> Cada `Entonces` debe poder verificarlo alguien que no haya escrito la HU.

## Reglas de negocio

**RN-1.** …

**RN-2.** …

> Numeradas para poder citarlas desde los criterios, desde el código y desde las conversaciones.
> Una regla por punto. Si una regla necesita un «además», probablemente son dos reglas.

## Casos límite

| Caso | Qué se hace |
|---|---|
| … | … |

> No basta con enumerar los casos raros: hay que decir qué hace el sistema en cada uno.

## Fuera de alcance

- …
- …

> Sección obligatoria. Lo que esta HU **no** hace, y dónde se trata si se trata en algún sitio
> (otra HU, hoja de ruta, decisión de no hacerlo).

## Notas de implementación

**Entidades** (`@vega/shared`): …

**Estados** (`SubmissionStatus`): …

**Endpoints** (`routes`): …

**Esquema** (`0001_init.sql`): …

**UI**: …

> Enlaza al modelo de dominio real. Si esta HU necesita algo que **no está** en el contrato,
> dilo aquí explícitamente y llévalo a las preguntas abiertas: no se implementa una ampliación
> del contrato sin decidirla antes.

## Preguntas abiertas

1. **\<Pregunta concreta\>** — \<por qué importa\>. Opciones: (a) …; (b) …. Consecuencia de cada
   una: … `[bloqueante]`
2. **\<Pregunta concreta\>** — …

> Preguntas de verdad, con opciones y consecuencias. Si la respuesta es obvia, no es una pregunta
> abierta: es una regla de negocio que faltaba escribir. Marca `[bloqueante]` las que impiden pasar
> la HU a estado *lista*.
