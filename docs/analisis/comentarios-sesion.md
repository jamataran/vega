# Arquitectura final IA (comentarios sesión)
Realizada sesión de trabajo con el equipo, analizamos desde negocio los análisis que han presentado las diferentes IA para dar el Input Humano.

## Versión Codex [Motor IA Codex](./docs/analisis/motor-ia-codex.md)
1. Puede ser una buena idea hacer dos pasadas a la lectura del entregable, al final es la fuente de verdad y una lectura errónea arruinará el proceso. No sé se si se puede tener un agente que, sin tener contexto de la primera operación valide o como se puede hacer. 
2. Evidentemente, aquí la elección del modelo debe ser la más cara y con esfuerzo. 
3. ¿Puede tener sentido para la fase de lectura poder configurar el modelo a nivel de aplicación? (Tener un combo, con las opciones.)
4. ¿Porque sacamos Batch del MVP? Si ahorra costes debe ir. Según indicamos en los requistios,se debe optimizar lo máximo.
5. Sobre la depuración, lo que queremos es un panel donde se puedan ver los registros para luego hablar con claude code (no queremos que exista un chat en el la App).
6. El profesor debe ver información relativa a como se ha llegado a la calificación o resolución. El admisitrador información completa.
7. Entendemos que 6. gasta tokens, por lo que nos gustaría, a nivel de administrador, poder desactivar esta opción cuando esto esté funcionado.
8. La PD debe estar en mente de la arquitectura pero en esta primera iteración sólo vamos a probar con dudas y simulacros de problemas y temas matemáticos. 
9. Hemos dejado [ejemplos](./docs/ejemplos) de entregas y resoluciones.
10. En algunos casos la rubrica o solución es específica de la comunidad. El sistema enviará, si se dispone, de la comunidad autonoma del alumno para encontrar su rubrica.
11. Las herramientas que propones para OCR tal vez se pudieran usan como apoyo. En todo caso luego la IA debería revisar de nuevo las discrepancias, no? Insisto, veo crítico la lectura del PDF.
12. En otros momentos se habia hablado y creemos que de forma acertada que, para las dudas se debería hacer un triaje con un modelo más barato para elegir el modelo.
13. No veo nada de lo que habíamos hablado de omitir ciertos simulacros.

## Version Gemini [Motor IA Gemini](./docs/analisis/motor-ia-gemini.md)
1. Vuelve a poner sonnet para lectura. Recordemos la criticidiad de esto. 
2. No hace validación de la lectura ni la respuesta
