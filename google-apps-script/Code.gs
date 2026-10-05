/**
 * Tortas · Hechas a Mano — mini-API de pedidos (Google Apps Script, gratis).
 *
 * ACTIVACIÓN (una sola vez, ~5 minutos):
 * 1. script.google.com → Nuevo proyecto → pega este archivo completo.
 * 2. En el engranaje (Configuración del proyecto) activa "Mostrar appsscript.json"
 *    y agrega los scopes: spreadsheets, gmail.send (o usa los predeterminados al autorizar).
 * 3. Configura abajo: SECRETO (el mismo que pondrás en js/pedidos.js), EMAIL_NEGOCIO,
 *    GITHUB_REPO y en Script Properties (Engranaje → Propiedades del proyecto):
 *    GITHUB_TOKEN = un fine-grained PAT con acceso Contents: Read & write SOLO a ese repo.
 * 4. Ejecuta "crearHoja" una vez (autoriza permisos).
 * 5. Implementar → Nueva implementación → Aplicación web → Ejecutar como: yo,
 *    Acceso: cualquier usuario → copia la URL.
 * 6. Pega la URL en CONFIG.endpoint dentro de js/pedidos.js y haz push.
 *
 * Flujo: el checkout del sitio hace POST aquí → se valida y recalcula el total
 * contra el catálogo de abajo (anti-manipulación) → se guarda en la hoja de
 * cálculo → email al negocio → commit de data/pedidos.json en GitHub, cuyo push
 * dispara el workflow .github/workflows/pedidos.yml.
 */

const SECRETO = 'cambia-este-token';          // igual al CONFIG.token de js/pedidos.js
const EMAIL_NEGOCIO = 'tu-correo@gmail.com';   // aquí llegan los pedidos
const GITHUB_REPO = 'shusukegxe/venta-tortas-caseras';
const HOJA_NOMBRE = 'Pedidos';

// misma lista que js/pedidos.js — el total se recalcula aquí, no se confía en el cliente
// precios realistas de Lima en soles, por tamaño (P/M/G); la personalizada es "desde"
const CATALOGO = {
  p1: { nombre: 'Selva Negra', precios: { P: 52, M: 72, G: 95 } },
  p2: { nombre: 'Tres Leches', precios: { P: 48, M: 68, G: 89 } },
  p3: { nombre: 'Cheesecake', precios: { P: 55, M: 78, G: 102 } },
  p4: { nombre: 'Torta de Chantilly', precios: { P: 45, M: 62, G: 82 } },
  p5: { nombre: 'Personalizada', desde: 120 },
};

function json(salida) {
  return ContentService.createTextOutput(JSON.stringify(salida)).setMimeType(ContentService.MimeType.JSON);
}

