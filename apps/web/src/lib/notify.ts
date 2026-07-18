import { toast } from 'sonner';
import { errorMessage } from './api';

/**
 * Avisos de la aplicación sobre `sonner`. No es un contexto: cualquier módulo
 * puede avisar sin depender del árbol de React. El `<Toaster>` se monta una vez
 * en `App`.
 */
export const notify = {
  success(title: string, description?: string): void {
    toast.success(title, { description });
  },
  info(title: string, description?: string): void {
    toast(title, { description });
  },
  /** El caso más frecuente: una mutación que ha fallado. */
  error(title: string, error: unknown): void {
    toast.error(title, { description: errorMessage(error) });
  },
};
