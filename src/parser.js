/* MDV.parser — parser de Markdown minimalista, sin dependencias ni CDN.
 * Cubre: headings, negrita, cursiva, tachado, código en línea y en bloque,
 * enlaces, imágenes, listas (orden./desord.), citas, reglas y párrafos.
 *
 * Expone: MDV.parse(markdownString) -> htmlString
 */
(() => {
  "use strict";
  const MDV = (window.MDV = window.MDV || {});

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Sanea una URL antes de meterla en un atributo href/src.
  // El contenido proviene de archivos .md arbitrarios y se inserta con
  // innerHTML, así que bloqueamos esquemas peligrosos (javascript:, data:,
  // vbscript:...) y neutralizamos las comillas para no romper el atributo.
  const SAFE_SCHEMES = ["http", "https", "mailto", "tel"];
  function sanitizeUrl(url) {
    const raw = String(url).trim();
    const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme && !SAFE_SCHEMES.includes(scheme[1].toLowerCase())) return "#";
    return raw.replace(/"/g, "%22");
  }

  // Formato en línea sobre texto YA escapado.
  function inline(text) {
    return text
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        (_, alt, src) => `<img alt="${alt}" src="${sanitizeUrl(src)}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        (_, txt, href) => `<a href="${sanitizeUrl(href)}" target="_blank" rel="noopener noreferrer">${txt}</a>`)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  }

  /* ----- soporte de tablas (GFM) ----- */
  // Divide una fila "| a | b |" en celdas, sin los pipes de los extremos.
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  }
  // Fila separadora: |---|:--:| ... (requiere pipe, así no choca con <hr>).
  function isSeparatorRow(line) {
    if (!line.includes("|")) return false;
    const cells = splitRow(line);
    return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
  }
  function alignOf(cell) {
    const l = cell.startsWith(":"), r = cell.endsWith(":");
    if (l && r) return "center";
    if (r) return "right";
    if (l) return "left";
    return "";
  }
  // ¿La línea actual + la siguiente forman una cabecera de tabla?
  function isTableStart(line, next) {
    return !!line && line.includes("|") && next != null && isSeparatorRow(next);
  }
  function alignAttr(a) { return a ? ` style="text-align:${a}"` : ""; }

  function parse(src) {
    const lines = escapeHtml(String(src).replace(/\r\n?/g, "\n")).split("\n");
    const html = [];
    let i = 0;
    let listType = null; // "ul" | "ol" | null
    const closeList = () => {
      if (listType) { html.push(`</${listType}>`); listType = null; }
    };

    while (i < lines.length) {
      const line = lines[i];

      // Bloque de código cercado ```
      if (/^\s*```/.test(line)) {
        closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; // saltar cierre
        html.push(`<pre><code>${buf.join("\n")}</code></pre>`);
        continue;
      }

      // Línea en blanco
      if (/^\s*$/.test(line)) { closeList(); i++; continue; }

      // Regla horizontal
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        closeList(); html.push("<hr>"); i++; continue;
      }

      // Headings
      const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h) {
        closeList();
        const lvl = h[1].length;
        html.push(`<h${lvl}>${inline(h[2].trim())}</h${lvl}>`);
        i++; continue;
      }

      // Cita
      if (/^\s*>\s?/.test(line)) {
        closeList();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        }
        html.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
        continue;
      }

      // Lista desordenada
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; }
        html.push(`<li>${inline(ul[1])}</li>`);
        i++; continue;
      }

      // Lista ordenada
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ol) {
        if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; }
        html.push(`<li>${inline(ol[1])}</li>`);
        i++; continue;
      }

      // Tabla (GFM): cabecera + fila separadora + cuerpo
      if (isTableStart(line, lines[i + 1])) {
        closeList();
        const headers = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map(alignOf);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
          rows.push(splitRow(lines[i++]));
        }
        const th = headers
          .map((c, k) => `<th${alignAttr(aligns[k])}>${inline(c)}</th>`).join("");
        const body = rows
          .map((cells) => `<tr>${headers
            .map((_, k) => `<td${alignAttr(aligns[k])}>${inline(cells[k] || "")}</td>`)
            .join("")}</tr>`).join("");
        html.push(`<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`);
        continue;
      }

      // Párrafo (junta líneas consecutivas)
      closeList();
      const para = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^\s*```/.test(lines[i]) &&
        !/^\s*(#{1,6})\s+/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
        !isTableStart(lines[i], lines[i + 1])
      ) {
        para.push(lines[i++].trim());
      }
      html.push(`<p>${inline(para.join(" "))}</p>`);
    }

    closeList();
    return html.join("\n");
  }

  MDV.parse = parse;
})();
