# Segunda bateria de pruebas.
## Pruebas sobre [el entorno de test](https://vega-test.opo-mates.es/)

### Contexto
Accede a la web y al [registro IA](https://vega-test.opo-mates.es/registro-ia). Todo lo que te cuente se lanzó el día 27/07/2026.

### Feedback Usuario.

1. Navego, como administrador a /contexto. Veo lo siguiente. "Nivel `installation`, el primero de todos y el único que **no edita el profesorado**: sólo el rol admin. Va delante de las instrucciones globales y viaja en **todas** las llamadas del motor —transcripción, corrección, verificación, respuesta de foro, programación didáctica—, así que es la parte más cacheable del prompt y la que menos debe cambiar.". Esto debería estar en un POP-UP de ayudar para facilitar la edición cuando lo quite para poner el real.
2. He modificado cosas en los contexos. ¿Puedes darle un repaso para ver qué opinas y si es congruente. Te digo algunas cosas que creo que faltan
2.1 Los problemas deben calificarse teniendo en cuenta que valen todos los apartados por igual, salvo que se diga lo contrario. Ten en cuenta esto para los promts (actuales y seed)
3. En una actividad pone lo siguiente. Esos "forum-29" ni sé que son ni aportan nada.
```
Preparación temas y problemas

Dudas Mes 1
Foro
forum-29
·
Moodle forum-29
```
4. Ahora más o menos tengo algun tipo de actividad bien configurada. Analiza si los procesos como los hemos planteado están bien.
5. Los procesos deben ser más fáciles de entender para los profesores. Crea un pop-up que lo explique.
5.1 El sistema ingiere lo pendiente y lo muestra en "Pendiente". Hay que indicar Vega lo procesará a las (xxhoras). Así, el profesor sabe cuando comenzará su corrección.
5.2 Aparcada para mi debería ser "Descartada", pues Vega lo ha descartado. El administrador (no el profesor) debe poder enviar a Pendiente para que le procese cuando llegue su turno.
5.3 Los errores deben poder marcarse como Vistos. Además, el administrador debe poder marcarlos para volver a la cola. 
5.4 Las "Validadas" deben poder ser marcadas como publicadas manualmente. 
5.5 Lo que perseguimos es que el número de cada Tab sea lo que hay pendiente en ese tab. 
5.6 Esta operativa es el core de la aplicación. Dale un repaso de usabilidad. Por ejemplo, el flujo principal "Pendiente Revisar" > "Validada" tiene que ser más accesibel qeu las publicadas o error que se suponen estados finales. 
6. El [Panel](https://vega-test.opo-mates.es/panel) que tenemos ahora (Seguimiento / Panel) es un tema administrativo. Creo que haría falta un panel para el profesor.
7. El panel del profesor incluiria
- Trabajo a realizar (pendientes, etc, bien explicadito y que navegue a la vista)
- Errores sin validar.
- Cuando acabó el ultimo proceso. Actividades que se generaron. Errores a revisar.
8. En general me falta trazabilidad de lo que está haciendo. Por ejemplo entro en [procesos](https://vega-test.opo-mates.es/procesos) y veo que hay 5 ingeridas, 1 prcoesadas,1 fallidas... pero no veo cuales son. Todo debería ser navegable y trazable.