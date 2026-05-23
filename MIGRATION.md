# FreshWays Pro — Migración a TypeScript + Vite

Guía completa de la arquitectura nueva, qué cambió, por qué y cómo poner en marcha el proyecto.

---

## 1. Estructura de carpetas

```
freshways-pro/
├── index.html                  ← HTML principal (limpio, sin scripts inline de lógica)
├── vite.config.ts              ← Configuración de Vite
├── tsconfig.json               ← TypeScript estricto
├── package.json
├── .env.example                ← Plantilla de variables de entorno
├── .eslintrc.cjs               ← ESLint + TypeScript
├── .prettierrc                 ← Prettier
├── .gitignore
│
├── public/                     ← Assets estáticos copiados tal cual al build
│   ├── sw.js                   ← Service Worker (NO procesado por Vite)
│   ├── manifest.json
│   └── icons/
│       ├── 72.png
│       ├── 192.png
│       └── 512.png
│
└── src/
    ├── main.ts                 ← Punto de entrada único (orquestador)
    │
    ├── types/
    │   └── index.ts            ← Todos los tipos e interfaces compartidos
    │
    ├── config/
    │   └── constants.ts        ← API_BASE, STORAGE_KEY, timeouts, etc.
    │
    ├── services/
    │   ├── api.ts              ← Cliente HTTP tipado para el Worker D1
    │   ├── productCache.ts     ← Caché en memoria + localStorage
    │   └── historyService.ts   ← Historial local + sync D1
    │
    ├── state/
    │   └── appState.ts         ← Estado global de la app
    │
    ├── utils/
    │   ├── math.ts             ← safeEval, pickBestFormula, computeCrateCalc…
    │   ├── dom.ts              ← make(), fitText(), haptic(), esc()…
    │   ├── clipboard.ts        ← copyToClipboard(), pasteFromClipboard()
    │   └── format.ts           ← formatHistoryAllDate(), transformValuesInput()
    │
    ├── components/
    │   ├── calculator.ts       ← press(), del(), cls(), refresh()…
    │   ├── navigation.ts       ← switchTab(), teclado global
    │   ├── msj.ts              ← showMsj(), toggleRotation()
    │   ├── pwa.ts              ← Service Worker, banner de instalación, offline
    │   │
    │   ├── sped/
    │   │   └── index.ts        ← Flujo completo SPED (búsqueda → resultado)
    │   │
    │   ├── history/
    │   │   ├── panel.ts        ← Panel de historial del día
    │   │   └── historyAll.ts   ← Panel de audit log en la nube (D1)
    │   │
    │   └── products-panel/
    │       └── index.ts        ← Panel CRUD de productos (reemplaza products-panel.js)
    │
    └── styles/
        ├── styles.css          ← Copia directa de tu styles.css original
        └── products-panel.css  ← Copia directa de tu products-panel.css original
```

---

## 2. Puesta en marcha

### Instalar dependencias
```bash
npm install
```

### Variables de entorno
```bash
cp .env.example .env.local
# Editar .env.local con los valores reales
```

### Desarrollo local
```bash
npm run dev
# Abre http://localhost:3000
# Las llamadas a /api/* se proxean al Worker de Cloudflare automáticamente
```

### Verificar tipos
```bash
npm run type-check
```

### Build de producción
```bash
npm run build
# Salida en /dist — listo para subir a Cloudflare Pages
```

### Preview del build
```bash
npm run preview
```

---

## 3. Deploy en Cloudflare Pages

1. Conecta el repositorio en Cloudflare Pages.
2. **Build command:** `npm run build`
3. **Build output directory:** `dist`
4. **Environment variables** (en el dashboard de Pages):
   - `VITE_API_BASE` = `https://freshways-api.soychristophe.workers.dev`
   - `VITE_DELETE_PIN` = tu PIN real

---

## 4. Qué cambió y por qué

### 4.1 `API_BASE` hardcodeado → variable de entorno

**Antes:**
```js
const API_BASE = 'https://freshways-api.soychristophe.workers.dev';
```
**Ahora:**
```ts
// src/config/constants.ts
export const API_BASE = import.meta.env['VITE_API_BASE'] ?? '...';
```
**Por qué:** Nunca hardcodees URLs de producción en el código. Con `.env.local` puedes apuntar a un entorno de staging sin tocar el código.

