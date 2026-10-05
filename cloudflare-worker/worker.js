// Tortas · Hechas a Mano — puerta de pedidos (Cloudflare Worker, gratis).
// GitHub no acepta escrituras anónimas y el token no puede vivir en una página
// pública: este Worker es la única pieza con credenciales. Recibe el POST del
// checkout, valida contra el catálogo y hace commit directo a data/pedidos.json
// (y a /uploads si hay imágenes) vía la API de GitHub. El push dispara el
// workflow "pedidos" — el repo sigue siendo la única base de datos.
//
// Despliegue (5 min): dash.cloudflare.com → Workers & Pages → Create Worker →
// pega este archivo → Settings → Variables and Secrets:
//   TOKEN_SECRETO  = la misma palabra que CONFIG.token en js/pedidos.js
//   GITHUB_TOKEN   = fine-grained PAT: solo venta-tortas-caseras, Contents: Read & write
// → Deploy → copia la URL *.workers.dev → en js/pedidos.js:
//   CONFIG.tipo = 'appsscript'; CONFIG.endpoint = 'https://...workers.dev';

const REPO = 'shusukegxe/venta-tortas-caseras';

// mismos precios que js/pedidos.js — el total lo decide aquí, no el cliente
const CATALOGO = {
  p1: { nombre: 'Selva Negra', precios: { P: 52, M: 72, G: 95 } },
  p2: { nombre: 'Tres Leches', precios: { P: 48, M: 68, G: 89 } },
  p3: { nombre: 'Cheesecake', precios: { P: 55, M: 78, G: 102 } },
  p4: { nombre: 'Torta de Chantilly', precios: { P: 45, M: 62, G: 82 } },
  p5: { nombre: 'Personalizada', desde: 120 },
};
const TAMOK = ['P', 'M', 'G'];

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const gh = token => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });
const base64 = s => { const b = new TextEncoder().encode(s); let t = ''; for (const x of b) t += String.fromCharCode(x); return btoa(t); };

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return json({ ok: false, error: 'solo POST' }, 405);
    const d = await request.json().catch(() => null);
    const token = env.GITHUB_TOKEN;
    if (!token) return json({ ok: false, error: 'falta GITHUB_TOKEN en el Worker' }, 500);
    if (!d || d.token !== env.TOKEN_SECRETO) return json({ ok: false, error: 'token inválido' }, 401);
    if (!Array.isArray(d.items) || !d.items.length) return json({ ok: false, error: 'carrito vacío' });

    try {
      const c = d.cliente || {};
      if (!c.nombre || !c.telefono || !c.direccion) return json({ ok: false, error: 'faltan datos del cliente' });

      // id correlativo leyendo el archivo actual
      const api = `https://api.github.com/repos/${REPO}/contents/data/pedidos.json`;
      let lista = [], sha = null;
      const resp = await fetch(api, { headers: gh(token) });
      if (resp.ok) {
        const cur = await resp.json();
        sha = cur.sha;
        lista = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cur.content.replace(/\n/g, '')), ch => ch.charCodeAt(0))));
      }
      const nums = lista.map(o => parseInt((o.id || 'O-0').slice(2), 10) || 0);
      const id = 'O-' + String(Math.max(0, ...nums) + 1).padStart(4, '0');

      // valida contra el catálogo; imágenes base64 → /uploads/{id}-n.jpg
      const items = [];
      for (const it of d.items) {
        const p = CATALOGO[it.pid];
        if (!p) return json({ ok: false, error: 'producto desconocido: ' + it.pid });
        const qty = Math.max(1, Math.min(20, Number(it.qty) || 1));
        if (p.desde) {
          if (!it.descripcion || String(it.descripcion).trim().length < 10)
            return json({ ok: false, error: 'la torta personalizada necesita descripción' });
          const item = { pid: it.pid, nombre: p.nombre, precio: p.desde, qty, descripcion: String(it.descripcion).slice(0, 600), images: [] };
          for (const [i, dataUrl] of (Array.isArray(it.images) ? it.images.slice(0, 3) : []).entries()) {
            const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(String(dataUrl));
            if (!m) continue;
            const path = `uploads/${id}-${i + 1}.jpg`;
            const up = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
              method: 'PUT', headers: { ...gh(token), 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: `imagen de pedido ${id} [pedidos]`, content: m[2] }),
            });
            if (up.ok) item.images.push(path);
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
          content: base64(JSON.stringify(lista, null, 2)),
          sha,
        }),
      });
      if (!put.ok) return json({ ok: false, error: 'github rechazó el commit: ' + (await put.text()).slice(0, 120) }, 502);
      return json({ ok: true, id });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) }, 500);
    }
  },
};
