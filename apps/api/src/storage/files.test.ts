import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileStore, safeFilename } from './files.js';

/**
 * El nombre del fichero lo elige el alumno desde Moodle, así que llega como
 * dato hostil. Estas pruebas fijan que ningún nombre pueda escribir fuera del
 * almacén: es la única superficie de la ingesta con consecuencias más allá de
 * una entrega mal corregida.
 */

test('el nombre se reduce a lo que es seguro escribir', () => {
  assert.equal(safeFilename('examen final.pdf'), 'examen-final.pdf');
  assert.equal(safeFilename('Análisis_2ª evaluación.pdf'), 'An-lisis_2-evaluaci-n.pdf');
});

test('una ruta en el nombre se queda en su última parte', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('C:\\Users\\ana\\examen.pdf'), 'examen.pdf');
  assert.equal(safeFilename('/etc/shadow'), 'shadow');
});

test('un nombre que se queda en nada tiene respaldo', () => {
  assert.equal(safeFilename('...'), 'entrega.bin');
  assert.equal(safeFilename(''), 'entrega.bin');
  assert.equal(safeFilename('///'), 'entrega.bin');
});

test('un nombre desmesurado se recorta', () => {
  assert.ok(safeFilename(`${'a'.repeat(500)}.pdf`).length <= 120);
});

test('la ruta de una entrega cuelga del almacén y de su identificador', () => {
  const store = new FileStore('/tmp/vega-almacen');
  const absolute = store.absolutePathOf('submissions/abc/examen.pdf');

  assert.equal(absolute, '/tmp/vega-almacen/submissions/abc/examen.pdf');
});

test('una ruta guardada no puede salirse del almacén', () => {
  const store = new FileStore('/tmp/vega-almacen');

  assert.throws(() => store.absolutePathOf('../../etc/passwd'), /se sale del almacén/);
  assert.throws(() => store.absolutePathOf('/etc/passwd'), /es absoluta/);
});
