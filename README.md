# Tortas · Hechas a Mano

Sitio de venta de tortas caseras **con pedidos en línea integrados**: el cliente
elige sus tortas, completa el formulario y el pedido viaja al negocio — funciona
entre dispositivos (el cliente pide desde su teléfono, tú lo recibes en el tuyo).

Demo: https://shusukegxe.github.io/venta-tortas-caseras/

## Cómo funciona el pedido

```
cliente (web, cualquier dispositivo)
   │  checkout → POST (JSON firmado con token)
   ▼
mini-API en Google Apps Script (gratis)
   │  1. valida y recalcula el total contra el catálogo (anti-manipulación)
   │  2. guarda el pedido en una hoja de cálculo
   │  3. email inmediato al negocio
   │  4. commit de data/pedidos.json en este repo
   ▼
GitHub Actions (.github/workflows/pedidos.yml)
   │  valida el JSON, recalcula montos y publica data/pedidos.md legible
   ▼
tortas-manager (panel del negocio, cualquier dispositivo)
      lee data/pedidos.json desde Pages cada 30s → el pedido aparece solo
```

- **Sin configurar** el endpoint, el sitio funciona en **modo demo**: el carrito
  guarda en el mismo Store del sistema (`localStorage` + `BroadcastChannel`) y el
  pedido aparece en el panel si lo abres en el mismo navegador.
- **Con el endpoint configurado**, los pedidos viajan de verdad entre dispositivos.

## Activar pedidos reales (una sola vez, ~5 min)

1. Sigue los comentarios de `google-apps-script/Code.gs`: pégalo en
   [script.google.com](https://script.google.com), configura `SECRETO`,
   `EMAIL_NEGOCIO`, `GITHUB_REPO` y el `GITHUB_TOKEN` (fine-grained PAT con
   Contents: read/write **solo a este repo**) en Script Properties.
2. Implementa como aplicación web ("cualquier usuario") y copia la URL.
3. Pega la URL en `CONFIG.endpoint` dentro de `js/pedidos.js` (y el mismo
   `SECRETO` en `CONFIG.token`). Push y listo.

Opcional: notificaciones en vivo extra (Telegram, etc.) agrégalas como paso del
workflow usando secrets del repo.

## Estructura

```
index.html            sitio + sección de pedido
js/pedidos.js         carrito, checkout y envío de la orden
styles.css            estilos (los del sitio + carrito/checkout)
data/pedidos.json     "base de datos" pública de pedidos (la escribe el mini-API)
data/pedidos.md       versión legible que publica el workflow
google-apps-script/   el mini-API de pedidos (pegar en script.google.com)
.github/workflows/    procesa las requests de tortas
```

## Notas

- Los precios del catálogo viven en tres lugares sincronizados: `index.html`,
  `js/pedidos.js` y `google-apps-script/Code.gs` (y el workflow los usa para
  validar). Cambiar un precio = cambiarlos ahí.
- `data/pedidos.json` es público (el repo es público). Para producción con datos
  reales de clientes, muévelo a un repo privado o redacta teléfonos.
