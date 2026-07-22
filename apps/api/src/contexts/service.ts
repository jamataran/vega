import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ContextLevel, GradingContext } from '@vega/shared';
import { schema } from '../db/client.js';
import { toGradingContext } from '../db/mappers.js';
import { conflict } from '../http/errors.js';
import type { AppContext } from '../context.js';

export function contextContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const activeJoin = and(
  eq(schema.gradingContextVersions.contextId, schema.gradingContexts.id),
  eq(schema.gradingContextVersions.version, schema.gradingContexts.activeVersion),
);

export async function listActiveContexts(ctx: AppContext): Promise<GradingContext[]> {
  const rows = await ctx.db
    .select({ context: schema.gradingContexts, version: schema.gradingContextVersions })
    .from(schema.gradingContexts)
    .innerJoin(schema.gradingContextVersions, activeJoin)
    .orderBy(asc(schema.gradingContexts.level), asc(schema.gradingContexts.key));
  return rows.map(toGradingContext);
}

export async function readActiveContext(
  ctx: AppContext,
  level: ContextLevel,
  key: string,
): Promise<GradingContext | null> {
  const [row] = await ctx.db
    .select({ context: schema.gradingContexts, version: schema.gradingContextVersions })
    .from(schema.gradingContexts)
    .innerJoin(schema.gradingContextVersions, activeJoin)
    .where(and(eq(schema.gradingContexts.level, level), eq(schema.gradingContexts.key, key)))
    .limit(1);
  return row ? toGradingContext(row) : null;
}

/** Compatibilidad para consumidores que sólo necesitan el texto activo. */
export async function readContextLevel(
  ctx: AppContext,
  level: ContextLevel,
  key: string,
): Promise<string> {
  return (await readActiveContext(ctx, level, key))?.content ?? '';
}

export async function saveContextVersion(
  ctx: AppContext,
  input: {
    level: ContextLevel;
    key: string;
    content: string;
    expectedVersion: number;
    userId: string;
  },
): Promise<GradingContext> {
  const contentHash = contextContentHash(input.content);

  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.gradingContexts)
      .where(
        and(
          eq(schema.gradingContexts.level, input.level),
          eq(schema.gradingContexts.key, input.key),
        ),
      )
      .limit(1);

    if (!existing) {
      if (input.expectedVersion !== 1) {
        throw conflict('El contexto todavía no existe. Recarga la página antes de guardarlo.');
      }
      const id = randomUUID();
      const [context] = await tx
        .insert(schema.gradingContexts)
        .values({ id, level: input.level, key: input.key, activeVersion: 1 })
        .returning();
      const [version] = await tx
        .insert(schema.gradingContextVersions)
        .values({
          contextId: id,
          version: 1,
          content: input.content,
          contentHash,
          source: 'edit',
          createdBy: input.userId,
        })
        .returning();
      if (!context || !version) throw new Error('No se ha podido crear el contexto.');
      return toGradingContext({ context, version });
    }

    const nextVersion = input.expectedVersion + 1;
    const [updated] = await tx
      .update(schema.gradingContexts)
      .set({ activeVersion: nextVersion })
      .where(
        and(
          eq(schema.gradingContexts.id, existing.id),
          eq(schema.gradingContexts.activeVersion, input.expectedVersion),
        ),
      )
      .returning();

    if (!updated) {
      throw conflict('Este contexto ha cambiado desde que lo abriste. Recarga antes de guardar.');
    }

    const [version] = await tx
      .insert(schema.gradingContextVersions)
      .values({
        contextId: existing.id,
        version: nextVersion,
        content: input.content,
        contentHash,
        source: 'edit',
        createdBy: input.userId,
      })
      .returning();
    if (!version) throw new Error('No se ha podido versionar el contexto.');
    return toGradingContext({ context: updated, version });
  });
}

/** Consulta de auditoría interna: nunca se expone en una ruta HTTP. */
export const INACTIVE_CONTEXT_VERSIONS_SQL = sql`
  SELECT c.level, c.key, v.version, v.source, v.created_at,
         u.email AS created_by, v.content
    FROM grading_contexts AS c
    JOIN grading_context_versions AS v ON v.context_id = c.id
    LEFT JOIN users AS u ON u.id = v.created_by
   WHERE v.version <> c.active_version
   ORDER BY c.level, c.key, v.version DESC
`;
