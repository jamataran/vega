/*
 * Aplica el tema guardado antes del primer pintado, para que abrir la PWA de
 * noche no lance un destello blanco a la cara.
 *
 * Escribe `data-theme` en <html>: es el selector que usan los tokens de marca
 * (`brand/tokens.css`). `lib/theme.tsx` mantiene el mismo atributo después.
 *
 * Va en un fichero aparte y no en línea a propósito: la CSP de producción
 * (ver `nginx.conf`) usa `script-src 'self'`, sin `unsafe-inline`.
 */
(function () {
  try {
    var stored = localStorage.getItem('vega.theme');
    var dark =
      stored === 'dark' ||
      ((stored === null || stored === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (error) {
    /* almacenamiento bloqueado: nos quedamos con el tema claro */
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
