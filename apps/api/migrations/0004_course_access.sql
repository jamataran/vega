-- 0004_course_access — quién ve qué.
--
-- Hasta ahora `GET /api/activities` devolvía **todas** las actividades a
-- cualquier usuario autenticado, y el `PATCH` dejaba a un profesor editar la
-- actividad de otro. Moodle ya impedía descubrir e importar lo ajeno —el token
-- es personal y sólo devuelve los cursos de su dueño—, pero una vez dentro de
-- Vega esa frontera desaparecía. Con ella desaparecía también la de las
-- entregas, que llevan trabajo de alumnos concretos: eso no es sólo un permiso
-- mal puesto, es un asunto de protección de datos.
--
-- El alcance se decide **por curso y no por quién importó la actividad**. En un
-- curso con dos profesores, atarlo a quien pulsó el botón haría que cada uno
-- viera media asignatura: el compañero que no importó no vería nada, aunque en
-- Moodle tenga exactamente el mismo acceso.

CREATE TABLE IF NOT EXISTS course_teachers (
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Cuándo se comprobó por última vez que su token veía este curso. No caduca
  -- el acceso: si Moodle deja de responder, el profesor debe seguir pudiendo
  -- revisar y validar lo que ya está en Vega.
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS course_teachers_user_idx ON course_teachers (user_id);

-- Las actividades que ya estaban dadas de alta antes de esta migración no
-- tienen registro de acceso: nadie había listado cursos todavía. Se lo damos a
-- quien las importó, para que no desaparezcan de su pantalla al desplegar.
-- Las que no tengan ni eso sólo las verá un administrador, hasta que el
-- profesor vuelva a listar sus cursos y se registre su acceso.
INSERT INTO course_teachers (course_id, user_id)
SELECT DISTINCT a.course_id, a.imported_by
FROM activities a
WHERE a.course_id IS NOT NULL AND a.imported_by IS NOT NULL
ON CONFLICT DO NOTHING;
