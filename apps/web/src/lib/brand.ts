/**
 * La academia que despliega Vega puede poner su nombre sin hacer fork
 * (ver la sección de marca del README).
 */
export const BRAND_NAME: string = import.meta.env.VITE_BRAND_NAME?.trim() || 'Vega';
