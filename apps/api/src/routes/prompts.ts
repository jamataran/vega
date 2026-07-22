import type { FastifyInstance } from 'fastify';
import {
  UpdatePromptRequest,
  routes,
  type PromptListResponse,
  type PromptResponse,
} from '@vega/shared';
import { currentUser } from '../auth/plugin.js';
import { parseOrThrow } from '../http/errors.js';
import {
  listActivePrompts,
  readPromptWithPrevious,
  restorePromptDefault,
  savePromptVersion,
} from '../prompts/service.js';
import type { AppContext } from '../context.js';

export async function promptRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get(
    routes.prompts,
    { preHandler: app.requireRole('admin') },
    async (): Promise<PromptListResponse> => ({ items: await listActivePrompts(ctx) }),
  );

  app.put<{ Params: { key: string } }>(
    '/api/prompts/:key',
    { preHandler: app.requireRole('admin') },
    async (request): Promise<PromptResponse> => {
      const body = parseOrThrow(UpdatePromptRequest, request.body, 'El prompt');
      const saved = await savePromptVersion(ctx, {
          key: request.params.key,
          content: body.content,
          expectedVersion: body.expectedVersion,
          userId: currentUser(request).sub,
        });
      const prompt = await readPromptWithPrevious(ctx, saved.key);
      if (!prompt) throw new Error('No se ha podido leer el prompt guardado.');
      return { prompt };
    },
  );

  app.post<{ Params: { key: string } }>(
    '/api/prompts/:key/restore',
    { preHandler: app.requireRole('admin') },
    async (request): Promise<PromptResponse> => {
      const body = parseOrThrow(
        UpdatePromptRequest.pick({ expectedVersion: true }),
        request.body,
        'La restauración',
      );
      const saved = await restorePromptDefault(
          ctx,
          request.params.key,
          body.expectedVersion,
          currentUser(request).sub,
        );
      const prompt = await readPromptWithPrevious(ctx, saved.key);
      if (!prompt) throw new Error('No se ha podido leer el prompt restaurado.');
      return { prompt };
    },
  );
}