---

### 4.2 PIN de borrado hardcodeado → variable de entorno

**Antes (`products-panel.js`):**
```js
if (pin !== '1986') { ... }
```
**Ahora:**
```ts
// src/config/constants.ts
export const DELETE_PIN = import.meta.env['VITE_DELETE_PIN'] ?? '1986';
```
**Por qué:** Un PIN en el código fuente queda expuesto en el historial de git. Con una variable de entorno puedes rotarlo sin commit.

---

### 4.3 Variables globales → módulos ES

**Antes:**
```js
// script.js expone en window:
Object.assign(window, { API_BASE, refreshProductCache, switchTab, ... });
// products-panel.js las consume:
function getApiBase() { return typeof API_BASE !== 'undefined' ? API_BASE : ''; }
```
**Ahora:**
```ts
// products-panel/index.ts importa directamente:
import { API_BASE } from '@/config/constants.ts';
import { refreshProductCache } from '@/services/productCache.ts';
```
**Por qué:** Las globales en `window` no tienen tipos, son invisibles para el compilador y crean dependencias implícitas entre archivos. Los imports ES son explícitos, chequeados por TypeScript y tree-shakeables por Vite.

---

### 4.4 `safeEval` con `Function()` → encapsulado + comentado

**Antes:**
```js
function safeEval(expr) {
  const result = Function('"use strict"; return (' + expr + ')')();
  ...
}
```
**Ahora (`src/utils/math.ts`):** La misma lógica, pero:
- El argumento tiene tipo `string | number`.
- El comentario explica la decisión de seguridad.
- La regla de ESLint `no-new-func` está desactivada solo para esta función con un comentario justificado.
- Si en el futuro quieres eliminar `Function()` completamente, el lugar exacto está claro.

---

### 4.5 `products-panel.js` IIFE → módulo TypeScript propio

**Antes:** Un IIFE de 640 líneas que leía `API_BASE` del scope global y llamaba `window.refreshProductCache?.()`.

**Ahora:** `src/components/products-panel/index.ts`:
- Importa `apiDeleteProduct`, `apiCreateProduct`, etc. directamente.
- Importa `DELETE_PIN` desde constants.
- Importa `refreshProductCache` desde productCache.
- No contamina `window`.
- Tiene tipos completos para todas sus funciones.

---

### 4.6 Código duplicado eliminado

| Duplicación en el original | Solución |
|---|---|
| `esc()` existía dentro del IIFE de products-panel | Movida a `src/utils/dom.ts` y compartida |
| `transformValuesInput()` estaba fuera del IIFE pero dentro del mismo archivo | Movida a `src/utils/format.ts` |
| Lógica de clipboard con toast repetida en varios lugares | `src/utils/clipboard.ts` + `copyToClipboard(text, onSuccess)` |
| `formatHistoryAllDate()` y `renderHistoryAllList()` mezcladas en script.js | Movidas a `historyAll.ts` |
| `showToast` con timer duplicado (script.js para copy-toast, products-panel para pp-toast) | Cada componente gestiona su propio toast; la utilidad `dom.ts` provee el primitivo |

---

### 4.7 `innerHTML` con datos de usuario → DOM seguro

**Antes (`script.js`):**
```js
div.innerHTML =
  '<span class="sug-id">'   + String(match.id) + '</span>' +
  '<span class="sug-name">' + (match.name || '<em>No name</em>') + '</span>';
```
Si `match.id` o `match.name` contuviesen `<script>`, se ejecutaría. Aunque los datos vienen de tu propio D1, es una mala práctica.

**Ahora (`sped/index.ts`):** Construcción con `createElement` + `textContent`. Cero riesgo XSS.

La excepción es `productRow()` en products-panel, que sigue usando `innerHTML` porque los datos pasan por `esc()` antes de insertarse — se documenta en el código.

---

### 4.8 El Service Worker se adapta a Vite

**Antes:** Pre-cacheaba `['./script.js', './products-panel.js', ...]` con nombres fijos.

