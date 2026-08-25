# Revisiones de cierre de hito

Un hito se da por cerrado cuando alguien lo comprueba **ejecutándolo**, no cuando el tablero dice
que sí. Lo de esta carpeta son esas comprobaciones: qué se ejecutó, qué salió, qué estaba mal en la
documentación y qué queda abierto antes de empezar lo siguiente.

Se diferencian de los documentos de diseño ([`motor-ia.md`](../motor-ia.md),
[`diseno-motor-ia.md`](../diseno-motor-ia.md)) en la dirección: allí se diseña lo que todavía no
existe; aquí se audita lo que ya está.

| Documento | Cuándo | Qué revisa |
|---|---|---|
| [`h2-preparacion-motor-ia.md`](h2-preparacion-motor-ia.md) | 2026-07-22 | Si H2 deja la casa montada para escribir el motor de IA: persistencia de prompts, importación desde Moodle, llamadas simuladas, registro, depuración y planificador |
| [`20260824-incidencias-lote-sin-limite.md`](20260824-incidencias-lote-sin-limite.md) | 2026-08-24 | Tres fallos del primer lote grande de producción, con su evidencia en el ledger, el diseño del arreglo y el plan de implementación en tres PR: `request_too_large`, timeout de descarga de Moodle y lecturas incompletas |
