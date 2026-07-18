import { registerConnector } from '@vega/connector-lms';
import { createMoodle3Connector } from './connector.js';

/**
 * Importar este paquete da de alta el conector en el registro. Sigue sin
 * verificar contra un Moodle real: ver los `TODO(vega)` de `connector.ts`.
 */
registerConnector('moodle3', createMoodle3Connector);

export { Moodle3Connector, Moodle3Config, createMoodle3Connector } from './connector.js';
export { MoodleClient, WS_FUNCTIONS, WS_PATH, flatten } from './api.js';
export type { MoodleClientOptions, MoodleFile, MoodleSubmission } from './api.js';
