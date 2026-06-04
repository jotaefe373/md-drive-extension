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
        !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])
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
