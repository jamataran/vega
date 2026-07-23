# Configurar Vega paso a paso

Esta guía recorre, en el orden recomendado, todo lo que hay que tocar para que una instalación
nueva de Vega corrija de verdad. Cada sección indica la pantalla de la aplicación en la que se
hace. Los pantallazos se irán añadiendo a medida que se documente el piloto; el texto describe
siempre lo que se ve en pantalla.

> **Quién hace cada cosa.** Los pasos 1–4 son de administración (no aparecen en el menú de un
> profesor). Los pasos 5–7 los puede hacer cualquier profesor con acceso a los cursos.

## 1. Entrar por primera vez

1. Despliega la aplicación (ver [`arquitectura.md`](arquitectura.md)) y abre la web.
2. Entra con el administrador inicial (`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`).
   Si no fijaste esas variables, el usuario es el de fábrica y **la primera tarea es cambiar la
   contraseña**: el arranque lo recuerda en el log en cada inicio hasta que se haga.
3. En **Usuarios**, da de alta al profesorado con su correo y su rol.

## 2. Ajustes → Anthropic

Pantalla **Ajustes**, sección «Anthropic»:

1. **Proveedor**: déjalo en «Simulado» hasta tenerlo todo configurado; con el simulado se puede
   recorrer la aplicación entera sin gastar un céntimo. Cámbialo a «Anthropic» cuando vayas a
   corregir de verdad.
2. **Modelos**: los combos ya sólo ofrecen combinaciones compatibles. El punto de partida
   recomendado es el que trae por defecto: lectura y corrección con `claude-opus-4-8`,
   verificación con `claude-sonnet-5` y triaje con `claude-haiku-4-5`.
3. **Clave de API**: pégala y guarda. La clave se escribe pero nunca se vuelve a leer desde la
   interfaz; si se pierde, se pega otra.
4. Pulsa **Probar conexión**. El resultado sale en la propia pantalla: si la clave no vale o el
   modelo no está disponible, lo dice ahí y no hay que ir a buscar logs.

## 3. Ajustes → Motor de IA

En la misma pantalla, sección «Motor de IA»:

- **Transporte**: «Síncrono» por ahora (el modo por lotes del proveedor llegará con la
  orquestación durable).
- **Verificación con IA**: encendida. Es la segunda opinión que audita cada corrección; la
  comprobación mecánica de citas no se puede apagar nunca.
- **Resúmenes de razonamiento**: encendidos si quieres que cada corrección traiga notas internas
  para el profesor (consumen tokens; no se publican jamás al alumno).
- **Umbral de confianza** (0,75 por defecto): por debajo, la corrección queda señalada en la cola.
- **Páginas por bloque** (4 por defecto): en cuántas páginas se trocea el PDF para la lectura.
- **Días de registro** (180): cuánto se conserva el registro técnico de llamadas a la IA.
- **Antigüedad máxima** (0 = sin límite): días de antigüedad a partir de los cuales una entrega ya
  no se corrige. Al conectar un curso con historial, el primer proceso se encuentra meses de
  entregas que nadie va a leer y que cuestan dinero real; con esto no se descargan siquiera. Lo que
  ya estuviera en la cola y supere el límite se **aparca** con el motivo escrito, no se borra: si
  resulta que sí la querías, un «Volver a procesar» la recupera.

## 4. Ajustes → Moodle, correo y planificación

1. **Moodle**: la URL del aula virtual y el conector (`moodle3` para un Moodle real ≥ 3.x).
   El token **no** va aquí: es personal de cada profesor (paso 5).
2. **Correo**: el SMTP con el que Vega enviará avisos. Opcional para el piloto.
3. **Planificación**: cada cuántos minutos corre solo el proceso de corrección, **por tipo de
   actividad**: los foros suelen ir con cadencia corta (una duda no debería esperar horas) y las
   entregas, más caras de corregir, espaciadas — por ejemplo, foros cada 15 minutos y entregas
   cada hora. Mientras se prueba, es más cómodo dejar ambos apagados y forzar los procesos a mano
   desde «Procesos» (un proceso forzado barre siempre los dos tipos).

## 5. Mi conexión con Moodle (cada profesor)

