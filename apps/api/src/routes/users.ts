import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CreateUserRequest,
  type MoodleConnectionResponse,
  UpdateMoodleTokenRequest,
  UpdateUserRequest,
  type UserListResponse,
  type UserResponse,
  routes,
} from '@vega/shared';
import { hashPassword } from '../auth/password.js';
import { currentUser } from '../auth/plugin.js';
import { schema } from '../db/client.js';
import { toUser } from '../db/mappers.js';
import { badRequest, conflict, notFound, parseOrThrow } from '../http/errors.js';
import { asHttpError, connectorForUser } from '../lms/factory.js';
import type { AppContext } from '../context.js';

export async function userRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;
  const adminOnly = app.requireRole('admin');

  app.get(routes.users, { preHandler: adminOnly }, async (): Promise<UserListResponse> => {
    const rows = await db.select().from(schema.users).orderBy(asc(schema.users.name));
    return { items: rows.map(toUser) };
  });

  app.post(routes.users, { preHandler: adminOnly }, async (request, reply): Promise<UserResponse> => {
    const body = parseOrThrow(CreateUserRequest, request.body, 'El usuario');
    const email = body.email.toLowerCase().trim();

    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing) throw conflict('Ya existe un usuario con ese correo.');

    const [row] = await db
      .insert(schema.users)
      .values({
        email,
        name: body.name,
        role: body.role,
        passwordHash: await hashPassword(body.password),
      })
      .returning();
    if (!row) throw badRequest('No se ha podido crear el usuario.');

    void reply.status(201);
    return { user: toUser(row) };
  });

  app.patch<{ Params: { id: string } }>(
    routes.user(':id'),
    { preHandler: adminOnly },
    async (request): Promise<UserResponse> => {
      const body = parseOrThrow(UpdateUserRequest, request.body, 'El usuario');
      const session = currentUser(request);
      const targetId = request.params.id;

      // Salvaguarda contra dejarse fuera del sistema uno mismo.
      if (targetId === session.sub) {
        if (body.active === false) throw badRequest('No puedes desactivar tu propio usuario.');
        if (body.role && body.role !== 'admin') throw badRequest('No puedes quitarte a ti mismo el rol de administrador.');
      }

      const patch = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.password !== undefined ? { passwordHash: await hashPassword(body.password) } : {}),
      };

      const [row] = await db.update(schema.users).set(patch).where(eq(schema.users.id, targetId)).returning();
      if (!row) throw notFound('No existe ese usuario.');
      return { user: toUser(row) };
    },
  );

  /**
   * Token de Moodle de otro usuario.
   *
   * En Moodle un administrador puede emitir un token a nombre de cualquiera, y
   * en la práctica es así como se despliega esto: pedirle a cada profesor que
   * navegue hasta sus claves de seguridad es donde se atasca la instalación.
   * Se **escribe y no se lee**: el valor no sale por ninguna ruta, tampoco para
   * quien lo acaba de guardar.
   */
  app.put<{ Params: { id: string } }>(
    routes.userMoodleToken(':id'),
    { preHandler: adminOnly },
    async (request): Promise<UserResponse> => {
      const body = parseOrThrow(UpdateMoodleTokenRequest, request.body, 'El token de Moodle');

      const [row] = await db
        .update(schema.users)
        .set({
          moodleToken: body.token === null ? null : body.token.trim(),
          moodleTokenUpdatedAt: body.token === null ? null : new Date(),
        })
        .where(eq(schema.users.id, request.params.id))
        .returning();
      if (!row) throw notFound('No existe ese usuario.');
      return { user: toUser(row) };
    },
  );

  /**
   * Prueba el token de otro usuario contra Moodle.
   *
   * Un token mal pegado no da la cara hasta que su dueño intenta importar algo,
   * y para entonces el administrador ya no está delante. Como en la ruta
   * equivalente del propio usuario, el fallo viaja en el cuerpo con `ok: false`:
   * es la respuesta de la comprobación, no un error de la petición.
   */
  app.post<{ Params: { id: string } }>(
    routes.testUserMoodleConnection(':id'),
    { preHandler: adminOnly },
    async (request): Promise<MoodleConnectionResponse> => {
      const [row] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, request.params.id))
        .limit(1);
      if (!row) throw notFound('No existe ese usuario.');

      try {
        const connector = await connectorForUser(ctx, row.id);
        const info = await connector.verifyConnection();
        return {
          ok: true,
          message:
            info.courseCount === 0
              ? 'El token es válido pero no ve ningún curso. Revisa en Moodle las funciones habilitadas y en qué cursos está matriculado.'
              : 'Conexión correcta.',
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
        };
      }
    },
  );
}
