import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  LoginRequest,
  type LoginResponse,
  type MeResponse,
  type MoodleConnectionResponse,
  UpdateMoodleTokenRequest,
  routes,
} from '@vega/shared';
import { verifyPassword } from '../auth/password.js';
import { currentUser } from '../auth/plugin.js';
import { schema } from '../db/client.js';
import { toUser } from '../db/mappers.js';
import { parseOrThrow, unauthorized } from '../http/errors.js';
import { asHttpError, connectorForUser } from '../lms/factory.js';
import type { AppContext } from '../context.js';

/**
 * Titular de la comprobación.
 *
 * Nombrar las funciones que fallan —y no un «no se ha podido conectar»— es lo
 * que convierte el mensaje en algo accionable: son exactamente las que hay que
 * añadir al servicio web en Moodle.
 */
function summarize(failed: readonly { name: string }[], courseCount: number): string {
  if (failed.length === 1) {
    return `Moodle rechaza «${failed[0]!.name}». Añádela al servicio web del token en Moodle.`;
  }
  if (failed.length > 1) {
    return `Moodle rechaza estas funciones: ${failed
      .map((check) => check.name)
      .join(', ')}. Añádelas al servicio web del token en Moodle.`;
  }
  return courseCount === 0
    ? 'La conexión funciona, pero este token no está matriculado en ningún curso.'
    : 'Conexión correcta.';
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post(routes.login, async (request): Promise<LoginResponse> => {
    const body = parseOrThrow(LoginRequest, request.body, 'El formulario de acceso');

    const [row] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, body.email.toLowerCase().trim()))
      .limit(1);

    // Mismo mensaje para usuario inexistente y contraseña incorrecta: no damos
    // pistas sobre qué correos están dados de alta.
    const invalid = unauthorized('Correo o contraseña incorrectos.');
    if (!row || !row.active) {
      // Gastamos el tiempo de un hash igualmente para no filtrar por tiempo de respuesta.
      await verifyPassword(body.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      throw invalid;
    }
    if (!(await verifyPassword(body.password, row.passwordHash))) throw invalid;

    const user = toUser(row);
    const token = app.jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role });
    const { exp } = app.jwt.decode<{ exp: number }>(token) ?? { exp: 0 };

    await ctx.db
      .update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, user.id));

    return { token, expiresAt: new Date(exp * 1000).toISOString(), user };
  });

  app.get(routes.me, { preHandler: app.authenticate }, async (request): Promise<MeResponse> => {
    const session = currentUser(request);
    const [row] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.sub))
      .limit(1);

    // El token puede sobrevivir a la baja del usuario; comprobamos contra BD.
    if (!row || !row.active) throw unauthorized('Tu usuario ya no está activo.');
    return { user: toUser(row) };
  });

  /**
   * Token de Moodle del usuario en sesión.
   *
   * Cualquier rol, y sólo el suyo: no hay ruta para que un administrador ponga
   * el token de otro. Un token de Moodle es una credencial personal —da acceso
   * a los cursos de quien lo emitió— y quien lo pega debe ser su dueño.
   */
  app.put(
    routes.myMoodleToken,
    { preHandler: app.authenticate },
    async (request): Promise<MeResponse> => {
      const session = currentUser(request);
      const body = parseOrThrow(UpdateMoodleTokenRequest, request.body, 'El token de Moodle');

      const [row] = await ctx.db
        .update(schema.users)
        .set({
          moodleToken: body.token === null ? null : body.token.trim(),
          moodleTokenUpdatedAt: body.token === null ? null : new Date(),
        })
        .where(eq(schema.users.id, session.sub))
        .returning();

      if (!row) throw unauthorized('Tu usuario ya no está activo.');
      return { user: toUser(row) };
    },
  );

  /**
   * Prueba la conexión con el token guardado.
   *
   * Un token inválido **no es un error de esta ruta**: es su respuesta. Por eso
   * devuelve 200 con `ok: false` y un mensaje, en vez de un código de error —
   * el profesor está precisamente comprobando si funciona, y necesita leer por
   * qué no en el mismo sitio donde lo acaba de pegar.
   */
  app.post(
    routes.testMyMoodleConnection,
    { preHandler: app.authenticate },
    async (request): Promise<MoodleConnectionResponse> => {
      const session = currentUser(request);
      try {
        const connector = await connectorForUser(ctx, session.sub);
        const info = await connector.verifyConnection();
        const failed = info.checks.filter((check) => check.required && check.status === 'failed');
        return {
          ok: failed.length === 0,
          checks: [...info.checks],
          // El detalle de cada función va en `checks`; aquí sólo el titular, que
          // es lo que se lee primero y lo que decide si hay que seguir mirando.
          message: summarize(failed, info.courseCount),
          siteName: info.siteName,
          username: info.username,
          courseCount: info.courseCount,
        };
      } catch (error) {
        return {
          ok: false,
          message: asHttpError(error).message,
          siteName: null,
          username: null,
          courseCount: null,
          checks: [],
        };
      }
    },
  );
}