En **Ajustes**, arriba del todo, cada profesor pega su token personal de Moodle. Ese token decide
qué cursos ve y con qué credencial se importan actividades. Sin token no hay ingesta.

Tras pegarlo, pulsa **«Probar conexión»** y no des el paso por bueno hasta que todas las
comprobaciones estén en verde: Moodle **no añade ninguna función al crear un servicio externo**
y hay que darlas de alta a mano, una a una (Administración del sitio → Servidor → Servicios web
→ Servicios externos → Funciones). La lista completa, con el porqué de cada una, está en la
tabla «Moodle web services» del README del repositorio. Ojo con la trampa clásica: con
`mod_assign_get_assignments` el import de actividades funciona, pero sin
`mod_assign_get_submissions` la ingesta no puede traer **ningún envío** de los alumnos.

## 6. Prompts (administración)

Pantalla **Prompts** del menú de administración. Son las **instrucciones globales del motor**:
cómo se transcribe, cómo se corrige un problema o un tema, cómo se clasifica un mensaje de foro,
cómo se responde y cómo se verifica. Viven en la base de datos, versionadas: cada guardado crea
una versión nueva y la siguiente ejecución usa la activa, así que se puede experimentar y volver
atrás con «Restaurar valor predeterminado».

- El selector «Operación» lleva debajo la explicación de qué hace el prompt elegido y cuándo se
  ejecuta.
- **Instrucciones globales** (`global.system`) se antepone a todas las llamadas: es el sitio de
  las reglas comunes (idioma, tono, coma decimal…).
- Una instalación recién arrancada ya trae todos los prompts sembrados: no hay que escribir nada
  para empezar.

**Qué NO va aquí**: la materia, los criterios del departamento y las particularidades de cada
actividad van en **Contextos** (paso 7). La regla práctica: si lo escribiría un profesor de la
academia, es contexto; si describe el procedimiento del motor, es prompt.

## 7. Contextos (la materia y el criterio)

Pantalla **Contextos**. Cinco niveles, de lo general a lo particular, que se concatenan en cada
corrección:

| Nivel | Quién lo edita | Para qué |
|---|---|---|
| Global | Administración | Perfil de la academia, convenciones de notación y de corrección |
| Tipo de actividad | Administración | Lo que vale para toda entrega o para todo foro |
| Plantilla | Profesorado | Lo común a una familia de actividades (simulacro de problema, de tema…) |
| Curso | Profesorado del curso | Particularidades del grupo |
| Actividad | Profesorado del curso | El criterio concreto de ese simulacro o ese hilo |

El contexto de una actividad se edita también desde su propia ficha, junto con la **solución de
referencia** y los **ficheros de contexto** (enunciado en `.tex` o `.md`). La pantalla «contexto
efectivo» enseña exactamente lo que se enviará al modelo, ya combinado.

## 8. Actividades

Pantalla **Actividades** → «Buscar en Moodle» para importar. En la ficha de cada actividad:

- **Actividad activa**: sólo las activas entran en los procesos de corrección.
- **Se puntúa** y **nota máxima**: si se apaga, Vega produce sólo feedback cualitativo.
- **Reparto de puntos**: los apartados y su valor. Los criterios finos de corrección no van aquí,
  sino en el contexto de la actividad.
- **Solución de referencia**: contra lo que se corrige (o el material del hilo, en un foro).

## 9. Probar el circuito completo

1. Con el proveedor **simulado**, fuerza un proceso desde **Procesos** y revisa una entrega en la
   **Cola**: transcripción, corrección por apartados, citas y avisos de revisión.
2. Cambia el proveedor a **Anthropic** (paso 2) y repite con una entrega real.
3. En **Registro de IA** (menú de administración) queda cada llamada: modelo, prompt y versión,
   tokens, coste y errores. Es la pantalla que hay que exportar cuando algo se comporte raro y
   haya que depurarlo fuera.

## Qué queda fuera (esta iteración)

- **Publicar en Moodle**: el circuito termina en la validación del profesor; la publicación de
  correcciones al alumno no está conectada todavía.
- **Programaciones didácticas**: el prompt existe, la funcionalidad no.
