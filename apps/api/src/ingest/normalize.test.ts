import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { normalizeForEngine, pdftoppmAvailable } from './normalize.js';

const run = promisify(execFile);

/**
 * Estas pruebas necesitan `pdftoppm` de verdad: lo que se comprueba es la
 * interacción con el binario, no una imitación suya. La CI lo instala; en una
 * máquina sin poppler se saltan con motivo en lugar de fallar.
 */
const hayPoppler = await pdftoppmAvailable();
const saltar = { skip: hayPoppler ? false : 'pdftoppm no está en el PATH' };

/** Un PDF vectorial: pesa poco y rasterizarlo lo engorda. */
async function vectorial(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let p = 0; p < paginas; p += 1) {
    const page = doc.addPage([595.28, 841.89]);
    for (let i = 0; i < 800; i += 1) {
      page.drawText('x', { x: (i * 17) % 540, y: (i * 29) % 780, size: 8 });
    }
  }
  return doc.save();
}

/** Un «escaneo de móvil»: páginas que son fotos grandes. */
async function escaneoPesado(paginas: number): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'vega-fixture-'));
  try {
    await writeFile(join(dir, 'v.pdf'), await vectorial(paginas));
    await run('pdftoppm', ['-r', '400', '-jpeg', '-jpegopt', 'quality=95', join(dir, 'v.pdf'), join(dir, 'p')]);
    const doc = await PDFDocument.create();
    const jpgs = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
    for (const nombre of jpgs) {
      const img = await doc.embedJpg(await readFile(join(dir, nombre)));
      doc.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    return doc.save();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('un escaneo pesado se reduce y conserva todas sus páginas', saltar, async () => {
  const original = await escaneoPesado(3);
  const resultado = await normalizeForEngine(original, 'application/pdf');

  assert.notEqual(resultado, null, 'un escaneo pesado sí se debe normalizar');
  assert.equal(resultado?.pages, 3);
  assert.ok(
    resultado !== null && resultado.bytes.byteLength < original.byteLength / 2,
    `esperaba menos de la mitad y ha salido ${resultado?.bytes.byteLength} de ${original.byteLength}`,
  );
  // El PDF resultante tiene que ser legible y tener las mismas páginas: la
  // numeración atraviesa el manifiesto, las citas y el visor.
  assert.equal((await PDFDocument.load(resultado!.bytes)).getPageCount(), 3);
});

test('un PDF vectorial ligero no se toca: rasterizarlo lo empeoraría', saltar, async () => {
  const original = await vectorial(3);
  const avisos: string[] = [];
  const resultado = await normalizeForEngine(original, 'application/pdf', {
    onWarn: (mensaje) => avisos.push(mensaje),
  });

  assert.equal(resultado, null, 'no debe devolver algo más gordo que el original');
  assert.match(avisos.join(' '), /no reduce el original/);
});

test('una imagen suelta se envuelve en un PDF de una página', saltar, async () => {
  // Se fabrica un JPEG de verdad con poppler, no un buffer inventado.
  const dir = await mkdtemp(join(tmpdir(), 'vega-fixture-'));
  try {
    await writeFile(join(dir, 'v.pdf'), await vectorial(1));
    await run('pdftoppm', ['-r', '300', '-jpeg', join(dir, 'v.pdf'), join(dir, 'p')]);
    const nombre = (await readdir(dir)).find((f) => f.endsWith('.jpg'));
    assert.ok(nombre !== undefined, 'poppler debía producir un JPEG');
    const jpeg = await readFile(join(dir, nombre));

    const resultado = await normalizeForEngine(jpeg, 'image/jpeg');
    // Puede devolver `null` si el JPEG ya era pequeño y rasterizarlo no reduce;
    // lo que no puede es inventarse páginas.
    if (resultado !== null) {
      assert.equal(resultado.pages, 1);
      assert.equal((await PDFDocument.load(resultado.bytes)).getPageCount(), 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('un fichero que no es un PDF no lanza: devuelve null y deja seguir', async () => {
  const avisos: string[] = [];
  const resultado = await normalizeForEngine(
    new TextEncoder().encode('esto no es un PDF'),
    'application/pdf',
    { onWarn: (mensaje) => avisos.push(mensaje) },
  );

  assert.equal(resultado, null);
  assert.ok(avisos.length > 0, 'un fallo silencioso sería peor que uno ruidoso');
});
