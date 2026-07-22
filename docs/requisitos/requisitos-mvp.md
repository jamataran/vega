# Vega. Requisitos.

## Resumen 
Vega debe ser capaz de contestar dudas y corregir entregas de alumnos de un Moodle con contenido de preparación de Oposiciones de Matemáticas. Se busca hacer un sistema extensible a cualquier Moodle con cualquier tipo de alumnado pero el foco principal es el Moodle Matemático.

## Supuestos
* Existe un Moodle (3+) que tiene foros asociados a un tema (Latex) o problemas (Latex) donde los alumnos ponen dudas relativas a ellos o a un vídeo con la solución.
* Ese Moodle tiene también un buzón para la entrega de simulacros. De cada simulacro se tiene una solución en latex.
* Los profesores en la actualidad corrigen manualmente las entregas de los alumnos y contestan a las dudas en los foros.
* En las correcciones, valoran el grado de avance en función de la solución propuesta. Si el alumno no ha seguido el camino de la solución valoran resultado, grado de avance y grado de correción y rigor matemático. 
* En las dudas se acude al material que se complementa con el juicio experto de los matemáticos que lo atienden.
* Hay varios tipos de dudas en función al perfil de alumnado. Se podria afirmar que hay:
1. Dudas sencillas, resolución prácticamente inmediata.
2. Dudas complejas. Un profesor puede tardar hasta horas ya que no sólo hay que resolver la duda si no darle el máximo rigor matemático, contrajemplos, etc.
3. Mensajes que no son perse una duda (un alumno te indica un error tipográfico, te agradece algo, etc.)
* Hay un tipo de buzón que se utiliza para programación didáctica, otra de las pruebas. Aquí la corrección mezcla otros asuntos.
a) Normativa aplicable. Formatos, contenidos, etc. Cambia por comunidad.
b) Hay que corregir redacción, adecuación, etc. 
c) Hay que corregir situaciones de aprendizaje y cuestiones muy docentes.
* La gran mayoría de las entregas de los alumnos son manuscritos escaneados en PDF con alto contenido matemáticos (fórmulas, teoremas, demostraciones, etc.)
* Los simulacros son entre 12-16 páginas manuscritas en el caso de los temas (teoría matemática)
* Los simulacros de problemas unas 10 páginas.

## Necesidad.
* Quiero un sistema que, con iteraciones se pueda convertir en un resolutor de dudas para Moodle.
* Inicialemnte quiero que solucione mis problemas del Moodle Matemático.
* Es IMPRESCINDIBLE que el sistema no alucine y no dé una repuesta incorrecta.
* Cabe la posibildiad de que las dudas se envíen cada 8h y las correcciones se realicen cada 24h.
* Siempre el profesor tiene que validar la respuesta final.
* El profesor debe conocer el coste total de la corrección (y de sus correcciones).
* El profesor debe poder depurar la respuesta final que se genera. Con esto y ayuda del programador, afinaremos los prompts.

## Punto de partida.
* He estado haciendo pruebas con Claude Desktop y tras pasarle un simulacro y una correción el resultado es muy bueno, con modelos altos. 
* No soy un gran experto IA. Tengo juicio medio y soy arquitecto de soluciones.
* La solución se va a liber opensource para que la gente pueda valorar la calidad de la solución.
* Los cobros por las correcciones son mínimos (0€ en algunos casos) por lo que es imprescindible optimizar al máximo el gasto de tokens.
* Aunque los cobros sean mínimos, debe priorizarse calidad frente a coste. Lo que no puede ocurrir es que se cometan fallos.
* He pensado que estaría bien que existiera un adminsitrador que guardara las pautas comunes y luego que cada profesor guardara sus aulas con sus particularidades de corrección.

## Requisitos técnicos.
* Como he probado Claude Desktop vamos a ir con Anthropic. En futuras iteraciones se puede segmentar el uso de modelos.
* El administrador puede conocer el coste total mensual e ir navegando hacia lo que lo ha generado.
* El administrador puede depurar, conversando con LLMS (como claude code) las llamadas. Se debe tener registro de todo, que llegó a la API, que respondió y todo lo necesario para afinar los prompts.
* El sistema, si es posible, con un agente externo, da una % de fiabilidad al proceeso (global)

