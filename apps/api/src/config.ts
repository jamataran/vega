import { z } from 'zod';

/**
 * Configuración leída del entorno. Se valida al arrancar: si falta algo
 * imprescindible, el proceso muere con un mensaje claro en vez de fallar
 * a mitad de una petición.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Verbosidad del log. Los compose de `deploy/` ya la pasaban —`debug` en
   * test, `info` en prod— y nadie la leía: el nivel estaba fijo en el código,
   * así que el entorno de pruebas llevaba desde siempre corriendo en `info`.
   */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  WEB_ORIGIN: z.string().default('http://localhost:5174'),
  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_TRANSCRIPTION: z.string().default('claude-opus-4-8'),
  AI_MODEL_GRADING: z.string().default('claude-opus-4-8'),
  /**
   * Dónde se guardan los ficheros que los alumnos entregan. Es un directorio
   * del contenedor —un volumen en el compose—, no un almacén de objetos: para
   * una academia con decenas de entregas por noche, S3 sería una dependencia de
   * infraestructura sin contrapartida. La frontera está en `storage/files.ts`,
   * así que cambiarlo el día que haga falta no toca ni la ingesta ni el motor.
   */
  STORAGE_ROOT: z.string().default('./var/storage'),
  LMS_CONNECTOR: z.enum(['mock', 'filesystem', 'moodle3']).default('mock'),
  LMS_FILESYSTEM_ROOT: z.string().optional(),
  MOODLE_BASE_URL: z.string().optional(),
  MOODLE_TOKEN: z.string().optional(),
  BRAND_NAME: z.string().default('Vega'),
  /**
   * Administrador que se crea **sólo** si la instalación no tiene ningún
   * usuario. Es la única forma de entrar en un despliegue recién levantado;
   * a partir de ahí los usuarios se dan de alta desde la aplicación.
   */
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('admin@vega.local'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(1).default('admin'),
});

export type Config = z.infer<typeof EnvSchema> & { version: string };

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  · ${issue.path.join('.')}: ${issue.message}`).join('\n');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Configuración de entorno inválida:\n${describeIssues(parsed.error)}\n\n` +
        'Copia .env.example a .env y revisa los valores.',
    );
  }

  // El proveedor real necesita clave; avisamos aquí y no en la primera corrección.
  if (parsed.data.AI_PROVIDER === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY) {
    throw new Error('AI_PROVIDER=anthropic requiere ANTHROPIC_API_KEY.');
  }

  return { ...parsed.data, version: '0.1.0' };
}
