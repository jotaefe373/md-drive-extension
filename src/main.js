/* MDV.main — orquestación.
 *
 * Observa el DOM de Drive, detecta la vista previa de un .md, extrae el texto
 * plano y delega el render en MDV.ui. Gestiona el cierre y evita reaperturas.
 */
(() => {
  "use strict";
  const MDV = (window.MDV = window.MDV || {});
  const OVERLAY_ID = "mdv-overlay";

  let busy = false;
  let viewer = null;        // { overlay, destroy } actual
  let currentSig = null;    // firma del documento ahora renderizado
  let dismissedSig = null;  // firma del documento que el usuario cerró

  /* ---------------------- identidad del documento ----------------------
   * Drive NO cambia la URL al abrir la vista previa de otro archivo de la
   * misma carpeta, así que la identidad se deriva del CONTENIDO real
   * (nombre + tamaño + muestra del texto). Dos archivos distintos producen
   * firmas distintas; reabrir el mismo produce la misma firma.
   */
  function docSignature(name, raw) {
    return `${name} ${raw.length} ${raw.slice(0, 120)}`;
  }

  function currentFileName() {
    const el = document.querySelector(
      '[aria-label$=".md"], [data-tooltip$=".md"], [title$=".md"]'
    );
    const fromAttr = el && (el.getAttribute("aria-label") ||
      el.getAttribute("data-tooltip") || el.getAttribute("title"));
    if (fromAttr) return fromAttr.trim();
    const m = (document.title || "").match(/[^\\/\n]+\.(md|markdown|mdown|mkd)\b/i);
    return m ? m[0] : "documento.md";
  }

  /* ---------------------- detección ---------------------- */
  function isMarkdownContext() {
    const title = (document.title || "").toLowerCase();
    if (/\.(md|markdown|mdown|mkd)\b/.test(title)) return true;
    return !!document.querySelector('[aria-label$=".md"], [data-tooltip$=".md"], [title$=".md"]');
  }

  // Nodo donde Drive vuelca el texto plano del archivo.
  // IMPORTANTE: excluir nuestro propio overlay. Si no, un <pre> de un bloque
  // de código renderizado por nosotros se confundiría con el texto de Drive,
  // provocando un bucle de re-render que cuelga la pestaña.
  function findPlainTextNode() {
    for (const pre of document.querySelectorAll("pre")) {
      if (pre.closest("#" + OVERLAY_ID)) continue;
      const t = (pre.innerText || "").trim();
      if (t.length > 0 && pre.offsetParent !== null) return pre;
    }
    const candidates = document.querySelectorAll(
      '[role="document"], .drive-viewer-text, .ndfHFb-c4YZDc'
    );
    for (const el of candidates) {
      if (el.closest("#" + OVERLAY_ID)) continue;
      const t = (el.innerText || "").trim();
      if (t.length > 20 && el.offsetParent !== null) return el;
    }
    return null;
  }

  /* ---------------------- observador del DOM de Drive ----------------------
   * Vigila el DOM de Drive de forma continua (debounce 300 ms). Permanece
   * conectado también con el overlay abierto: así detecta de forma fiable
   * cuándo Drive carga otro archivo (navegación con flechas) y refresca el
   * overlay en sitio, sin depender de temporizadores frágiles.
   */
  let scanTimer = 0;
  const observer = new MutationObserver((mutations) => {
    // Ignorar mutaciones que ocurren SOLO dentro de nuestro overlay: nuestros
    // propios renders no deben despertar al observador (evita churn y bucles).
    const overlayEl = document.getElementById(OVERLAY_ID);
    if (overlayEl && !mutations.some((m) => !overlayEl.contains(m.target))) return;

    clearTimeout(scanTimer);
    scanTimer = setTimeout(tryRender, 300); // debounce: esperar a que Drive pinte
  });
  function startObserver() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ---------------------- ciclo de vida ---------------------- */
  // Quita el overlay SIN marcar el documento como descartado.
  // Se usa cuando Drive navega a un archivo que no es .md.
  function removeOverlay() {
    if (viewer) { viewer.destroy(); viewer = null; }
    currentSig = null;
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.documentElement.classList.remove("mdv-active");
  }

  // Cierre intencional del usuario (botón ✕ / Escape): no reabrir este doc.
  function close() {
    dismissedSig = currentSig;
    removeOverlay();
  }

  async function tryRender() {
    if (busy) return;

    const overlayOpen = !!document.getElementById(OVERLAY_ID);
    const md = isMarkdownContext();
    const node = md ? findPlainTextNode() : null;
    const raw = node ? (node.innerText || "").trim() : "";

    // --- overlay ya abierto: actualizar en sitio o retirarse ---
    if (overlayOpen) {
      if (!md || !raw) { removeOverlay(); return; } // navegó a un no-.md
      const fileName = currentFileName();
      const sig = docSignature(fileName, raw);
      if (sig !== currentSig && viewer) {           // Drive cambió de archivo
        currentSig = sig;
        viewer.update({ raw, fileName });
      }
      return;
    }

    // --- overlay cerrado: crear si procede ---
    if (!md || !raw) return;
    const fileName = currentFileName();
    const sig = docSignature(fileName, raw);
    if (sig === dismissedSig) return; // el usuario lo cerró: respetarlo
    dismissedSig = null;

    busy = true;
    try {
      await MDV.settings.load();
      currentSig = sig;
      viewer = MDV.ui.createViewer({
        raw, fileName, onClose: close,
        listFiles: collectMarkdownFiles,
        openFile: openMarkdownFile,
      });
      document.documentElement.classList.add("mdv-active");
      document.body.appendChild(viewer.overlay);
    } catch (err) {
      console.error("[MD Viewer] Error al renderizar:", err);
    } finally {
      busy = false;
    }
  }

  /* ---------------------- navegación entre archivos ----------------------
   * Reutiliza la navegación nativa de Drive (← →). Como Google ofusca su DOM,
   * se intenta primero el botón anterior/siguiente y, si no aparece, se
   * simula la pulsación de la tecla a nivel de documento.
   */
  const NAV_WORDS = {
    prev: /(anterior|previous|pr[ée]c[ée]dent|vorherige|zur[üu]ck|prev)/i,
    next: /(siguiente|seguinte|pr[óo]xim|next|suivant|n[äa]chste|weiter)/i,
  };

  function clickNativeNav(dir) {
    const re = dir > 0 ? NAV_WORDS.next : NAV_WORDS.prev;
    const candidates = document.querySelectorAll("[aria-label], [data-tooltip]");
    for (const el of candidates) {
      if (el.closest("#" + OVERLAY_ID)) continue; // ignorar nuestra propia UI
      const label = el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || "";
      if (re.test(label) && el.offsetParent !== null) { el.click(); return true; }
    }
    return false;
  }

  function dispatchArrow(dir) {
    const key = dir > 0 ? "ArrowRight" : "ArrowLeft";
    const code = dir > 0 ? 39 : 37;
    const make = () => {
      const ev = new KeyboardEvent("keydown", {
        key, code: key, bubbles: true, cancelable: true, view: window,
      });
      // Drive (código antiguo) suele leer keyCode/which, de solo lectura.
      Object.defineProperty(ev, "keyCode", { get: () => code });
      Object.defineProperty(ev, "which", { get: () => code });
      return ev;
    };
    document.body.dispatchEvent(make());
    document.dispatchEvent(make());
  }

  function navigate(dir) {
    if (!clickNativeNav(dir)) dispatchArrow(dir);
    // El cambio de contenido lo recoge el observador -> tryRender -> update.
  }

  /* ---------------------- lista de .md de la carpeta ----------------------
   * Descubre los archivos .md presentes en el DOM (rejilla/lista de Drive) y
   * permite abrirlos simulando el doble clic sobre su elemento. Solo cuenta
   * elementos que parecen entradas de la lista de archivos (tienen ancestro
   * de celda/fila/data-id), no la cabecera de la vista previa.
   */
  function collectMarkdownFiles() {
    const seen = new Set();
    const out = [];
    const els = document.querySelectorAll('[aria-label$=".md"], [data-tooltip$=".md"]');
    for (const el of els) {
      if (el.closest("#" + OVERLAY_ID)) continue; // ignorar nuestra propia UI
      const name = (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || "").trim();
      if (!name || seen.has(name)) continue;
      const target = el.closest('[data-id], [role="gridcell"], [role="row"], [role="listitem"]');
      if (!target) continue; // no parece una entrada de la lista de archivos
      seen.add(name);
      out.push({ name, _el: target });
    }
    return out;
  }

  function openMarkdownFile(item) {
    const el = item && item._el;
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    el.dispatchEvent(new MouseEvent("dblclick", opts)); // Drive abre con doble clic
    // El cambio de vista lo recoge el observador -> tryRender -> update.
  }

  /* ---------------------- eventos globales ---------------------- */
  document.addEventListener("keydown", (e) => {
    if (!document.getElementById(OVERLAY_ID)) return;

    // Ignorar eventos sintéticos: los que dispatchArrow() genera para la
    // navegación nativa de Drive. Sin esto, nuestro propio listener los
    // reintercepta y entra en recursión infinita (stack overflow).
    if (!e.isTrusted) return;

    if (e.key === "Escape") { close(); return; }

    // No navegar mientras se escribe en el editor.
    const t = e.target;
    const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
    if (typing) return;

    if (e.key === "ArrowRight") { e.preventDefault(); navigate(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); navigate(-1); }
  }, true);

  // Precarga de ajustes, arranque del observador e intento inicial.
  startObserver();
  MDV.settings.load().then(tryRender);
})();
