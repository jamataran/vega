import { and, asc, desc, eq } from 'drizzle-orm';
import type { Prompt, PromptWithPrevious } from '@vega/shared';
import { schema } from '../db/client.js';
import type { Database } from '../db/client.js';
import { toPrompt } from '../db/mappers.js';
import { conflict, notFound } from '../http/errors.js';
import type { AppContext } from '../context.js';
import { PROMPT_SEED_CONTENT } from './seeds.js';

/**
 * La base de datos es la única fuente de verdad de los prompts en ejecución.
 * Las semillas embebidas en `seeds.ts` sólo aportan la v1 de una instalación
 * nueva y el texto de «Restaurar valor predeterminado».
 */
export const PROMPT_KEYS = Object.keys(PROMPT_SEED_CONTENT);

export function readPromptSeed(key: string): string {
  const content = PROMPT_SEED_CONTENT[key];
  if (content === undefined) throw notFound('No existe un valor predeterminado para ese prompt.');
  return content;
}

export async function seedPrompts(
  db: Database,
  log: (line: string) => void = () => {},
): Promise<void> {
  let inserted = 0;
  for (const key of PROMPT_KEYS) {
    const rows = await db
      .insert(schema.prompts)
      .values({ key, version: 1, content: readPromptSeed(key), active: true })
      .onConflictDoNothing()
      .returning({ key: schema.prompts.key });
    inserted += rows.length;
  }
  if (inserted > 0) log(`→ prompts del sistema sembrados: ${inserted}`);
}

async function withPrevious(ctx: AppContext, prompt: Prompt): Promise<PromptWithPrevious> {
  const [previous] = await ctx.db
    .select({ content: schema.prompts.content })
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.key, prompt.key),
        eq(schema.prompts.version, prompt.version - 1),
      ),
    )
    .limit(1);
  return { ...prompt, previousContent: previous?.content ?? null };
}

export async function listActivePrompts(ctx: AppContext): Promise<PromptWithPrevious[]> {
  const rows = await ctx.db
    .select()
    .from(schema.prompts)
    .where(eq(schema.prompts.active, true))
    .orderBy(asc(schema.prompts.key));
  return Promise.all(rows.map((row) => withPrevious(ctx, toPrompt(row))));
}

export async function readActivePrompt(ctx: AppContext, key: string): Promise<Prompt | null> {
  const [row] = await ctx.db
    .select()
    .from(schema.prompts)
    .where(and(eq(schema.prompts.key, key), eq(schema.prompts.active, true)))
    .orderBy(desc(schema.prompts.version))
    .limit(1);
  return row ? toPrompt(row) : null;
}

export async function readPromptWithPrevious(
  ctx: AppContext,
  key: string,
): Promise<PromptWithPrevious | null> {
  const prompt = await readActivePrompt(ctx, key);
  return prompt ? withPrevious(ctx, prompt) : null;
}

export async function savePromptVersion(
  ctx: AppContext,
  input: { key: string; content: string; expectedVersion: number; userId: string },
): Promise<Prompt> {
  return ctx.db.transaction(async (tx) => {
    const [deactivated] = await tx
      .update(schema.prompts)
      .set({ active: false })
      .where(
        and(
          eq(schema.prompts.key, input.key),
          eq(schema.prompts.version, input.expectedVersion),
          eq(schema.prompts.active, true),
        ),
      )
      .returning({ version: schema.prompts.version });
    if (!deactivated) {
      throw conflict('Este prompt ha cambiado desde que lo abriste. Recarga antes de guardar.');
    }

    const [row] = await tx
      .insert(schema.prompts)
      .values({
        key: input.key,
        version: input.expectedVersion + 1,
        content: input.content,
        active: true,
        updatedBy: input.userId,
      })
      .returning();
    if (!row) throw new Error('No se ha podido crear la nueva versión del prompt.');
    return toPrompt(row);
  });
}

export async function restorePromptDefault(
  ctx: AppContext,
  key: string,
  expectedVersion: number,
  userId: string,
): Promise<Prompt> {
  return savePromptVersion(ctx, {
    key,
    content: readPromptSeed(key),
    expectedVersion,
    userId,
  });
}
