import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MATH_UNITS_PER_EM, renderMath } from './math.js';

/**
 * Lo que se prueba aquí no es que la fórmula «quede bonita» —eso hay que
 * mirarlo— sino las tres cosas que, si se rompen, mandan una fórmula deformada
 * al PDF que firma un profesor: que la caja tenga la geometría que dice tener,
 * que sólo se emitan comandos que pdf-lib ejecuta bien, y que ante cualquier
 * duda se devuelva `null` para que quien llama caiga al texto plano.
 */

/** Todas las letras de comando que aparecen en un trazo. */
function commandsIn(paths: readonly string[]): Set<string> {
  const letters = new Set<string>();
  for (const path of paths) {
    for (const match of path.matchAll(/[A-Za-z]/g)) letters.add(match[0]);
  }
  return letters;
}

/** Caja que ocupan los trazos, para comprobar que cuadra con lo declarado. */
function boundsOf(paths: readonly string[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const path of paths) {
    const tokens = path.split(/\s+/).filter((token) => token !== '');
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index] ?? '';
      index += 1;
      if (/[A-Za-z]/.test(token)) continue;
      const x = Number(token);
      const y = Number(tokens[index] ?? '');
      index += 1;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { minX, maxX, minY, maxY };
}

test('una fracción se compone en trazos que caben en la caja declarada', () => {
  const drawing = renderMath('\\frac{a}{b}', true);
  assert.ok(drawing !== null, 'una fracción sencilla tiene que poder componerse');

  const bounds = boundsOf(drawing.paths);
  // El origen es la línea base: lo de arriba tiene `y` negativa y lo de abajo
  // positiva. Si esto se invirtiera, la fórmula saldría volcada en el PDF.
  assert.ok(bounds.minY < 0, 'el numerador tiene que quedar por encima de la línea base');
  assert.ok(bounds.maxY > 0, 'el denominador tiene que quedar por debajo');

  // Un margen de una décima de `em` cubre el redondeo a milésimas y el grosor
  // del trazo sin dejar pasar una caja que se quede corta de verdad.
  const slack = MATH_UNITS_PER_EM / 10;
  assert.ok(bounds.maxX <= drawing.width + slack, 'nada puede salirse por la derecha');
  assert.ok(-bounds.minY <= drawing.ascent + slack, 'el ascenso declarado tiene que cubrir el trazo');
  assert.ok(bounds.maxY <= drawing.descent + slack, 'el descenso declarado tiene que cubrir el trazo');
});

test('sólo se emiten los comandos de trazo que pdf-lib dibuja bien', () => {
  // pdf-lib interpreta mal `T` (la cuadrática suave): tras dibujar la curva
  // vuelve a reflejar el punto de control y guarda el reflejo del reflejo. Las
  // fuentes TeX encadenan seis y siete `T` para un paréntesis grande, así que
  // el error se acumula y deforma el contorno. Por eso aquí se resuelve la
  // reflexión y se emite la `Q` explícita: si alguien deja de hacerlo, los
  // paréntesis vuelven a salir con un tajo de lado a lado.
  const drawing = renderMath('f\\left(\\frac{i}{n}\\right)', true);
  assert.ok(drawing !== null);

  assert.deepEqual(
    [...commandsIn(drawing.paths)].sort(),
    ['L', 'M', 'Q', 'Z'],
    'ni T ni H ni V deben llegar a pdf-lib',
  );
});

test('los glifos invisibles no tiran la fórmula entera', () => {
  // `\ln x` lleva dentro un carácter de «aplicación de función» (U+2061) que
  // MathJax emite como un `<path>` con la `d` vacía. Tratar eso como un trazo
  // ilegible dejaba sin componer cualquier fórmula con un logaritmo, un seno o
  // una función aplicada, que en una corrección de matemáticas son casi todas.
  for (const tex of ['\\ln x', '\\ln(x)', '\\sin\\theta', '\\log_2 8']) {
    assert.ok(renderMath(tex, false) !== null, `${tex} tiene que poder componerse`);
  }
});

test('la versión suelta de una fórmula ocupa más alto que la de dentro de una frase', () => {
  // En display los límites de un sumatorio van encima y debajo del signo; en
  // línea, al lado. Es la diferencia que justifica que el paginador distinga
  // los dos modos en vez de componerlo todo igual.
  const display = renderMath('\\sum_{i=1}^{n} i', true);
  const inline = renderMath('\\sum_{i=1}^{n} i', false);
  assert.ok(display !== null && inline !== null);

  assert.ok(
    display.ascent + display.descent > inline.ascent + inline.descent,
    'el modo display tiene que ser más alto',
  );
  assert.ok(display.width < inline.width, 'y más estrecho, porque apila los límites');
});

test('un TeX que no se puede componer se rinde en vez de inventarse algo', () => {
  // La corrección la redacta un modelo, no un compilador: llega TeX inválido.
  // Devolver `null` es lo que permite al PDF caer al texto legible; lanzar
  // dejaría al profesor con un error al descargar.
  for (const tex of ['', '   ', '\\frac{', '\\comandoinventado{x}']) {
    assert.equal(renderMath(tex, false), null, `«${tex}» no debería componerse`);
  }
});
