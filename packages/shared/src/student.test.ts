import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studentContextFor, studentLabel, type Student } from './domain.js';

/**
 * Estas pruebas no comprueban una función: comprueban una **frontera de
 * protección de datos**. Vega guarda el perfil entero del alumno —con su
 * correo, su teléfono y, según la instalación, su NIF y su domicilio— y manda al
 * modelo sólo lo que puede cambiar la corrección.
 *
 * Si alguna de estas pruebas se cae, no se «arregla» ajustando la expectativa:
 * significa que un dato personal ha empezado a salir hacia un tercero.
 */

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    studentRef: 'moodle-4217',
    username: 'ana.perez',
    firstName: 'Ana',
    lastName: 'Pérez Gil',
    fullName: 'Ana Pérez Gil',
    email: 'ana.perez@ejemplo.es',
    phone: '600123456',
    idnumber: 'EST-0042',
    institution: 'Academia Derivadas',
    department: 'Matemáticas',
    city: 'Granada',
    country: 'ES',
    community: 'ANDALUCIA',
    customFields: [
      { shortname: 'CCAA', name: 'Comunidad autónoma', value: 'ANDALUCIA' },
      { shortname: 'PROVINCIA', name: 'Provincia', value: 'Granada' },
      { shortname: 'NIF', name: 'NIF', value: '00000000T' },
      { shortname: 'DIRECCION', name: 'Dirección', value: 'Calle Falsa 123' },
      { shortname: 'CODIGO_POSTAL', name: 'Código postal', value: '18001' },
    ],
    syncedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

test('el NIF, la dirección y el código postal NO llegan al modelo', () => {
  const context = studentContextFor(student());
  const serialized = JSON.stringify(context);

  assert.doesNotMatch(serialized, /00000000T/, 'el NIF no puede salir hacia el modelo');
  assert.doesNotMatch(serialized, /Calle Falsa/, 'el domicilio no puede salir hacia el modelo');
  assert.doesNotMatch(serialized, /18001/, 'el código postal no puede salir hacia el modelo');
});

test('el correo, el teléfono y el usuario tampoco', () => {
  const serialized = JSON.stringify(studentContextFor(student()));

  assert.doesNotMatch(serialized, /ejemplo\.es/);
  assert.doesNotMatch(serialized, /600123456/);
  assert.doesNotMatch(serialized, /ana\.perez/);
  assert.doesNotMatch(serialized, /EST-0042/);
});

test('el nombre y la comunidad sí, que son los que motivan todo esto', () => {
  const context = studentContextFor(student());

  assert.equal(context?.name, 'Ana Pérez Gil');
  assert.equal(context?.community, 'ANDALUCIA');
});

test('varias comunidades viajan tal cual: un opositor se presenta en más de una', () => {
  const context = studentContextFor(student({ community: 'ANDALUCIA, MURCIA' }));

  assert.equal(context?.community, 'ANDALUCIA, MURCIA');
});

test('la provincia entra con su etiqueta legible, la comunidad no se duplica', () => {
  const context = studentContextFor(student());

  assert.deepEqual(context?.fields, [{ label: 'Provincia', value: 'Granada' }]);
});

test('ampliar la lista por instalación no puede colar un dato de identidad', () => {
  // Alguien añade `NIF` a los campos configurables, por error o por atajo.
  const context = studentContextFor(student(), ['NIF', 'DIRECCION']);

  assert.doesNotMatch(JSON.stringify(context), /00000000T/);
  assert.doesNotMatch(JSON.stringify(context), /Calle Falsa/);
});

test('una instalación puede añadir un campo suyo que no sea de identidad', () => {
  const context = studentContextFor(
    student({
      customFields: [{ shortname: 'TURNO', name: 'Turno', value: 'Tarde' }],
      community: null,
    }),
    ['TURNO'],
  );

  assert.deepEqual(context?.fields, [{ label: 'Turno', value: 'Tarde' }]);
});

test('sin ficha no hay sección de alumno en el prompt', () => {
  assert.equal(studentContextFor(null), null);
});

test('una ficha vacía tampoco añade una sección hueca', () => {
  const context = studentContextFor(
    student({
      fullName: null,
      firstName: null,
      lastName: null,
      community: null,
      customFields: [{ shortname: 'NIF', name: 'NIF', value: '00000000T' }],
    }),
  );

  assert.equal(context, null);
});

test('un campo permitido pero vacío no ocupa sitio', () => {
  const context = studentContextFor(
    student({
      community: null,
      customFields: [{ shortname: 'PROVINCIA', name: 'Provincia', value: '   ' }],
    }),
  );

  assert.deepEqual(context?.fields, []);
});

// ── Cómo se le enseña al profesor ───────────────────────────────────────────

test('el profesor ve el nombre, no el identificador de Moodle', () => {
  const submission = { studentRef: 'moodle-4217', studentAlias: 'Ana Pérez Gil' };

  assert.equal(studentLabel(submission, student()), 'Ana Pérez Gil');
});

test('sin ficha se cae al alias, y sin alias al identificador', () => {
  assert.equal(studentLabel({ studentRef: 'moodle-4217', studentAlias: 'Ana P.' }, null), 'Ana P.');
  assert.equal(studentLabel({ studentRef: 'moodle-4217', studentAlias: null }, null), 'moodle-4217');
});
