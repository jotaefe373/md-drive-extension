# CLAUDE.md

Guía para trabajar en este repositorio.

## Qué es

Extensión de Chrome (**Manifest V3**) que mejora la vista previa de archivos
Markdown en `drive.google.com`. Cuando se abre un `.md`, intercepta la vista
previa nativa de texto plano, extrae el texto del DOM, lo renderiza como
Markdown con formato limpio y lo superpone a pantalla completa **dentro de la
misma pestaña**.

Incluye visor con ajustes (tema, tipografía, tamaño, ancho), un editor de
borrador local y navegación entre archivos con las flechas ← →.

## Restricción de diseño central

**Todo se hace por inyección de DOM / content scripts. NO se usa la Google
Drive API ni OAuth.** Consecuencias que hay que tener presentes:

- El contenido se **lee** del DOM de la vista previa (solo lectura).
- El editor **no guarda en Drive**: solo permite copiar y descargar `.md`.
  Cualquier "guardado real" exigiría Drive API + OAuth + Google Cloud, que
  está deliberadamente fuera de alcance.
- La detección y la navegación dependen del HTML (ofuscado) de Drive, así que
  son **inherentemente frágiles** ante cambios de Google.

## Estructura

```
manifest.json        Manifest V3. Permisos: host drive.google.com + storage.
styles.css           Apariencia. ÚNICA fuente de verdad visual (variables CSS).
src/
  parser.js    →  MDV.parse(md) -> html           parser Markdown sin deps
  settings.js  →  MDV.settings                     preferencias + chrome.storage
  ui.js        →  MDV.ui.createViewer(...)          overlay, toolbar, editor, sidebar
  main.js      →  orquestación                      observer, detección, navegación
```

### Namespace compartido

No hay bundler ni `import`. Los content scripts corren en el mismo *isolated
world*, así que cada módulo cuelga su API de `window.MDV`. **Orden de carga
en `manifest.json`** importa: `parser → settings → ui → main`.

### Flujo

1. `main.js` monta un `MutationObserver` sobre `document` (debounce 300 ms).
2. `tryRender()` detecta contexto `.md` y localiza el nodo de texto plano
   (`findPlainTextNode`, busca `<pre>` visible y *fallbacks*).
3. Crea el overlay con `MDV.ui.createViewer({ raw, fileName, onClose })`.
4. La identidad del documento es una **firma por contenido**
   (`docSignature` = nombre + longitud + muestra), porque Drive **no cambia la
   URL** al previsualizar otro archivo de la misma carpeta.
5. Navegación ← →: `navigate()` reutiliza la nav nativa de Drive (clic en
   botón o tecla simulada) y el observer refresca el overlay con
   `viewer.update()` **en sitio**, sin recrearlo.
6. Sidebar (botón ☰): `collectMarkdownFiles()` descubre los `.md` del DOM de
   la carpeta y `openMarkdownFile()` los abre simulando doble clic.
   **FRÁGIL**: depende del DOM de Drive; si está vacío, el `.md` se abrió sin
   carpeta. Si el clic no abre, Drive puede estar rechazando el evento
   sintético (`isTrusted:false`) — afinar con el `aria-label`/estructura real.

Nota sobre eventos sintéticos: el listener global de `keydown` ignora
`!e.isTrusted` para no reinterceptar las flechas que `dispatchArrow()` emite
hacia Drive (provocaba recursión infinita).

## Convenciones

- **Apariencia solo vía variables CSS** en `styles.css`. `settings.applyTo()`
  inyecta `--mdv-*` y `data-theme`; nunca poner estilos visuales en JS.
- Añadir un ajuste nuevo = 1 entrada en `settings.DEFAULTS` + 1 control en
  `ui.buildSettingsPanel` + 1 variable/uso en `styles.css`.
- Construir DOM con el helper `h()` de `ui.js` (legible y consistente).
- Prefijo `mdv-` / `MDV` en todo (IDs, clases, namespace) para no colisionar
  con el DOM de Drive.

## Trabajo conocido pendiente (backlog)

Hecho:

- [x] **Seguridad**: `sanitizeUrl` en `parser.js` (lista blanca de esquemas,
  bloqueo de `javascript:`/`data:`, comillas neutralizadas).
- [x] **Tablas GFM** en el parser, con alineación por columna.
- [x] **Debounce del editor** (150 ms) al teclear.

Pendiente, por prioridad:

1. Parser básico: listas anidadas, task lists `- [ ]`, front-matter YAML,
   falso positivo de cursiva en `snake_case`.
2. Aviso al perder edits locales al navegar con flechas.
3. **Rendimiento del observador**: el `MutationObserver` vigila todo el
   `document` de Drive en continuo. Un intento de desconectarlo con el overlay
   abierto + sondeo (`refreshAfterNav`) **rompió la navegación con flechas**
   (eliminaba el overlay por timeout) y se revirtió. Si se reintenta, hacerlo
   con un observador **acotado** al contenedor de la vista previa, nunca con
   timeout que elimine el overlay. La navegación fiable depende de que el
   observador esté siempre conectado.
4. Pulido: iconos en el manifest, i18n, gestión de foco/accesibilidad.

## Probar

No hay build ni tests. Cargar en modo desarrollador:

1. `chrome://extensions` → activar **Modo de desarrollador**.
2. **Cargar descomprimida** → seleccionar la carpeta del repo.
3. Tras cada cambio: botón **↻** en la tarjeta de la extensión.
4. Abrir un `.md` en Drive (doble clic). Validar siempre contra Drive real:
   el render, las flechas ← → y el cambio entre archivos dependen del DOM vivo.

Sanity check de sintaxis sin navegador:
`node --check src/<archivo>.js` y `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"`.

## Convención de commits

- **Nunca** añadir a Claude como co-autor ni `Co-Authored-By` de Claude en los
  mensajes de commit.