function crearHoja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(HOJA_NOMBRE);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_NOMBRE);
    hoja.appendRow(['id', 'fecha', 'nombre', 'teléfono', 'dirección', 'fecha entrega', 'artículos', 'total', 'pago', 'mensaje', 'estado']);
  }
  return hoja;
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== SECRETO) return json({ ok: false, error: 'token inválido' });
    if (!Array.isArray(d.items) || !d.items.length) return json({ ok: false, error: 'carrito vacío' });

    // revalidación en servidor: precios del catálogo, nunca los que manda el cliente
    const items = d.items.map(it => {
      const p = CATALOGO[it.pid];
      if (!p) throw new Error('producto desconocido: ' + it.pid);
      const qty = Math.max(1, Math.min(20, Number(it.qty) || 1));
      if (p.desde) {
        // personalizada: descripción obligatoria + imágenes a /uploads
        if (!it.descripcion || String(it.descripcion).trim().length < 10)
          throw new Error('la torta personalizada necesita descripción');
        const item = { pid: it.pid, nombre: p.nombre, precio: p.desde, qty, descripcion: String(it.descripcion).slice(0, 600), images: [] };
        (Array.isArray(it.images) ? it.images.slice(0, 3) : []).forEach((dataUrl, i) => {
          const m = new RegExp('^data:image\\/(jpeg|png);base64,(.+)$').exec(String(dataUrl));
          if (m && idOrden) item.images.push(subirImagen(idOrden, i, m[2]));
        });
        return item;
      }
      const tam = ['P', 'M', 'G'].includes(it.tam) ? it.tam : 'M';
      return { pid: it.pid, nombre: p.nombre, tam, precio: p.precios[tam], qty };
    });
    const total = items.reduce((s, it) => s + it.precio * it.qty, 0);
    const c = d.cliente || {};
    if (!c.nombre || !c.telefono || !c.direccion) return json({ ok: false, error: 'faltan datos del cliente' });

    // id correlativo (necesario antes de guardar imágenes en /uploads)
    const props = PropertiesService.getScriptProperties();
    const seq = Number(props.getProperty('seq') || '1');
    props.setProperty('seq', String(seq + 1));
    const id = 'O-' + String(seq).padStart(4, '0');
    var idOrden = id;

    const ahora = new Date();
    const orden = {
      id,
      customer: { name: c.nombre, phone: c.telefono, address: c.direccion, note: c.mensaje || '' },
      items,
      total,
      payMethod: d.pago === 'efectivo' ? 'efectivo' : 'transferencia',
      payStatus: 'pendiente',
      status: 'nuevo',
      deliveryDate: c.fecha || '',
      createdAt: ahora.getTime(),
      history: [{ status: 'nuevo', at: ahora.getTime() }],
    };

    // 1) hoja de cálculo (la vista del negocio, funciona en cualquier dispositivo)
    crearHoja().appendRow([
      id, ahora.toLocaleString('es'), c.nombre, c.telefono, c.direccion, c.fecha || '',
      items.map(it => `${it.qty}× ${it.nombre}`).join(', '),
      total, orden.payMethod, c.mensaje || '', 'nuevo',
    ]);

    // 2) email inmediato al negocio (html bonito + texto plano de respaldo)
    const filas = items.map(it =>
      `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee">${it.qty}× ${it.nombre}${it.tam ? ' (' + it.tam + ')' : ''}` +
      (it.descripcion ? `<br><span style="color:#7a5c45;font-size:12px">${it.descripcion}</span>` : '') +
      (it.images && it.images.length ? `<br><span style="color:#7a5c45;font-size:12px">imágenes: ${it.images.map(r => 'https://raw.githubusercontent.com/' + GITHUB_REPO + '/main/' + r).join(' · ')}</span>` : '') +
      `</td><td align="right" style="padding:7px 10px;border-bottom:1px solid #eee">S/ ${(it.precio * it.qty).toFixed(2)}</td></tr>`).join('');
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:540px;color:#4a3728">
        <h2 style="margin:0 0 4px">Pedido ${id}</h2>
        <p style="margin:0 0 14px;color:#7a5c45">Tortas · Hechas a Mano — ${ahora.toLocaleString('es')}</p>
        <p><b>${c.nombre}</b> · ${c.telefono}<br>${c.direccion}<br>Entrega: <b>${c.fecha || 'por coordinar'}</b></p>
        <table style="border-collapse:collapse;width:100%">${filas}</table>
        <p style="font-size:16px"><b>Total: S/ ${total.toFixed(2)}</b> · ${orden.payMethod}</p>
        ${c.mensaje ? `<p style="background:#fff8ee;border:1px solid #e8d5b7;border-radius:8px;padding:10px">Mensaje en la torta: "${c.mensaje}"</p>` : ''}
      </div>`;
    MailApp.sendEmail(
      EMAIL_NEGOCIO,
      `Pedido ${id} — ${c.nombre} (S/ ${total.toFixed(2)})`,
      `Pedido ${id}\nCliente: ${c.nombre} — ${c.telefono}\nDirección: ${c.direccion}\nEntrega: ${c.fecha || 'lo antes posible'}\n\n` +
      items.map(it => `${it.qty}× ${it.nombre}${it.tam ? ' (' + it.tam + ')' : ''} — ${it.precio * it.qty}`).join('\n') +
      `\n\nTotal: S/ ${total.toFixed(2)} (${orden.payMethod})\nMensaje: ${c.mensaje || '—'}`,
      { htmlBody }
    );

    // 3) commit de data/pedidos.json → dispara el workflow de GitHub
    commitGitHub(orden);

    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// guarda una imagen (base64 jpeg/png) en /uploads del repo y devuelve su ruta pública
function subirImagen(idOrden, indice, base64) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return null;
  const path = 'uploads/' + idOrden + '-' + (indice + 1) + '.jpg';
  const api = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + path;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  let sha = null;
  const resp = UrlFetchApp.fetch(api, { headers, muteHttpExceptions: true });
  if (resp.getResponseCode() === 200) sha = JSON.parse(resp.getContentText()).sha;
  UrlFetchApp.fetch(api, {
    method: 'put', headers, contentType: 'application/json',
    payload: JSON.stringify({ message: 'imagen de pedido ' + idOrden + ' [pedidos]', content: base64, sha }),
    muteHttpExceptions: true,
  });
  return path;
}

// agrega la orden al arreglo de data/pedidos.json (GET → mezclar → PUT)
function commitGitHub(orden) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return; // sin token, el pedido queda en hoja+email y nada más
  const path = 'data/pedidos.json';
  const api = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + path;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };

  let lista = [], sha = null;
  const resp = UrlFetchApp.fetch(api, { headers, muteHttpExceptions: true });
  if (resp.getResponseCode() === 200) {
    const actual = JSON.parse(resp.getContentText());
    sha = actual.sha;
    try { lista = JSON.parse(Utilities.newBlob(Utilities.base64Decode(actual.content)).getDataAsString()); } catch { lista = []; }
  }
  lista.unshift(orden);
  if (lista.length > 200) lista.length = 200;

  UrlFetchApp.fetch(api, {
    method: 'put',
    headers,
    contentType: 'application/json',
    payload: JSON.stringify({
      message: 'pedido ' + orden.id + ' [pedidos]',
      content: Utilities.base64Encode(JSON.stringify(lista, null, 2), Utilities.Charset.UTF_8),
      sha,
    }),
    muteHttpExceptions: true,
  });
}
