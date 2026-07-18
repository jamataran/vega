import { registerConnector } from './connector.js';
import { createMockConnector } from './mock.js';

/**
 * `@vega/connector-lms` — interfaz y tipos. Las implementaciones viven en
 * paquetes hermanos y se registran ellas mismas; aquí sólo damos de alta el
 * mock, que es el conector por defecto en desarrollo y no arrastra nada.
 */
registerConnector('mock', createMockConnector);

export * from './types.js';
export * from './connector.js';
export { MockLmsConnector, createMockConnector } from './mock.js';
export type {
  MockLmsConnectorOptions,
  PublishedFile,
  PublishedGrade,
} from './mock.js';
