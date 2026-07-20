import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';

/**
 * Configuración del log.
 *
 * Fastify trae **pino**, que es el equivalente de log4j/logback en Node: mismos
 * niveles, salida estructurada, loggers hijos y transportes en vez de
 * *appenders*. Lo que no trae es la parte que se da por supuesta viniendo de
 * Java: nadie escribe a fichero ni rota nada aquí. El proceso escribe a la
 * salida estándar y **la rotación la hace Docker** (`logging.options.max-size`
 * en los compose de `deploy/`). Es lo correcto en un contenedor: un fichero
 * dentro de la imagen se pierde en cada redespliegue.
 */

/**
 * Campos que nunca deben acabar en un log.
 *
 * Vega maneja tokens de Moodle, la clave de Anthropic y contraseñas. Hoy
 * ninguna traza los escribe, pero un log es exactamente donde acaban los
 * secretos cuando alguien añade una traza de depuración con prisa y se olvida
 * de quitarla. Esto lo tapa aunque se olvide.
 */
const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'body.password',
  'body.token',
  'body.moodleToken',
  'body.apiKey',
  '*.password',
  '*.token',
  '*.moodleToken',
  '*.apiKey',
];

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  const base = {
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED, censor: '[oculto]' },
  };

  // En desarrollo, legible por una persona. `pino-pretty` es una dependencia de
  // desarrollo y no está en la imagen: por eso el transporte se monta sólo
  // aquí, y no según el nivel de log, que sí puede subirse en producción.
  if (config.NODE_ENV === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: false },
      },
    };
  }

  return base;
}

/**
 * Rutas que no merecen una línea de log por petición.
 *
 * El proxy inverso sondea `/api/health` cada pocos segundos. Sin esto, en un
 * día son decenas de miles de líneas idénticas que empujan fuera del fichero
 * rotado justo lo que se quería leer: el error de anoche.
 */
export const QUIET_ROUTES = new Set(['/api/health']);
