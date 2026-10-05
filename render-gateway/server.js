'use strict';
/* Tortas · Hechas a Mano — puerta de pedidos para Render (free tier).
   Misma lógica y contrato que cloudflare-worker/worker.js (respuesta {ok, id}),
   pero como servidor Express clásico: se duerme tras 15 min de inactividad y
   despierta solo en ~30 s. La lógica vive duplicada del Worker — si cambian los
   precios, cambiarlos aquí, en el Worker, en js/pedidos.js y en Code.gs.

   Deploy en Render: New + → Blueprint → este repo (lee render.yaml) → rellena
   TOKEN_SECRETO y GITHUB_TOKEN (fine-grained: solo este repo, Contents Read &
   write) → Create. Copia la URL https://...onrender.com → en js/pedidos.js:
   CONFIG.tipo = 'appsscript'; CONFIG.endpoint = 'https://...onrender.com/pedidos'; */

const express = require('express');

const REPO = process.env.GITHUB_REPO || 'shusukegxe/venta-tortas-caseras';

// mismos precios que js/pedidos.js — el total lo decide aquí, no el cliente
const CATALOGO = {
  p1: { nombre: 'Selva Negra', precios: { P: 52, M: 72, G: 95 } },
  p2: { nombre: 'Tres Leches', precios: { P: 48, M: 68, G: 89 } },
  p3: { nombre: 'Cheesecake', precios: { P: 55, M: 78, G: 102 } },
  p4: { nombre: 'Torta de Chantilly', precios: { P: 45, M: 62, G: 82 } },
  p5: { nombre: 'Personalizada', desde: 120 },
};
const TAMOK = ['P', 'M', 'G'];

const gh = token => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });

async function subirImagen(token, id, indice, dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(String(dataUrl));
  if (!m) return null;
  const path = `uploads/${id}-${indice + 1}.jpg`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { ...gh(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `imagen de pedido ${id} [pedidos]`, content: m[2] }),
  });
  return res.ok ? path : null;
}

async function crearPedido(d, token) {
  const c = d.cliente || {};
  if (!c.nombre || !c.telefono || !c.direccion) throw new Error('faltan datos del cliente');

  // id correlativo leyendo el archivo actual (GET → mezclar → PUT)
  const api = `https://api.github.com/repos/${REPO}/contents/data/pedidos.json`;
  let lista = [], sha = null;
  const resp = await fetch(api, { headers: gh(token) });
  if (resp.ok) {
    const cur = await resp.json();
    sha = cur.sha;
    lista = JSON.parse(Buffer.from(cur.content.replace(/\n/g, ''), 'base64').toString('utf8'));
  }
  const nums = lista.map(o => parseInt((o.id || 'O-0').slice(2), 10) || 0);
  const id = 'O-' + String(Math.max(0, ...nums) + 1).padStart(4, '0');

  // valida contra el catálogo; el precio lo decide aquí, no el cliente
  const items = [];
  for (const it of d.items) {
    const p = CATALOGO[it.pid];
    if (!p) throw new Error('producto desconocido: ' + it.pid);
    const qty = Math.max(1, Math.min(20, Number(it.qty) || 1));
    if (p.desde) {
      if (!it.descripcion || String(it.descripcion).trim().length < 10)
        throw new Error('la torta personalizada necesita descripción');
      const item = { pid: it.pid, nombre: p.nombre, precio: p.desde, qty, descripcion: String(it.descripcion).slice(0, 600), images: [] };
      for (const [i, dataUrl] of (Array.isArray(it.images) ? it.images.slice(0, 3) : []).entries()) {
        const ruta = await subirImagen(token, id, i, dataUrl);
        if (ruta) item.images.push(ruta);
      }
      items.push(item);
      continue;
    }
    const tam = TAMOK.includes(it.tam) ? it.tam : 'M';
    items.push({ pid: it.pid, nombre: p.nombre, tam, precio: p.precios[tam], qty });
  }
  const total = items.reduce((s, it) => s + it.precio * it.qty, 0);

  const orden = {
    id,
    customer: { name: c.nombre, phone: c.telefono, address: c.direccion, note: c.mensaje || '' },
    items, total,
    payMethod: d.pago === 'efectivo' ? 'efectivo' : 'transferencia',
    payStatus: 'pendiente', status: 'nuevo',
    deliveryDate: c.fecha || '',
    createdAt: Date.now(),
    history: [{ status: 'nuevo', at: Date.now() }],
  };
  lista.unshift(orden);
  if (lista.length > 200) lista.length = 200;

  const put = await fetch(api, {
    method: 'PUT',
    headers: { ...gh(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `pedido ${id} [pedidos]`,
      content: Buffer.from(JSON.stringify(lista, null, 2), 'utf8').toString('base64'),
      sha,
    }),
  });
  if (!put.ok) throw new Error('github rechazó el commit: ' + (await put.text()).slice(0, 120));
  return { ok: true, id };
}

const app = express();
app.use(express.json({ limit: '8mb' }));   // margen para 3 imágenes base64

app.get('/', (req, res) => res.json({ ok: true, servicio: 'puerta de pedidos — Tortas · Hechas a Mano' }));

app.post('/pedidos', async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'falta GITHUB_TOKEN' });
  const d = req.body || {};
  if (d.token !== process.env.TOKEN_SECRETO) return res.status(401).json({ ok: false, error: 'token inválido' });
  if (!Array.isArray(d.items) || !d.items.length) return res.status(400).json({ ok: false, error: 'carrito vacío' });
  try {
    res.json(await crearPedido(d, token));
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

const PUERTO = process.env.PORT || 8978;
app.listen(PUERTO, () => console.log(`puerta de pedidos escuchando en :${PUERTO}`));
