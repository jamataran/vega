import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CreateUserRequest,
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
}
