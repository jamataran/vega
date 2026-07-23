import { toast } from 'sonner';

/**
 * Que un despliegue llegue al navegador.
 *
 * Vega es una PWA: un service worker guarda `index.html` y los chunks para que
 * la aplicación abra rápido y aguante una red mala. El precio es que, sin nada
 * más, **un despliegue no llega**. El navegador sigue sirviendo lo que tiene
 * guardado y el profesor trabaja contra una versión vieja sin saberlo: fue
 * exactamente lo que pasó con el visor de PDF, arreglado en el servidor y roto
 * en la pantalla de quien ya tenía la aplicación abierta.
 *
 * El service worker que genera Vite ya hace `skipWaiting()` y `clientsClaim()`,
 * así que en cuanto se descubre una versión nueva toma el control. Faltaban las
 * dos piezas de este módulo:
 *
 *  1. **Descubrirla.** El navegador sólo comprueba si hay `sw.js` nuevo al
 *     registrar. Una pestaña abierta toda la mañana —corrigiendo, que es
 *     justo lo que se hace aquí— no vuelve a mirar nunca. Se pregunta cada
 *     pocos minutos y al volver a la pestaña.
 *  2. **Aplicarla.** Tomar el control no recarga la página: el JavaScript viejo
 *     sigue ejecutándose hasta que alguien recarga. Por eso, tras un despliegue,
 *     hacía falta recargar **dos veces** para ver lo nuevo.
 *
 * Y una regla que manda sobre las dos: **no se recarga encima de nadie**. Si hay
 * una corrección a medio escribir, recargar tira el trabajo del profesor. En ese
 * caso se avisa y se recarga cuando él quiera.
 */

/** Cada cuánto se le pregunta al servidor si hay versión nueva. */
const UPDATE_INTERVAL_MS = 5 * 60_000;

/**
 * Trabajo sin guardar en la pantalla. Es un módulo y no un contexto de React a
 * propósito: quien decide recargar no vive en el árbol de componentes.
 */
let unsavedWork = false;

/** La llama la pantalla de corrección cada vez que cambia su borrador. */
export function setUnsavedWork(value: boolean): void {
  unsavedWork = value;
}

let reloading = false;

function reload(): void {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

/**
 * Arranca el service worker y mantiene la pestaña al día.
 *
 * No hace nada si el navegador no los admite o si la página no se sirve por
 * HTTPS: en desarrollo, sin service worker, cada recarga ya trae lo último.
 */
export function startServiceWorkerUpdates(): void {
  if (!('serviceWorker' in navigator)) return;

  // En la primera visita no hay controlador y el service worker reclama la
  // pestaña nada más instalarse. Ese primer cambio no es un despliegue: la
  // página acaba de bajarse de la red y ya es la última. Recargar ahí sería un
  // parpadeo gratuito. A partir del segundo, sí: alguien ha desplegado.
  let seenController = navigator.serviceWorker.controller !== null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!seenController) {
      seenController = true;
      return;
    }
    if (!unsavedWork) {
      reload();
      return;
    }
    // Persistente y con acción: un aviso que se va solo, en una pantalla donde
    // se está escribiendo, no lo lee nadie.
    toast('Hay una versión nueva de Vega', {
      description: 'Guarda lo que estés corrigiendo y recarga para usarla.',
      duration: Infinity,
      action: { label: 'Recargar', onClick: () => reload() },
    });
  });

  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      const check = (): void => {
        // `update()` rechaza si la red está caída o el servidor devuelve algo
        // raro. No es motivo para molestar a nadie: se reintenta a la siguiente.
        void registration.update().catch(() => {});
      };

      window.setInterval(check, UPDATE_INTERVAL_MS);
      // Volver a la pestaña es el momento más probable de haberse perdido un
      // despliegue, y el más barato para comprobarlo.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    })
    .catch(() => {
      // Sin service worker la aplicación funciona igual: pierde el arranque
      // rápido, no una función. Nada que anunciar.
    });
}
