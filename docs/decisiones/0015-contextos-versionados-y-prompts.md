# ADR 0015 — Contextos en cinco niveles y prompts versionados en PostgreSQL

**Estado**: Aceptado

**Sustituye a**: ADR 0003.

## Contexto

Tres niveles no representaban la plantilla compartida ni el curso. Los Markdown empaquetados se leían
como almacén vivo y los prompts del repositorio no participaban en las llamadas.

## Decisión

- La jerarquía es `global → activity_kind → template → course → activity`.
- Cada contexto tiene identidad y versiones inmutables. Guardar crea `N+1` con bloqueo optimista y mueve
  el puntero activo; nunca sobrescribe el historial.
- Los Markdown son sólo semillas de una instalación nueva. Tras sembrar, PostgreSQL manda.
- Cada ejecución fija ids, versiones y hashes de los segmentos que utiliza.
- Los prompts tienen registro versionado, edición exclusiva de administración, comparación con la versión
  anterior y restauración del valor empaquetado mediante una versión nueva.
- Hay dos puntos de caché: tras plantilla y tras el material completo de la actividad.

## Consecuencias

Una corrección histórica puede reconstruir instrucciones exactas desde el ledger. Los permisos se aplican
por nivel y el despliegue no escribe en Git ni necesita credenciales del repositorio.

