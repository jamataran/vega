import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulatedPdf } from '@vega/connector-lms';
import { countPages } from './pages.js';

/**
 * Contar páginas al ingerir es lo que decide cuánto cuesta transcribir una
 * entrega y lo que detecta un fichero inservible **antes** de que llegue al
 * motor. Los dos caminos que importan son el feliz y el de «esto no se abre»:
 * el segundo tiene que dejar la entrega registrada, no descartarla.
 */

test('un PDF válido devuelve su número de páginas', async () => {
  const result = await countPages(simulatedPdf(4, 'prueba'), 'application/pdf', 'examen.pdf');

  assert.equal(result.pages, 4);
  assert.equal(result.failure, null);
  assert.equal(result.message, null);
});

test('una imagen suelta cuenta como una página', async () => {
  const result = await countPages(new Uint8Array([1, 2, 3]), 'image/png', 'folio.png');

  assert.equal(result.pages, 1);
  assert.equal(result.failure, null);
});

test('un fichero vacío no se puede corregir y se dice por qué', async () => {
  const result = await countPages(new Uint8Array(), 'application/pdf', 'examen.pdf');

  assert.equal(result.failure, 'empty');
  assert.match(result.message ?? '', /vacío/);
});

test('un formato que Vega no lee se rechaza nombrándolo', async () => {
  const result = await countPages(
    new TextEncoder().encode('PK...'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'memoria.docx',
  );

  assert.equal(result.failure, 'unsupported');
  assert.match(result.message ?? '', /sólo sabe leer PDF e imágenes/);
});

test('un PDF corrupto no revienta la ingesta: devuelve el motivo', async () => {
  const result = await countPages(
    new TextEncoder().encode('%PDF-1.4 esto no es un PDF de verdad'),
    'application/pdf',
    'examen.pdf',
  );

  assert.equal(result.pages, 0);
  assert.equal(result.failure, 'not-a-pdf');
  assert.match(result.message ?? '', /No se ha podido leer el PDF/);
});

test('el tipo MIME con parámetros sigue reconociéndose', async () => {
  const result = await countPages(simulatedPdf(1, 'x'), 'application/pdf; charset=binary', 'a.pdf');

  assert.equal(result.pages, 1);
  assert.equal(result.failure, null);
});
