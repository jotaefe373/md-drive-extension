/* MDV.ui — construcción de la interfaz del visor.
 *
 * createViewer({ raw, fileName, onClose }) -> { overlay, destroy }
 *   - overlay : el nodo a insertar en document.body
 *   - destroy : limpia suscripciones (llamar al cerrar)
 *
 * El módulo no toca el DOM de Drive ni decide cuándo mostrarse: eso es
 * responsabilidad de main.js. Aquí solo se arma la UI y se cablean eventos.
 */
(() => {
  "use strict";
  const MDV = (window.MDV = window.MDV || {});
  const OVERLAY_ID = "mdv-overlay";

  /* ---------------------- mini-helper de DOM ---------------------- */
  // h("button", { class, text, onClick, ...attrs }, [hijos])
  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function")
        el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  /* ---------------------- componentes reutilizables ---------------------- */

  // Control segmentado: [A|B|C]. options = [{value,label}], onChange(value)
  function segmented(options, value, onChange) {
    const wrap = h("div", { class: "mdv-segmented", role: "group" });
    const sync = (v) => wrap.querySelectorAll("button").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.value === v));
    options.forEach((opt) => {
      wrap.appendChild(h("button", {
        type: "button",
        class: "mdv-seg-btn",
        "data-value": opt.value,
        text: opt.label,
        onClick: () => { sync(opt.value); onChange(opt.value); },
      }));
    });
    sync(value);
    return wrap;
  }

  // Slider con etiqueta y valor. onChange(number)
  function slider({ label, min, max, step, value, unit, onChange }) {
    const out = h("span", { class: "mdv-slider-val", text: value + unit });
    const input = h("input", {
      type: "range", class: "mdv-slider",
      min, max, step, value,
      onInput: (e) => { const v = Number(e.target.value); out.textContent = v + unit; onChange(v); },
    });
    return h("label", { class: "mdv-field" }, [
      h("span", { class: "mdv-field-label" }, [label, out]),
      input,
    ]);
  }

  // Select etiquetado. options = [{value,label}], onChange(value)
  function select(label, options, value, onChange) {
    const sel = h("select", {
      class: "mdv-select",
      onChange: (e) => onChange(e.target.value),
    }, options.map((o) => h("option", { value: o.value, text: o.label, selected: o.value === value })));
    return h("label", { class: "mdv-field" }, [
      h("span", { class: "mdv-field-label" }, label),
      sel,
    ]);
  }

  /* ---------------------- panel de ajustes ---------------------- */
  function buildSettingsPanel() {
    const s = MDV.settings;
    const cur = s.get();

    return h("div", { class: "mdv-settings", role: "dialog", "aria-label": "Ajustes" }, [
      h("div", { class: "mdv-settings-title", text: "Apariencia" }),

      h("div", { class: "mdv-field" }, [
        h("span", { class: "mdv-field-label", text: "Tema" }),
        segmented(
          [{ value: "auto", label: "Auto" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }],
          cur.theme, (v) => s.set({ theme: v })
        ),
      ]),

      select("Fuente",
        [{ value: "system", label: "Sistema" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Monoespaciada" }],
        cur.fontFamily, (v) => s.set({ fontFamily: v })
      ),

      slider({
        label: "Tamaño de fuente", unit: " px", ...s.BOUNDS.fontSize,
        value: cur.fontSize, onChange: (v) => s.set({ fontSize: v }),
      }),

      slider({
        label: "Ancho del contenido", unit: " px", ...s.BOUNDS.contentWidth,
        value: cur.contentWidth, onChange: (v) => s.set({ contentWidth: v }),
      }),
    ]);
  }

  /* ---------------------- visor completo ---------------------- */
  function createViewer({ raw, fileName, onClose }) {
    const s = MDV.settings;
    let source = raw;
    let currentFile = fileName;

    /* --- vista previa --- */
    const preview = h("article", { class: "mdv-markdown-body" });
    const render = () => { preview.innerHTML = MDV.parse(source); };
    render();
    const previewPane = h("div", { class: "mdv-scroll" }, [preview]);

    // Debounce del re-render al teclear: evita re-parsear el documento entero
    // en cada pulsación (importa en archivos grandes).
    let renderTimer = 0;
    const scheduleRender = () => {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 150);
    };

    /* --- editor (no guarda en Drive; ver nota inline) --- */
    const textarea = h("textarea", {
      class: "mdv-textarea", spellcheck: "false",
      onInput: (e) => { source = e.target.value; scheduleRender(); },
    });
    textarea.value = source;

    const editorPane = h("div", { class: "mdv-editor" }, [
      h("div", { class: "mdv-editor-bar" }, [
        h("span", { class: "mdv-editor-note", text: "Edición local — no se guarda en Drive" }),
        h("div", { class: "mdv-editor-actions" }, [
          h("button", { type: "button", class: "mdv-btn", text: "Copiar", onClick: copySource }),
          h("button", { type: "button", class: "mdv-btn", text: "Descargar .md", onClick: downloadSource }),
        ]),
      ]),
      textarea,
    ]);

    function copySource(e) {
      navigator.clipboard?.writeText(source).then(() => flash(e.target, "¡Copiado!"));
    }
    function downloadSource() {
      const blob = new Blob([source], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: safeName(currentFile) });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* --- toolbar --- */
    const settingsPanel = buildSettingsPanel();
    const settingsBtn = h("button", {
      type: "button", class: "mdv-icon-btn", title: "Ajustes", "aria-label": "Ajustes",
      html: "&#9881;", // ⚙
      onClick: () => settingsPanel.classList.toggle("is-open"),
    });

    const modeToggle = segmented(
      [{ value: "view", label: "Vista" }, { value: "edit", label: "Editar" }],
      "view", (m) => overlay.setAttribute("data-mode", m)
    );

    const filenameEl = h("span", { class: "mdv-filename", text: fileName || "" });
    const toolbar = h("div", { class: "mdv-toolbar" }, [
      h("div", { class: "mdv-toolbar-left" }, [
        h("span", { class: "mdv-badge", text: "Markdown" }),
        filenameEl,
      ]),
      h("div", { class: "mdv-toolbar-right" }, [
        modeToggle,
        h("div", { class: "mdv-settings-wrap" }, [settingsBtn, settingsPanel]),
        h("button", { type: "button", class: "mdv-close", text: "✕ Cerrar", onClick: () => onClose?.() }),
      ]),
    ]);

    /* --- ensamblado --- */
    const overlay = h("div", { id: OVERLAY_ID, "data-mode": "view" }, [
      toolbar,
      h("div", { class: "mdv-body" }, [editorPane, previewPane]),
    ]);

    // Aplica ajustes ahora y re-aplica ante cualquier cambio.
    s.applyTo(overlay);
    const unsubscribe = s.subscribe(() => s.applyTo(overlay));

    // Cierra el panel de ajustes al hacer clic fuera de él.
    overlay.addEventListener("click", (e) => {
      if (settingsPanel.classList.contains("is-open") &&
          !settingsPanel.contains(e.target) && e.target !== settingsBtn) {
        settingsPanel.classList.remove("is-open");
      }
    });

    // Refresca el contenido sin recrear el overlay (navegación entre archivos).
    function update({ raw, fileName }) {
      if (typeof raw === "string") {
        clearTimeout(renderTimer); // cancela un render debounced pendiente
        source = raw;
        textarea.value = raw;
        render();
        previewPane.scrollTop = 0;
        textarea.scrollTop = 0;
      }
      if (fileName) {
        currentFile = fileName;
        filenameEl.textContent = fileName;
      }
    }

    return { overlay, update, destroy: unsubscribe };
  }

  /* ---------------------- utilidades ---------------------- */
  function safeName(name) {
    let n = (name || "documento").trim().replace(/[\\/:*?"<>|]+/g, "_");
    if (!/\.(md|markdown|mdown|mkd)$/i.test(n)) n += ".md";
    return n;
  }

  function flash(btn, msg) {
    const prev = btn.textContent;
    btn.textContent = msg;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1200);
  }

  MDV.ui = { createViewer };
})();
