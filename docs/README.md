# Documentación de Vega

Vega corrige entregas y responde dudas de foro sobre Moodle, y deja la última palabra al
profesor, que revisa y valida desde el móvil. La materia no forma parte del núcleo: lo que la IA
sabe de ella vive en los ficheros de [`contexts/`](../contexts/README.md). Esta carpeta contiene el
diseño de producto y de ingeniería.

## Índice

| Documento | Qué contiene |
|---|---|
| [`hitos.md`](hitos.md) | El plan de trabajo: cinco hitos, qué HU entra en cada uno y qué falta |
| [`arquitectura.md`](arquitectura.md) | Componentes, flujo de una entrega de principio a fin y por qué el monorepo está partido así |
| [`modelo-de-datos.md`](modelo-de-datos.md) | Diagrama entidad-relación y máquina de estados de `SubmissionStatus` |
| [`api.md`](api.md) | Referencia de todos los endpoints, derivada del contrato de `@vega/shared` |
| [`glosario.md`](glosario.md) | Vocabulario del dominio: actividad, entrega, foro, contexto, apartado… |
| [`hu/`](hu/) | Historias de usuario. **Es el documento vivo del producto** |
| [`decisiones/`](decisiones/) | ADRs: decisiones de arquitectura con su contexto y sus consecuencias |
| [`analisis/`](analisis/) | Diseño del motor de IA antes de implementarlo: pipeline, anti-alucinación y coste |
| [`revision/`](revision/) | Revisiones de cierre de hito: qué se comprobó ejecutándolo y qué quedó abierto |
| [`tareas-claude-code.md`](tareas-claude-code.md) | **Obsoleto.** Backlog previo al giro a TypeScript: describe un backend Python/FastAPI que ya no existe. Se conserva sólo como rastro; no lo uses como referencia |

## Fuentes de verdad

Cuando la documentación y el código discrepen, **manda el código**. Las tres fuentes canónicas son:

| Fuente | Qué define |
|---|---|
| `packages/shared/src/enums.ts` | Roles, tipos de tarea, estados de entrega, niveles de contexto, marcas de OCR |
| `packages/shared/src/domain.ts` | Entidades del dominio y sus invariantes (`effectivePoints`, `totalScore`) |
| `packages/shared/src/api.ts` | Contrato HTTP: peticiones, respuestas, códigos de error y el objeto `routes` |
| `apps/api/migrations/0001_init.sql` | Esquema de base de datos |

Toda la documentación de esta carpeta se ha escrito contra esas cuatro fuentes. Si cambias una,
actualiza el documento correspondiente en el mismo commit.

## Cómo se usa esta documentación

1. **Producto**: las HU de [`hu/`](hu/) se refinan con el cliente. Cada una lleva una sección de
   *Preguntas abiertas* que es justamente el material de las sesiones de refinamiento.
2. **Ingeniería**: antes de implementar una HU, comprueba que su sección de *Notas de
   implementación* sigue siendo coherente con `@vega/shared`. Si no lo es, se corrige la HU o se
   corrige el contrato — nunca se implementa la divergencia en silencio.
3. **Decisiones**: todo cambio estructural (stack, despliegue, límites entre paquetes) se
   documenta como ADR nuevo. Los ADR no se editan una vez aceptados; se supersede uno con otro.

## Convenciones de escritura

- Español de España en toda la documentación, en la UI y en los contextos de corrección.
- Inglés en el código: identificadores, nombres de tabla, columnas, campos de la API.
- Notas numéricas con **coma decimal** (`7,25`), como exige la academia.
- Diagramas en Mermaid dentro del propio Markdown; nada de imágenes binarias.
