import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Prompt, PromptWithPrevious } from '@vega/shared';
import { schema } from '../db/client.js';
import type { Database } from '../db/client.js';
import { toPrompt } from '../db/mappers.js';
import { conflict, notFound } from '../http/errors.js';
import type { AppContext } from '../context.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

export const PROMPT_SEEDS = [
  ['transcription.system', 'transcripcion.md'],
  ['grading.problem.system', 'entrega-problema.md'],
  ['grading.topic.system', 'entrega-tema.md'],
  ['triage.system', 'clasificador-dudas.md'],
  ['forum.answer.simple.system', 'duda-sencilla.md'],
  ['forum.answer.expert.system', 'duda-dificil.md'],
  ['verify.system', 'verificador.md'],
  ['pd.regulation.system', 'pd-normativa.md'],
] as const;

export async function readPromptSeed(key: string): Promise<string> {
  const entry = PROMPT_SEEDS.find(([candidate]) => candidate === key);
  if (!entry) throw notFound('No existe un valor predeterminado para ese prompt.');
  return readFile(join(REPO_ROOT, 'prompts', entry[1]), 'utf8');
}

export async function seedPrompts(
  db: Database,
  log: (line: string) => void = () => {},
): Promise<void> {
  let inserted = 0;
  for (const [key] of PROMPT_SEEDS) {
    const content = await readPromptSeed(key);
    const rows = await db
      .insert(schema.prompts)
      .values({ key, version: 1, content, active: true })
      .onConflictDoNothing()
      .returning({ key: schema.prompts.key });
    inserted += rows.length;
  }
  if (inserted > 0) log(`→ prompts del sistema sembrados desde prompts/: ${inserted}`);
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
    content: await readPromptSeed(key),
    expectedVersion,
    userId,
  });
}
