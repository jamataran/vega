import { registerConnector } from '@vega/connector-lms';
import { createFilesystemConnector } from './connector.js';

/**
 * Importar este paquete lo da de alta en el registro de conectores: la app sólo
 * tiene que hacer `import '@vega/connector-filesystem'` para poder pedirlo por
 * nombre con `createConnector('filesystem', { root })`.
 */
registerConnector('filesystem', createFilesystemConnector);

export { FilesystemConnector, FilesystemConfig, createFilesystemConnector } from './connector.js';
