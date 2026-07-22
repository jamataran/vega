# Revisión inicial en entorno test.

## Contexto
Se están haciendo las pruebas en entorno de test https://vega-test.opo-mates.es/, con las credenciales que hay en [.env.local](../../.env.local)

## Feedback usuario
1. Se han cargado 3 foros de dudas y dos simulacros. No funciona ninguno de ellos.
2. En la pestaña [Registro de IA](https://vega-test.opo-mates.es/registro-ia) veo operaciones pero no veo el log completo ni tengo forma de poder copiartelo.
3. No es capaz a procesar ninguna petición. Muestro log a continuación
```
forum-29·Moodle ha rechazado la llamada a mod_forum_get_forum_discussions_paginated (accessexception): Excepción al control de acceso. Lo más habitual es que «mod_forum_get_forum_discussions_paginated» no esté añadida al servicio web del token: compruébalo en Moodle, en Administración del sitio → Servidor → Servicios web → Servicios externos → Funciones. Si está, revisa que el usuario dueño del token tenga la capacidad webservice/rest:use y esté autorizado en el servicio.
forum-35·Moodle ha rechazado la llamada a mod_forum_get_forum_discussions_paginated (accessexception): Excepción al control de acceso. Lo más habitual es que «mod_forum_get_forum_discussions_paginated» no esté añadida al servicio web del token: compruébalo en Moodle, en Administración del sitio → Servidor → Servicios web → Servicios externos → Funciones. Si está, revisa que el usuario dueño del token tenga la capacidad webservice/rest:use y esté autorizado en el servicio.
forum-36·Moodle ha rechazado la llamada a mod_forum_get_forum_discussions_paginated (accessexception): Excepción al control de acceso. Lo más habitual es que «mod_forum_get_forum_discussions_paginated» no esté añadida al servicio web del token: compruébalo en Moodle, en Administración del sitio → Servidor → Servicios web → Servicios externos → Funciones. Si está, revisa que el usuario dueño del token tenga la capacidad webservice/rest:use y esté autorizado en el servicio.
```
3.1 Protocolo REST está habilitado. El resto de servicios funcionan
3.2 En mi moodle no existe mod_forum_get_forum_discussions_paginated.
3.3 Todas las funciones mod_forum_get_ están permitidas
3.4 Esa función esta deprecada en Moodle 3+
4. El apartado "Reparto de puntos" dentro de una actividad, [ej.](https://vega-test.opo-mates.es/actividades/b117f368-a48b-40b0-953c-a0110932a795) no debería ser así. Debe esperar también un texto o un fichero tex como resto de contexto. Si esto no supone un problema ahora, creemos con GH un asunto y se valorará si arreglarlo.
5. Tienes credenciales, hay [actividades creadas](https://vega-test.opo-mates.es/actividades). ¿Puedes lanzar tu una prueba y revisar que todo va bien?
6. Ya quiero cambios quirurgicos y que funcione todo. 
7. En [ajustes](https://vega-test.opo-mates.es/ajustes), "Motor de IA", Transporte pone "Síncrono" y la otra opción aparece pendiente.
7.1 Si esto va a ahorrar habría que valorar hacerlo ya. ¿Qué necesitas más?
7.2 Recuerda que en esta fase buscamos algo medio estable. Lo demas... GH y creamos ticket. Tenlo en cuenta para el motor de IA.
