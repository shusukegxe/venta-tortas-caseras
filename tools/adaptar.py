import io

# ---------- Code.gs: catálogo por tamaños + imágenes a /uploads ----------
p = 'google-apps-script/Code.gs'
s = io.open(p, encoding='utf8').read()
old = """// misma lista que js/pedidos.js — el total se recalcula aquí, no se confía en el cliente
const CATALOGO = {
  p1: { nombre: 'Selva Negra', precio: 18000 },
  p2: { nombre: 'Tres Leches', precio: 17000 },
  p3: { nombre: 'Cheesecake', precio: 20000 },
  p4: { nombre: 'Torta de Chantilly', precio: 16500 },
  p5: { nombre: 'Personalizada', precio: 22000 },
};"""
new = """// misma lista que js/pedidos.js — el total se recalcula aquí, no se confía en el cliente
// precios realistas de Lima en soles, por tamaño (P/M/G); la personalizada es "desde"
const CATALOGO = {
  p1: { nombre: 'Selva Negra', precios: { P: 52, M: 72, G: 95 } },
  p2: { nombre: 'Tres Leches', precios: { P: 48, M: 68, G: 89 } },
  p3: { nombre: 'Cheesecake', precios: { P: 55, M: 78, G: 102 } },
  p4: { nombre: 'Torta de Chantilly', precios: { P: 45, M: 62, G: 82 } },
  p5: { nombre: 'Personalizada', desde: 120 },
};"""
assert old in s; s = s.replace(old, new)

old = """    // revalidación en servidor: precios del catálogo, nunca los que manda el cliente
    const items = d.items.map(it => {
      const p = CATALOGO[it.pid];
      if (!p) throw new Error('producto desconocido: ' + it.pid);
      const qty = Math.max(1, Math.min(20, Number(it.qty) || 1));
      return { pid: it.pid, nombre: p.nombre, precio: p.precio, qty };
    });
    const total = items.reduce((s, it) => s + it.precio * it.qty, 0);"""
new = """    // revalidación en servidor: precios del catálogo, nunca los que manda el cliente
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
          const m = new RegExp('^data:image\\\\/(jpeg|png);base64,(.+)$').exec(String(dataUrl));
          if (m && idOrden) item.images.push(subirImagen(idOrden, i, m[2]));
        });
        return item;
      }
      const tam = ['P', 'M', 'G'].includes(it.tam) ? it.tam : 'M';
      return { pid: it.pid, nombre: p.nombre, tam, precio: p.precios[tam], qty };
    });
    const total = items.reduce((s, it) => s + it.precio * it.qty, 0);"""
assert old in s; s = s.replace(old, new)

old = """    // id correlativo
    const props = PropertiesService.getScriptProperties();
    const seq = Number(props.getProperty('seq') || '1');
    props.setProperty('seq', String(seq + 1));
    const id = 'O-' + String(seq).padStart(4, '0');

    const ahora = new Date();"""
new = """    // id correlativo (necesario antes de guardar imágenes en /uploads)
    const props = PropertiesService.getScriptProperties();
    const seq = Number(props.getProperty('seq') || '1');
    props.setProperty('seq', String(seq + 1));
    const id = 'O-' + String(seq).padStart(4, '0');
    var idOrden = id;

    const ahora = new Date();"""
assert old in s; s = s.replace(old, new)

old = "// agrega la orden al arreglo de data/pedidos.json (GET → mezclar → PUT)"
new = """// guarda una imagen (base64 jpeg/png) en /uploads del repo y devuelve su ruta pública
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

// agrega la orden al arreglo de data/pedidos.json (GET → mezclar → PUT)"""
assert old in s; s = s.replace(old, new)
io.open(p, 'w', encoding='utf8').write(s)
print('Code.gs OK')

# ---------- workflow: validación con tamaños y descripción ----------
p = '.github/workflows/pedidos.yml'
s = io.open(p, encoding='utf8').read()
old = """          const CATALOGO = { p1: 18000, p2: 17000, p3: 20000, p4: 16500, p5: 22000 };
          const recalculado = ultimo.items.reduce((s, it) => {
            if (!CATALOGO[it.pid]) throw new Error('producto desconocido: ' + it.pid);
            return s + CATALOGO[it.pid] * it.qty;
          }, 0);
          if (recalculado !== ultimo.total) throw new Error('total no coincide: ' + ultimo.total + ' vs ' + recalculado);"""
new = """          const CATALOGO = {
            p1: { P: 52, M: 72, G: 95 }, p2: { P: 48, M: 68, G: 89 },
            p3: { P: 55, M: 78, G: 102 }, p4: { P: 45, M: 62, G: 82 },
            p5: { desde: 120 },
          };
          const recalculado = ultimo.items.reduce((s, it) => {
            const p = CATALOGO[it.pid];
            if (!p) throw new Error('producto desconocido: ' + it.pid);
            if (p.desde) {
              if (!it.descripcion) throw new Error('personalizada sin descripción');
              return s + p.desde * it.qty;
            }
            const precio = p[it.tam] || p.M;
            return s + precio * it.qty;
          }, 0);
          if (recalculado !== ultimo.total) throw new Error('total no coincide: ' + ultimo.total + ' vs ' + recalculado);"""
assert old in s; s = s.replace(old, new)
io.open(p, 'w', encoding='utf8').write(s)
print('workflow OK')

# ---------- index.html: precios "desde" en soles ----------
p = 'index.html'
s = io.open(p, encoding='utf8').read()
for old, new in [
    ('<div class="price">$18.000</div>', '<div class="price">Desde S/ 52.00</div>'),
    ('<div class="price">$17.000</div>', '<div class="price">Desde S/ 48.00</div>'),
    ('<div class="price">$20.000</div>', '<div class="price">Desde S/ 55.00</div>'),
    ('<div class="price">$16.500</div>', '<div class="price">Desde S/ 45.00</div>'),
    ('<div class="price">Desde $22.000</div>', '<div class="price">Desde S/ 120.00</div>'),
]:
    assert old in s, old
    s = s.replace(old, new)
io.open(p, 'w', encoding='utf8').write(s)
print('index.html OK')
