# ADR 0001 — Monorepo TypeScript de punta a punta

**Estado**: Aceptado

## Contexto

El diseño inicial (recogido en `docs/tareas-claude-code.md`) planteaba un backend en Python 3.12
con FastAPI, SQLAlchemy y Alembic, y un frontend en React con TypeScript. Es una combinación
estándar y perfectamente razonable, pero para Vega tenía un coste concreto: **el modelo de dominio
quedaba escrito dos veces**.

Vega es, en lo esencial, una aplicación de formularios sobre un modelo de datos con muchos matices:
ocho estados de entrega con transiciones válidas y prohibidas, puntuación de la IA y del profesor
separadas, tres niveles de contexto, marcas de OCR con enum cerrado. Cada uno de esos matices
tendría que existir como modelo Pydantic en Python y como tipo TypeScript en el front, y
mantenerse sincronizado a mano o mediante generación de cliente OpenAPI.

Además, el equipo es de una persona. Cambiar de lenguaje entre el motor de corrección y la
pantalla de revisión tiene un coste de contexto real todos los días.

## Decisión

**TypeScript en todo el monorepo**, con `packages/shared` como contrato único.

- API: Node 22 + Fastify, validación con Zod.
- Front: React 18 + Vite + Tailwind.
- Datos: PostgreSQL 16 con Drizzle ORM.
- `packages/shared` define los esquemas Zod, los tipos inferidos de ellos, las funciones puras del
  dominio (`effectivePoints`, `effectiveSource`, `totalScore`) y el objeto `routes`.
- `packages/core` contiene el motor de corrección, sin dependencias de HTTP ni de LMS.
- Gestión con pnpm workspaces (`apps/*`, `packages/*`, `connectors/*`).

La regla que sostiene la decisión: **el mismo esquema Zod valida en los dos extremos del cable**.
El front construye la petición con el esquema y el API la valida con el mismo esquema.

## Consecuencias

**A favor**

- Un cambio de contrato rompe la compilación del front y del API a la vez, en el momento de
  hacerlo, no en producción.
- El front no escribe rutas a mano: las importa de `routes`. No hay literales de URL sueltos.
- Las funciones del dominio (`totalScore`) se ejecutan en el navegador para la vista previa y en
  el servidor para persistir, con la misma implementación. No hay dos redondeos distintos.
- Un solo `pnpm install`, un solo linter, un solo runner de tests, una sola CI.
- Los mensajes de validación en español viven en el esquema Zod y llegan gratis a la UI.

**En contra**

- Se renuncia al ecosistema Python para tratamiento de PDF e imagen, que es más maduro. Si hiciera
  falta partir PDFs en imágenes de página con calidad fina, hay que buscar equivalente en Node o
  invocar un binario (`pdftoppm`) desde el proceso.
- El código previo de `corrige.py` se reescribe, no se porta.
- Drizzle es menos maduro que SQLAlchemy. Se mitiga con el ADR 0002: las migraciones son SQL
  plano, así que la parte de Drizzle que se usa es la de consulta, no la de esquema.
- Node acarrea CPU-bound peor que Python con procesos separados. Para el volumen previsto
  (decenas de entregas por noche, y el trabajo pesado sucede en la API de Anthropic, no aquí) es
  irrelevante.

**Se invalida si**: aparece una necesidad seria de procesamiento local de imagen o de cómputo
simbólico (validar algebraicamente la respuesta del alumno con un CAS, por ejemplo). En ese caso
lo razonable no es revertir el monorepo, sino sacar ese trozo a un servicio aparte con contrato
HTTP propio.
