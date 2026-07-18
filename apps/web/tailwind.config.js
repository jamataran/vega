/**
 * Tema de Tailwind alimentado por los tokens de Vega.
 *
 * Los nombres siguen el convenio de shadcn/ui (`background`, `foreground`,
 * `primary`…) pero los valores salen de `src/styles/theme.css`, que a su vez
 * traduce `src/styles/tokens.css` (copia literal de `brand/tokens.css`).
 * Radios y sombra se leen directamente de los tokens de marca.
 *
 * Los colores viven como tripletas RGB en variables CSS para que `bg-primary/10`
 * siga funcionando y para que claro y oscuro sean dos temas reales, no un
 * filtro sobre uno solo.
 */
import animate from 'tailwindcss-animate';

const withAlpha = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  // `tokens.css` cambia el tema con `[data-theme="dark"]`, no con `.dark`.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: withAlpha('--background'),
        foreground: withAlpha('--foreground'),
        border: withAlpha('--border'),
        'border-strong': withAlpha('--border-strong'),
        input: withAlpha('--input'),
        ring: withAlpha('--ring'),
        card: {
          DEFAULT: withAlpha('--card'),
          foreground: withAlpha('--card-foreground'),
        },
        popover: {
          DEFAULT: withAlpha('--popover'),
          foreground: withAlpha('--popover-foreground'),
        },
        primary: {
          DEFAULT: withAlpha('--primary'),
          foreground: withAlpha('--primary-foreground'),
          hover: withAlpha('--primary-hover'),
          ink: withAlpha('--primary-ink'),
          soft: withAlpha('--primary-soft'),
        },
        secondary: {
          DEFAULT: withAlpha('--secondary'),
          foreground: withAlpha('--secondary-foreground'),
        },
        muted: {
          DEFAULT: withAlpha('--muted'),
          foreground: withAlpha('--muted-foreground'),
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          foreground: withAlpha('--accent-foreground'),
        },
        destructive: {
          DEFAULT: withAlpha('--destructive'),
          foreground: withAlpha('--destructive-foreground'),
          ink: withAlpha('--destructive-ink'),
          soft: withAlpha('--destructive-soft'),
        },
        success: {
          DEFAULT: withAlpha('--success'),
          foreground: withAlpha('--success-foreground'),
          ink: withAlpha('--success-ink'),
          soft: withAlpha('--success-soft'),
        },
        warning: {
          DEFAULT: withAlpha('--warning'),
          foreground: withAlpha('--warning-foreground'),
          ink: withAlpha('--warning-ink'),
          soft: withAlpha('--warning-soft'),
        },
        info: {
          DEFAULT: withAlpha('--info'),
          foreground: withAlpha('--info-foreground'),
          ink: withAlpha('--info-ink'),
          soft: withAlpha('--info-soft'),
        },
      },
      fontFamily: {
        // Space Grotesk para display, títulos y métricas; Inter para el resto.
        display: ['var(--font-vega-display)'],
        sans: ['var(--font-vega-ui)'],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        // Nada por debajo de 12 px; el tamaño habitual de interfaz es 14–16 px.
        micro: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.06em' }],
        ui: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.45rem' }],
        title: ['1.25rem', { lineHeight: '1.6rem', letterSpacing: '-0.015em' }],
        score: ['2.125rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        // 8 / 12 / 16 px, tal cual los define la marca.
        DEFAULT: 'var(--radius-sm)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-md)',
        xl: 'var(--radius-lg)',
      },
      boxShadow: {
        // Una única elevación: la de la marca.
        raised: 'var(--shadow-raised)',
      },
      backgroundImage: {
        // Reservado a logo, hero e indicadores excepcionales.
        'vega-brand': 'var(--vega-gradient-brand)',
      },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom, 0px)',
      },
      transitionTimingFunction: {
        snap: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
      keyframes: {
        shimmer: {
          from: { backgroundPosition: '-160% 0' },
          to: { backgroundPosition: '260% 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [animate],
};
