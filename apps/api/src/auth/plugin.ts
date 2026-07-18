import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@vega/shared';
import { forbidden, unauthorized } from '../http/errors.js';
import type { Config } from '../config.js';

/** Contenido del JWT. Deliberadamente mínimo: lo justo para autorizar sin ir a BD. */
export interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Exige sesión válida. Deja el usuario en `request.currentUser`. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Exige sesión válida *y* uno de los roles indicados. */
    requireRole: (
      ...roles: UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    currentUser?: TokenPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

export async function registerAuth(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });

  app.decorateRequest('currentUser', undefined);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify<TokenPayload>();
      request.currentUser = payload;
    } catch {
      throw unauthorized('Sesión no válida o caducada.');
    }
  });

  app.decorate(
    'requireRole',
    (...roles: UserRole[]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        await app.authenticate(request, reply);
        const role = request.currentUser?.role;
        if (!role || !roles.includes(role)) {
          throw forbidden('Esta sección es sólo para administradores.');
        }
      },
  );
}

/** Lee el usuario autenticado; lanza si el `preHandler` de auth no se ejecutó. */
export function currentUser(request: FastifyRequest): TokenPayload {
  if (!request.currentUser) throw unauthorized();
  return request.currentUser;
}
