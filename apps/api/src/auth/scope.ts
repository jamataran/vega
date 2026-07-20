import { eq, inArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { schema } from '../db/client.js';
import { forbidden } from '../http/errors.js';
import type { AppContext } from '../context.js';
import type { TokenPayload } from './plugin.js';

/**
 * Qué actividades alcanza cada usuario.
 *
 * Moodle ya impide que un profesor **descubra o importe** lo que no es suyo: el
 * token es personal y `core_enrol_get_users_courses` sólo devuelve sus cursos.
 * Pero una vez la actividad está dentro de Vega esa frontera desaparecía, y con
 * ella la de las entregas — que llevan trabajo de alumnos concretos. Este
 * módulo la vuelve a poner, en un único sitio, para que ninguna ruta se olvide.
 *
 * El alcance es **por curso**, no por quién importó la actividad: en un curso
 * co-impartido, atarlo al que pulsó el botón dejaría al otro profesor sin ver
 * media asignatura.
 *
 * Un administrador lo ve todo. No es un atajo: es quien da de alta al
 * profesorado, quien publica lo que se queda sin dueño y quien tiene que poder
 * mirar cualquier corrección cuando alguien reclama una nota.
 */

/** Un administrador no se filtra por nada. */
export function seesEverything(user: TokenPayload): boolean {
  return user.role === 'admin';
}

/**
 * Condición SQL para las consultas que parten de `activities`.
 *
 * Devuelve `undefined` cuando no hay nada que filtrar, que es lo que esperan
 * los `where` construidos con `and(...)`.
 */
export function activityScope(user: TokenPayload): SQL | undefined {
  if (seesEverything(user)) return undefined;

  // El `imported_by` no es redundante con el curso: cubre las actividades
  // anteriores a que existieran los cursos —las que la 0003 dejó colgando de un
  // curso heredado— y las que se importaron antes de que el profesor volviera a
  // listar sus cursos. Quien dio de alta una actividad no debe perderla de
  // vista nunca.
  return or(
    eq(schema.activities.importedBy, user.sub),
    sql`${schema.activities.courseId} IN (
      SELECT course_id FROM course_teachers WHERE user_id = ${user.sub}
    )`,
  );
}

/** Ídem para consultas que parten de `submissions` y no unen `activities`. */
export function submissionScope(user: TokenPayload): SQL | undefined {
  if (seesEverything(user)) return undefined;

  return sql`${schema.submissions.activityId} IN (
    SELECT a.id FROM activities a
    WHERE a.imported_by = ${user.sub}
       OR a.course_id IN (SELECT course_id FROM course_teachers WHERE user_id = ${user.sub})
  )`;
}

/**
 * Comprueba el acceso a una actividad concreta.
 *
 * Devuelve 403 y no 404: dentro de una academia, decirle a un profesor que la
 * actividad existe pero es de otro le ahorra pensar que ha perdido su trabajo,
 * y no revela nada que no supiera ya —comparten claustro y comparten Moodle.
 */
export async function assertActivityAccess(
  ctx: AppContext,
  user: TokenPayload,
  activityId: string,
): Promise<void> {
  if (seesEverything(user)) return;

  const [row] = await ctx.db
    .select({ importedBy: schema.activities.importedBy, courseId: schema.activities.courseId })
    .from(schema.activities)
    .where(eq(schema.activities.id, activityId))
    .limit(1);
  if (!row) return; // Que no exista lo resuelve la ruta con su 404.

  if (row.importedBy === user.sub) return;

  if (row.courseId !== null) {
    const [access] = await ctx.db
      .select({ userId: schema.courseTeachers.userId })
      .from(schema.courseTeachers)
      .where(
        sql`${schema.courseTeachers.courseId} = ${row.courseId} AND ${schema.courseTeachers.userId} = ${user.sub}`,
      )
      .limit(1);
    if (access) return;
  }

  throw forbidden(
    'Esa actividad es de otro curso. Sólo la ve el profesorado que lo imparte y la administración.',
  );
}

/**
 * Registra a qué cursos alcanza un profesor.
 *
 * Se llama al listar cursos desde Moodle, que es el único momento en que
 * sabemos la verdad. No se borra lo que ya no aparece: si Moodle se cae o el
 * token caduca, el profesor tiene que seguir pudiendo revisar y validar lo que
 * ya está en Vega. Quitar a alguien de un curso se hace dando de baja al
 * usuario, no dejando de verlo un día.
 */
export async function recordCourseAccess(
  ctx: AppContext,
  userId: string,
  courseIds: readonly string[],
): Promise<void> {
  if (courseIds.length === 0) return;

  await ctx.db
    .insert(schema.courseTeachers)
    .values(courseIds.map((courseId) => ({ courseId, userId })))
    .onConflictDoUpdate({
      target: [schema.courseTeachers.courseId, schema.courseTeachers.userId],
      set: { seenAt: new Date() },
    });
}

/** Ids de las actividades que el usuario alcanza. Para agregados del panel. */
export async function visibleActivityIds(
  ctx: AppContext,
  user: TokenPayload,
): Promise<string[] | null> {
  if (seesEverything(user)) return null;

  const rows = await ctx.db
    .select({ id: schema.activities.id })
    .from(schema.activities)
    .where(activityScope(user));
  return rows.map((row) => row.id);
}

/** Azúcar para los `where` que ya tienen otras condiciones. */
export function scopedIn<T extends { id: unknown }>(
  ids: string[] | null,
  column: T['id'],
): SQL | undefined {
  return ids === null ? undefined : inArray(column as never, ids);
}
