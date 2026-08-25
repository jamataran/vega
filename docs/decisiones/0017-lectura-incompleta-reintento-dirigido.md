# ADR 0017 — Una lectura incompleta se relee; una sola lectura completa basta para corregir

**Estado**: Aceptado

**Enmienda**: ADR 0015 (la regla «una página ausente, duplicada o inesperada hace fallar la
entrega»).

## Contexto

El primer lote grande de producción (23-08-2026) dejó dos entregas de trece páginas sin corregir
con «no ha transcrito las páginas 2…13». El ledger enseñó tres cosas:

1. La causa era un **desajuste entre el prompt y el esquema de salida**: el prompt exigía
   `pages[].notes` y `pages[].confidence`, el esquema no los admitía, y con salida estructurada
   —que restringe la decodificación al esquema— el modelo descarrilaba tras la primera página.
2. El fallo es **no determinista**: en la misma entrega una lectura fue perfecta (13 páginas,
   10 554 tokens) y la otra se quedó en la página 1. La regla del ADR 0015 tiró las dos.
3. Releer sólo lo que falta cuesta una petición con el prefijo cacheado; morir cuesta las dos
   lecturas enteras y una entrega que el profesor tiene que reprocesar a mano.

## Decisión

- **El esquema de respuesta es el contrato con el prompt** y va estricto a todos los niveles.
  Una prueba del API valida el ejemplo JSON de cada prompt contra su esquema; un cambio de uno
  sin el otro rompe la CI. (Hoy sólo cuadra el de transcripción; los de corrección, triaje y
  verificación quedan marcados como pendientes.)
- **Cada lectura se evalúa al llegar contra el manifiesto del original**, sin lanzar. Un duplicado
  con `latex` vacío es ruido y se descarta; un duplicado con contenido y una página que falta se
  **releen una vez**, enviando sólo los bloques que las contienen y diciéndole al modelo que es una
  relectura y de qué examen (`manifest`).
- **Consolidación asimétrica**: si tras releer una página sólo está en una lectura, se toma tal
  cual (sin marcador en el texto), se marca `DISCREPANCIA` con una nota fija, la confianza global
  paga **una** penalización de 0,15 —no una por página— y la corrección lleva el aviso
  `lectura_parcial` en `verification.issues`, que es lo que se persiste y lo que la ficha enseña.
- La entrega **sólo falla** cuando una página no está en **ninguna** de las dos lecturas después
  de releer. El mensaje lo dice: «tras reintentar la lectura».

## Consecuencias

- Una lectura rota ya no tira la otra, ya pagada. El coste máximo añadido por entrega es una
  relectura por pasada.
- `TranscriptionPage` gana `confidence` y `notes` opcionales (jsonb, sin migración); las
  transcripciones anteriores no los traen y nada los exige.
- «Sólo una lectura» deja de ser invisible: va a revisión con aviso y con la confianza rebajada,
  pero se corrige. Corregir sobre una transcripción buena sin contraste es mejor que no corregir;
  corregir sobre una a la que le faltan páginas sigue siendo peor que fallar.
- El ADR 0015 no se edita; su regla de ensamblado queda enmendada por ésta.
