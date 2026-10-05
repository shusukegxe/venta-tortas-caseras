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

## Activar pedidos reales — opción C: servidor propio en Render (gratis)

La versión clásica: un servidor Express tuyo corriendo en el free tier de Render
(misma lógica y contrato que el Worker). Se duerme tras 15 min sin tráfico y
despierta solo (~30 s el primer pedido tras la siesta).

1. Crea el token fino (solo `venta-tortas-caseras`, Contents: Read & write).
2. [dashboard.render.com](https://dashboard.render.com) → New + → **Blueprint** → elige este repo
   (lee el `render.yaml` de la raíz) → rellena `TOKEN_SECRETO` y `GITHUB_TOKEN` → Create.
3. Copia la URL `https://tortas-puerta.onrender.com` → en `js/pedidos.js`:
   `CONFIG.tipo = 'appsscript'` y `CONFIG.endpoint = 'https://tortas-puerta.onrender.com/pedidos'` → push.

Truco para que nunca duerma: un monitor gratis de [UptimeRobot](https://uptimerobot.com)
punteando la URL cada 5 minutos.

## Activar pedidos reales — opción 0: Cloudflare Worker (GitHub puro, instantáneo)

La más "GitHub": el Worker (gratis, 5 min) es la única pieza con credenciales —
recibe el POST del checkout, valida contra el catálogo y hace **commit directo**
a `data/pedidos.json` y `/uploads` vía la API de GitHub. Sin Google, sin correo,
sin retardo; el repo sigue siendo la única base de datos.

1. Crea el token fino (solo `venta-tortas-caseras`, Contents: Read & write).
2. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create Worker → pega `cloudflare-worker/worker.js`.
3. Settings → Variables and Secrets: `GITHUB_TOKEN` (el token) y `TOKEN_SECRETO`
   (la misma palabra que `CONFIG.token` en `js/pedidos.js`).
4. Deploy → copia la URL `*.workers.dev` → en `js/pedidos.js`:
   `CONFIG.tipo = 'appsscript'` y `CONFIG.endpoint = 'https://...workers.dev'` → push.

## Activar pedidos reales — opción A: sin Apps Script (FormSubmit + bandeja)

1. En `js/pedidos.js` pon `CONFIG.tipo = 'formsubmit'` y `CONFIG.endpoint = 'https://formsubmit.co/ajax/TUCORREO@gmail.com'` → push.
2. Haz un pedido de prueba: FormSubmit enviará un **correo de activación** a tu Gmail → clic en el enlace (solo una vez).
3. Google: crea una **contraseña de aplicación** en myaccount.google.com/apppasswords (requiere 2FA activado).
4. En Gmail web: ⚙️ → Ver toda la configuración → Reenvío y correo POP/IMAP → habilita **IMAP**.
5. Secrets del repo (`Settings → Secrets and variables → Actions`): `CORREO_USUARIO` = tu Gmail, `CORREO_CLAVE_APP` = la contraseña de aplicación.
6. Listo: el workflow **bandeja** revisa el buzón cada 5 minutos e integra los pedidos a `data/pedidos.json`; el workflow **pedidos** hace el resto (validación, pedidos.md, Discord opcional, manager y cocina).

Límites: el ID real (O-XXXX) lo asigna la bandeja (el cliente ve su `REF-...`), el retardo es de hasta 5 minutos y las imágenes de referencia no viajan (necesitan escritura al repo; usa la opción B si las quieres).

## Activar pedidos reales — opción B: con Apps Script (instantáneo + imágenes)

1. Sigue los comentarios de `google-apps-script/Code.gs`: pégalo en
   [script.google.com](https://script.google.com), configura `SECRETO`,
   `EMAIL_NEGOCIO`, `GITHUB_REPO` y el `GITHUB_TOKEN` (fine-grained PAT con
   Contents: read/write **solo a este repo**) en Script Properties.
2. Implementa como aplicación web ("cualquier usuario") y copia la URL.
3. En `js/pedidos.js` pon `CONFIG.tipo = 'appsscript'`, pega la URL en
   `CONFIG.endpoint` (y el mismo `SECRETO` en `CONFIG.token`). Push y listo.

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
.github/workflows/    pedidos (valida/anuncia) y bandeja (correo → repo)
cloudflare-worker/   puerta de pedidos vía API de GitHub (opción 0)
render-gateway/      puerta de pedidos como servidor Express (opción C)
render.yaml          blueprint de despliegue de la opción C
.github/avisar-discord.mjs   el anuncio de Discord del workflow pedidos
.github/bandeja.py           integra los pedidos que llegan por correo
```

## Notas

- Los precios del catálogo viven en tres lugares sincronizados: `index.html`,
  `js/pedidos.js` y `google-apps-script/Code.gs` (y el workflow los usa para
  validar). Cambiar un precio = cambiarlos ahí.
- `data/pedidos.json` es público (el repo es público). Para producción con datos
  reales de clientes, muévelo a un repo privado o redacta teléfonos.
