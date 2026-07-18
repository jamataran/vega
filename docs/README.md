# Documentación de Vega

Vega corrige exámenes de matemáticas manuscritos con IA y deja la última palabra al profesor,
que revisa y valida desde el móvil. Esta carpeta contiene el diseño de producto y de ingeniería.

## Índice

| Documento | Qué contiene |
|---|---|
| [`arquitectura.md`](arquitectura.md) | Componentes, flujo de una entrega de principio a fin y por qué el monorepo está partido así |
| [`modelo-de-datos.md`](modelo-de-datos.md) | Diagrama entidad-relación y máquina de estados de `SubmissionStatus` |
| [`api.md`](api.md) | Referencia de todos los endpoints, derivada del contrato de `@vega/shared` |
| [`glosario.md`](glosario.md) | Vocabulario de la academia: buzón, simulacro, apartado, rúbrica… |
| [`hu/`](hu/) | Historias de usuario. **Es el documento vivo del producto** |
| [`decisiones/`](decisiones/) | ADRs: decisiones de arquitectura con su contexto y sus consecuencias |
| [`tareas-claude-code.md`](tareas-claude-code.md) | Backlog histórico de implementación (previo al giro a TypeScript; ver ADR 0001) |

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
