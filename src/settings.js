/* MDV.settings — preferencias del usuario (tema, tipografía, tamaño, ancho).
 *
 * Persiste en chrome.storage.local y notifica cambios a quien se suscriba.
 * Aplica los valores a un elemento mediante variables CSS + data-theme,
 * de modo que styles.css es la única fuente de verdad visual.
 *
 * Expone: MDV.settings = { DEFAULTS, FONTS, BOUNDS, load, get, set,
 *                          subscribe, applyTo }
 */
(() => {
  "use strict";
  const MDV = (window.MDV = window.MDV || {});
  const KEY = "mdv-settings";

  const DEFAULTS = {
    theme: "auto",        // "auto" | "light" | "dark"
    fontFamily: "system", // clave de FONTS
    fontSize: 16,         // px
    contentWidth: 860,    // px
  };

  // Pilas tipográficas (sin descargas externas: todo del sistema).
  const FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    serif:  'Georgia, Cambria, "Times New Roman", Times, serif',
    mono:   'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  };

  // Rangos válidos para los sliders (y para sanear lo que venga de storage).
  const BOUNDS = {
    fontSize: { min: 12, max: 26, step: 1 },
    contentWidth: { min: 600, max: 1280, step: 20 },
  };

  let current = { ...DEFAULTS };
  let loaded = false;
  const listeners = new Set();

  const clamp = (n, { min, max }) => Math.min(max, Math.max(min, Number(n) || 0));

  function sanitize(obj) {
    const s = { ...DEFAULTS, ...obj };
    if (!["auto", "light", "dark"].includes(s.theme)) s.theme = DEFAULTS.theme;
    if (!FONTS[s.fontFamily]) s.fontFamily = DEFAULTS.fontFamily;
    s.fontSize = clamp(s.fontSize, BOUNDS.fontSize);
    s.contentWidth = clamp(s.contentWidth, BOUNDS.contentWidth);
    return s;
  }

  async function load() {
    if (loaded) return current;
    try {
      const stored = await chrome.storage.local.get(KEY);
      current = sanitize(stored[KEY] || {});
    } catch {
      current = { ...DEFAULTS };
    }
    loaded = true;
    return current;
  }

  function get() { return current; }

  async function set(patch) {
    current = sanitize({ ...current, ...patch });
    try { await chrome.storage.local.set({ [KEY]: current }); } catch { /* sin persistencia */ }
    listeners.forEach((fn) => fn(current));
    return current;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Vuelca el estado actual sobre un elemento (el overlay).
  function applyTo(el) {
    el.style.setProperty("--mdv-font-size", current.fontSize + "px");
    el.style.setProperty("--mdv-content-width", current.contentWidth + "px");
    el.style.setProperty("--mdv-font-family", FONTS[current.fontFamily] || FONTS.system);
    el.setAttribute("data-theme", current.theme);
  }

  MDV.settings = { DEFAULTS, FONTS, BOUNDS, load, get, set, subscribe, applyTo };
})();
