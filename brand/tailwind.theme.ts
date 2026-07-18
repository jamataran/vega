/**
 * Referencia para integrar la identidad Vega en un proyecto que ya use Tailwind.
 * Mezcla este objeto con la configuración real del repositorio; no reemplaces
 * plugins, breakpoints ni tokens existentes sin revisar su uso.
 */
export const vegaTheme = {
  colors: {
    vega: {
      ink: "#080B14",
      text: "#0B1020",
      cloud: "#F7F9FC",
      slate: "#667085",
      violet: {
        400: "#B98CFF",
        500: "#8A5CFF",
        600: "#5B39FF",
      },
      blue: "#277BFF",
      cyan: "#22D7F6",
    },
  },
  fontFamily: {
    display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
    sans: ["Inter", "system-ui", "sans-serif"],
  },
  borderRadius: {
    vegaSm: "8px",
    vegaMd: "12px",
    vegaLg: "16px",
  },
  boxShadow: {
    vegaRaised: "0 8px 24px rgb(8 11 20 / 0.08)",
  },
} as const;
