import { defineConfig } from 'tsup';

/**
 * Empaquetado del API para la imagen de producción.
 *
 * Dos entradas, no una: el entrypoint del contenedor aplica las migraciones
 * antes de arrancar Fastify, así que `migrate` tiene que existir en dist/ igual
 * que el servidor. Antes se generaba con una segunda llamada a tsup dentro del
 * Dockerfile; tenerlo aquí evita que las dos invocaciones se desincronicen.
 *
 * `noExternal` es la clave de todo esto. Por defecto tsup deja fuera del bundle
 * cualquier cosa declarada en `dependencies`, incluidos los paquetes del
 * workspace. Pero @vega/* publica TypeScript en crudo (`main: ./src/index.ts`),
 * de modo que el bundle acababa con un `import ... from "@vega/shared"` que en
 * runtime resolvía a un .ts dentro de node_modules y Node 22 abortaba con
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING (no aplica el type stripping bajo
 * node_modules). Al marcarlos como internos, su código entra en el bundle y la
 * imagen final no depende de que nadie compile los paquetes del workspace.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@vega\//],
});
