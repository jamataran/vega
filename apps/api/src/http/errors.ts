import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { ApiError } from '@vega/shared';

type ErrorCode = ApiError['error']['code'];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  INTERNAL: 500,
};

/** Error de dominio que el manejador global sabe convertir en respuesta HTTP. */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError('BAD_REQUEST', message, fields);
export const unauthorized = (message = 'Necesitas iniciar sesión.') => new HttpError('UNAUTHORIZED', message);
export const forbidden = (message = 'No tienes permisos para esta operación.') =>
  new HttpError('FORBIDDEN', message);
export const notFound = (message = 'No se ha encontrado el recurso.') => new HttpError('NOT_FOUND', message);
export const conflict = (message: string) => new HttpError('CONFLICT', message);
export const unprocessable = (message: string, fields?: Record<string, string>) =>
  new HttpError('UNPROCESSABLE', message, fields);

/** Aplana los errores de Zod a `{ campo: mensaje }` para que el front los pinte junto al input. */
function fieldsFromZod(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    fields[path] ??= issue.message;
  }
  return fields;
}

/** Valida cuerpo/query/params y lanza un `HttpError` con el detalle por campo. */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, value: unknown, what = 'La petición'): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw unprocessable(`${what} no es válida.`, fieldsFromZod(result.error));
  }
  return result.data;
}

export function registerErrorHandler(app: {
  setErrorHandler: (fn: (error: Error, request: FastifyRequest, reply: FastifyReply) => void) => void;
  setNotFoundHandler: (fn: (request: FastifyRequest, reply: FastifyReply) => void) => void;
  log: { error: (obj: unknown, msg?: string) => void };
}): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(notFound(`No existe la ruta ${request.method} ${request.url}.`).toBody());
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      void reply.status(error.status).send(error.toBody());
      return;
    }

    if (error instanceof ZodError) {
      void reply.status(422).send(unprocessable('Datos no válidos.', fieldsFromZod(error)).toBody());
      return;
    }

    // @fastify/jwt marca sus errores con códigos propios.
    const code = (error as { code?: string }).code ?? '';
    if (code.startsWith('FST_JWT')) {
      void reply.status(401).send(unauthorized('Sesión no válida o caducada.').toBody());
      return;
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      void reply.status(statusCode).send(new HttpError('BAD_REQUEST', error.message).toBody());
      return;
    }

    app.log.error({ err: error, url: request.url }, 'Error no controlado');
    void reply
      .status(500)
      .send(new HttpError('INTERNAL', 'Ha ocurrido un error inesperado.').toBody());
  });
}
