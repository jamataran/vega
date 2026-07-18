# Decisiones de arquitectura (ADR)

Registro de las decisiones estructurales de Vega. Cada una explica **el contexto** en el que se
tomó, **la decisión** y **las consecuencias** — incluidas las malas.

## Reglas

1. Un ADR aceptado **no se edita**. Si la decisión cambia, se escribe uno nuevo que la sustituye y
   se marca el antiguo como `Sustituido por ADR-XXXX`.
2. Numeración correlativa de cuatro dígitos: `0009-titulo-corto.md`.
3. Se escribe un ADR cuando la decisión es cara de revertir, afecta a más de un paquete, o alguien
   razonable habría elegido lo contrario. Lo demás va en el código.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [0001](0001-monorepo-typescript.md) | Monorepo TypeScript de punta a punta | Aceptado |
| [0002](0002-migraciones-sql-planas.md) | Migraciones SQL planas aplicadas al arrancar | Aceptado |
| [0003](0003-contexto-tres-niveles.md) | Contexto de corrección en tres niveles | Aceptado |
| [0004](0004-validacion-humana-obligatoria.md) | El profesor siempre valida antes de publicar | Aceptado |
| [0005](0005-proveedor-ia-intercambiable.md) | Proveedor de IA intercambiable, mock por defecto | Aceptado |
| [0006](0006-conectores-lms-interfaz-minima.md) | Conectores LMS tras una interfaz mínima | Aceptado |
| [0007](0007-dos-entornos-portainer.md) | Dos entornos desplegados por dos Portainer | Aceptado |
| [0008](0008-separar-puntos-ia-y-profesor.md) | Separar `aiPoints` de `teacherPoints` | Aceptado |
