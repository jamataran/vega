import assert from 'node:assert/strict';
import test from 'node:test';
import { needsFile, type IngestedRow } from './run.js';

/**
 * A qué entrega le trae la ingesta el fichero.
 *
 * Esta decisión nació de un fallo real: la primera ingesta contra un Moodle de
 * verdad registró 101 entregas y no pudo guardar ni un PDF (el volumen del
 * contenedor no era escribible). Como sólo se descargaba lo recién insertado,
 * esas 101 se quedaban sin fichero **para siempre**: la pasada siguiente veía
 * que la fila ya existía y pasaba de largo. Reintentarlo no es opcional, y
 * decidir a cuáles se les reintenta es justo lo que se prueba aquí.
 */

const row = (over: Partial<IngestedRow>): IngestedRow => ({
  id: 'una-entrega',
  created: false,
  storagePath: null,
  status: 'pending',
  ...over,
});

test('una entrega registrada sin fichero se reintenta, aunque no sea nueva', () => {
  assert.equal(needsFile(row({ created: false, storagePath: null, status: 'pending' })), true);
});

test('una que falló al descargarse se reintenta: el fallo pudo ser pasajero', () => {
  assert.equal(needsFile(row({ status: 'error' })), true);
});

test('la que ya tiene su fichero no se vuelve a bajar', () => {
  // Sin este corte, cada pasada se descargaría el examen entero de toda la
  // clase para tirarlo acto seguido.
  assert.equal(needsFile(row({ storagePath: 'submissions/abc/p1.pdf' })), false);
});

test('una entrega aparcada no se resucita sola', () => {
  // La apartó una persona a propósito; la ingesta no le lleva la contraria.
  assert.equal(needsFile(row({ status: 'parked' })), false);
});

test('lo ya corregido o publicado no se toca', () => {
  for (const status of ['graded', 'validated', 'published']) {
    assert.equal(needsFile(row({ status })), false, status);
  }
});
