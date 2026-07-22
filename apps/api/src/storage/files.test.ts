import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// ── Que el almacén sea escribible se comprueba escribiendo ──────────────────
//
// Un despliegue con el volumen montado con otro dueño registró un centenar de
// entregas y no guardó ni un PDF. Mirar permisos no lo habría detectado: hay
// que intentar la escritura con el usuario que corre el proceso.

test('un almacén escribible se declara escribible y no deja rastro', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vega-almacen-'));
  try {
    const resultado = await new FileStore(root).checkWritable();

    assert.deepEqual(resultado, { writable: true });
    // La sonda se borra: el almacén queda como estaba.
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('un almacén sin permiso de escritura lo dice, con el motivo', async () => {
  const padre = await mkdtemp(join(tmpdir(), 'vega-almacen-'));
  const root = join(padre, 'entregas-recibidas');
  try {
    // Un directorio de sólo lectura reproduce el volumen montado como root: el
    // proceso no puede crear nada dentro.
    await chmod(padre, 0o500);
    const resultado = await new FileStore(root).checkWritable();

    assert.equal(resultado.writable, false);
    // El motivo viaja hasta el log y la pantalla de estado; sin él, «no se
    // puede escribir» no le dice a nadie qué arreglar.
    assert.ok('reason' in resultado && resultado.reason.length > 0);
  } finally {
    await chmod(padre, 0o700);
    await rm(padre, { recursive: true, force: true });
  }
});
