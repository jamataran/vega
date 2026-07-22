import { and, count, desc, eq, isNotNull, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  AiCallQuery,
  routes,
  type AiCallListResponse,
  type AiCallResponse,
} from '@vega/shared';
import { schema } from '../db/client.js';
import { toAiCall } from '../db/mappers.js';
import { notFound, parseOrThrow } from '../http/errors.js';
import type { AppContext } from '../context.js';

/** Registro operativo completo; deliberadamente sólo administración. */
export async function aiCallRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get(
    routes.aiCalls,
    { preHandler: app.requireRole('admin') },
    async (request): Promise<AiCallListResponse> => {
      const query = parseOrThrow(AiCallQuery, request.query, 'Los filtros del registro');
      const filters: SQL[] = [];
      if (query.submissionId) filters.push(eq(schema.aiCalls.submissionId, query.submissionId));
      if (query.batchRunId) filters.push(eq(schema.aiCalls.batchRunId, query.batchRunId));
      if (query.operation) filters.push(eq(schema.aiCalls.operation, query.operation));
      if (query.transport) filters.push(eq(schema.aiCalls.transport, query.transport));
      if (query.errorsOnly) filters.push(isNotNull(schema.aiCalls.error));
      const where = filters.length === 0 ? undefined : and(...filters);
      const [totalRow] = await ctx.db.select({ value: count() }).from(schema.aiCalls).where(where);
      const rows = await ctx.db
        .select()
        .from(schema.aiCalls)
        .where(where)
        .orderBy(desc(schema.aiCalls.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const total = totalRow?.value ?? 0;
      return {
        items: rows.map(toAiCall),
        meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    routes.aiCall(':id'),
    { preHandler: app.requireRole('admin') },
    async (request): Promise<AiCallResponse> => {
      const [row] = await ctx.db
        .select()
        .from(schema.aiCalls)
        .where(eq(schema.aiCalls.id, request.params.id))
        .limit(1);
      if (!row) throw notFound('No existe esa llamada de IA.');
      return { call: toAiCall(row) };
    },
  );
}
