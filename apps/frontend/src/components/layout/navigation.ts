import type { ComponentType } from 'react';
import {
  BarChart3,
  FileText,
  Layers,
  ListChecks,
  MessageSquareText,
  Settings,
  Timer,
  Users,
  ScrollText,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<LucideProps>;
  /** Sólo activo con coincidencia exacta (la raíz lo necesita). */
  end?: boolean;
}

/**
 * Las cuatro del profesor: son la navegación real del producto y caben en la
 * barra inferior sin apretarse a 375 px.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { to: '/', label: 'Revisión', Icon: ListChecks, end: true },
  { to: '/actividades', label: 'Actividades', Icon: Layers },
  { to: '/contexto', label: 'Contexto', Icon: FileText },
  { to: '/procesos', label: 'Procesos', Icon: Timer },
];

/**
 * Reservadas al administrador; viven en la barra lateral y en el menú de usuario.
 *
 * Ajustes **ya no está aquí**: es donde cada profesor pega su token de Moodle,
 * y sin entrada en el menú sólo llegaba quien antes hubiera fallado al importar
 * —los enlaces «Ir a Ajustes» de los estados de error—. Dentro, las secciones
 * de instalación se siguen enseñando sólo a quien administra.
 */
export const ADMIN_NAV: readonly NavItem[] = [
  { to: '/usuarios', label: 'Usuarios', Icon: Users },
  { to: '/prompts', label: 'Prompts', Icon: MessageSquareText },
  { to: '/registro-ia', label: 'Registro de IA', Icon: ScrollText },
];

/**
 * Pantallas de consulta que no compiten por un sitio en la barra inferior. El
 * panel se mira de vez en cuando, no en cada sesión de corrección; Ajustes, aún
 * menos, pero tiene que estar alcanzable para todos los roles.
 */
export const SECONDARY_NAV: readonly NavItem[] = [
  { to: '/panel', label: 'Panel', Icon: BarChart3 },
  { to: '/ajustes', label: 'Ajustes', Icon: Settings },
];
