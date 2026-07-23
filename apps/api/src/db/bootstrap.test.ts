import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadContextSeedRows } from './bootstrap.js';

const REPO_CONTEXTS = join(dirname(fileURLToPath(import.meta.url)), '../../../..', 'contexts');

test('la imagen dispone de todos los contextos necesarios para una instalación nueva', async () => {
  const rows = await loadContextSeedRows([REPO_CONTEXTS]);

  assert.deepEqual(
    rows.map(({ level, key }) => `${level}:${key}`),
    [
      'global:global',
      'activity_kind:assignment',
      'activity_kind:forum',
      'template:simulacro-problema',
      'template:simulacro-tema',
    ],
  );
  assert.ok(rows.every(({ content }) => content.trim().length > 0));
});

test('el arranque falla de forma explícita si el paquete pierde los contextos', async () => {
  await assert.rejects(
    loadContextSeedRows([join(REPO_CONTEXTS, 'no-existe')]),
    /No se ha encontrado el contexto obligatorio installation\.md/,
  );
});
