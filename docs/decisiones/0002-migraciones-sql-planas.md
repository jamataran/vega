# ADR 0002 — Migraciones SQL planas aplicadas al arrancar, en lugar de drizzle-kit

**Estado**: Aceptado

## Contexto

Vega usa Drizzle ORM. Lo natural sería usar también `drizzle-kit`: se declara el esquema en
TypeScript, la herramienta compara contra la base de datos y genera la migración.

El problema es el modelo de despliegue (ver ADR 0007). Vega se despliega como dos imágenes Docker
publicadas en GHCR y arrancadas por Portainer contra un fichero compose. En ese flujo **no hay un
sitio natural donde ejecutar `drizzle-kit migrate`**: no hay paso de release, no hay una consola
donde entrar antes de levantar el contenedor, y encadenar un contenedor de migración en el compose
para luego arrancar el API es exactamente la clase de ceremonia que se rompe cuando se despliega a
las once de la noche.

Se suma que el esquema de Vega tiene restricciones que un generador expresa mal o no expresa: la
clave única compuesta `(mailbox_id, student_ref, original_filename)` que hace idempotente la
ingesta, los `CHECK` de rango sobre las confianzas, `ON DELETE SET NULL` en `validated_by` frente
a `ON DELETE CASCADE` en el resto. Diffs generados sobre eso son diffs que hay que revisar a mano
de todas formas.

## Decisión

**Migraciones en SQL plano, numeradas, versionadas en `apps/api/migrations/`, aplicadas por el
propio API al arrancar.**

- Ficheros `NNNN_nombre.sql` (`0001_init.sql`, `0002_…`), aplicados en orden.
- El API ejecuta las pendientes al arrancar, dentro de una transacción por fichero, registrando
  las aplicadas en una tabla de control.
- Cada migración se escribe para poder ejecutarse sobre una base de datos vacía y para ser
  **idempotente**: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc.
- Drizzle se usa como **capa de consulta**, no como fuente del esquema. Los tipos de tabla se
  escriben a mano para reflejar lo que el SQL ya creó.
- `drizzle-kit` no forma parte del flujo.

## Consecuencias

**A favor**

- **El cambio de esquema viaja dentro de la imagen del API.** Desplegar es cambiar el tag de la
  imagen. No hay paso manual, ni orden entre pasos que se pueda equivocar.
- Se puede escribir SQL exacto: `CHECK`, índices parciales, claves únicas compuestas, extensiones
  (`pgcrypto`), sin pelear con lo que el generador sabe expresar.
- La migración que se revisa en el PR es literalmente la que se ejecutará en producción. No hay
  generación intermedia.
- Rehacer el entorno de test desde cero es levantar el contenedor contra una base vacía.

**En contra**

- **El esquema queda escrito dos veces**: en el SQL y en las definiciones de tabla de Drizzle. Una
  discrepancia no la detecta el compilador; la detecta un test. Hace falta un test de integración
  que arranque contra una base migrada y consulte todas las tablas.
- El arranque del API depende de que la base de datos esté disponible y de que la migración pase.
  Una migración rota impide arrancar. Es el comportamiento deseado — mejor no arrancar que
  arrancar con el esquema equivocado — pero hay que preverlo en el healthcheck del compose
  (`depends_on` con condición, reintentos).
- **Dos réplicas del API arrancando a la vez pueden intentar migrar simultáneamente.** Se resuelve
  con un advisory lock de Postgres (`pg_advisory_lock`) alrededor del proceso de migración. Hoy
  Vega corre con una réplica, pero la protección se implementa desde el principio.
- No hay rollback automático. Una migración destructiva mal escrita se arregla con otra migración
  hacia delante y con la copia de seguridad. Consecuencia asumida: **las migraciones no borran
  datos**; renombrar una columna es añadir, copiar y dejar de leer la vieja.