**Ahora (`public/sw.js`):**
- Pre-cachea solo el shell HTML + iconos + manifest.
- Los assets de `/assets/*.js` y `/assets/*.css` (con hash de Vite) se cachean **lazy** en el primer fetch.
- Cuando Vite genera un nuevo hash en el siguiente deploy, el navegador pide el archivo nuevo → el SW lo cachea → la versión vieja queda huérfana y se limpia en el próximo activate.
- No hay que tocar `CACHE_NAME` en cada deploy.

---

## 5. Problemas detectados en el código original

| Problema | Severidad | Archivo | Solución aplicada |
|---|---|---|---|
| `API_BASE` hardcodeado en código fuente | 🔴 Alta | script.js:4 | Variable de entorno `VITE_API_BASE` |
| PIN `'1986'` hardcodeado | 🔴 Alta | products-panel.js:462 | Variable de entorno `VITE_DELETE_PIN` |
| `window.API_BASE` leído globalmente | 🔴 Alta | products-panel.js:31 | Import directo desde constants.ts |
| XSS potencial en `innerHTML` con datos de API | 🟠 Media | script.js:925 | `createElement` + `textContent` |
| `transformValuesInput()` declarada fuera del IIFE | 🟡 Baja | products-panel.js:342 | Movida a utils/format.ts |
| `historyPanelOpen`, `historyAllEntries` como `let` globales | 🟡 Baja | script.js:246–253 | Encapsuladas en sus módulos |
| `el.spedStep3`, `el.pullErrorStep3`, `el.spedProductInfoPull` inicializados como `null` en el cache | 🟡 Baja | script.js:210–213 | Acceso lazy con `findEl()` |
| `Function()` sin comentario de seguridad | 🟡 Baja | script.js:302 | Documentado + eslint-disable localizado |
| SW re-cacheaba archivos con nombre fijo incompatibles con Vite | 🟡 Baja | sw.js | Estrategia lazy para hashed assets |
| `onclick` inline en HTML para `toggleHistoryAllPanel` | ℹ️ Info | products-panel.js:523 | Evento wired en `bindEvents()` |

---

## 6. Mejoras futuras opcionales

### 6.1 Eliminar `onclick` inline del HTML
Cuando quieras eliminar los últimos `onclick=` del HTML, basta con reemplazarlos por `data-action` y un delegador de eventos en `main.ts`:
```ts
document.addEventListener('click', e => {
  const action = (e.target as HTMLElement).closest('[data-action]')
    ?.getAttribute('data-action');
  if (action) handlers[action]?.();
});
```

### 6.2 Tests unitarios
`src/utils/math.ts` es 100% puro — candidato perfecto para tests con Vitest:
```bash
npm install -D vitest
# luego:
import { pickBestFormula, computeCrateCalc } from '@/utils/math.ts';
```

### 6.3 Parser de expresiones sin `Function()`
Si quieres eliminar el `Function()` de `safeEval`, un parser recursivo de ~60 líneas es suficiente para `+`, `-`, `*`, `/` con paréntesis.

### 6.4 Señal de cancelación en búsquedas
Añadir un `AbortController` al debounce de SPED para cancelar búsquedas en vuelo cuando el usuario sigue escribiendo.

### 6.5 Wrangler para desarrollo offline del Worker
Con `wrangler dev` puedes levantar el Worker D1 localmente. El proxy de Vite (`server.proxy`) ya apunta al puerto correcto.

---

## 7. Qué NO cambió

- **CSS**: `styles.css` y `products-panel.css` se copian a `src/styles/` sin ninguna modificación.
- **HTML**: La estructura del DOM es idéntica. Solo se elimina el `<script src="products-panel.js">` y se cambia `script.js` por el módulo de Vite.
- **Lógica de negocio**: Toda la lógica de SPED, caché, historial y cálculo es la misma, solo tipada y reorganizada.
- **Worker de Cloudflare**: El Worker D1 no se toca. La app sigue consumiendo exactamente las mismas URLs `/api/*`.
- **PWA**: Mantiene compatibilidad completa con instalación en iOS y Android.
