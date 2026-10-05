'use strict';
/* Tortas · Hechas a Mano — pedidos integrados al sitio.
   Modo demo (sin configurar): el carrito guarda en el mismo Store que el panel
   (localStorage 'tortas-pedidos-v1' + BroadcastChannel), así que un pedido hecho
   aquí aparece en tortas-manager en vivo.
   Modo real (con endpoint): el checkout envía la orden al mini-API (Apps Script),
   que la guarda en la hoja, avisa por email y hace commit de data/pedidos.json;
   ese push dispara el workflow .github/workflows/pedidos.yml. Así funciona entre
   dispositivos: el cliente pide desde su teléfono y el negocio recibe en el suyo. */

const Pedidos = (() => {
  const CONFIG = {
    endpoint: '',            // pega aquí la URL de tu Apps Script (ver README)
    token: 'cambia-este-token',
    whatsapp: '',            // ej: '51987654321' para que el WhatsApp abra con tu número
  };

  const KEY = 'tortas-pedidos-v1';
  const CATALOGO = [
    { id: 'p1', nombre: 'Selva Negra', precio: 18000, img: 'rodaja de torta selvanegra.png' },
    { id: 'p2', nombre: 'Tres Leches', precio: 17000, img: 'torta 3leches.png' },
    { id: 'p3', nombre: 'Cheesecake', precio: 20000, img: 'cheeze cake.png' },
    { id: 'p4', nombre: 'Torta de Chantilly', precio: 16500, img: 'chantilli.png' },
    { id: 'p5', nombre: 'Personalizada', precio: 22000, img: 'freza partida.png' },
  ];
  const prod = id => CATALOGO.find(p => p.id === id);
  const money = n => '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const img = p => 'assets/' + encodeURIComponent(p.img);

  // ---------- mini-store (misma "base de datos" que tortas-manager) ----------
  const bus = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  function db() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.products)) return d;
    } catch {}
    return null; // el panel es quien crea la semilla; aquí solo pedimos
  }
  // semilla idéntica a la del core de tortas-manager: así, quien llegue directo
  // a esta web sin haber abierto el panel, igual deja su pedido en el Store
  function semilla() {
    return {
      seq: 3,
      products: [
        { id: 'p1', img: 'selva-negra.png',   name: 'Selva Negra', desc: 'Bizcocho de chocolate, crema chantilly, cerezas y virutas.', price: 18000, stock: 7 },
        { id: 'p2', img: 'tres-leches.png',   name: 'Tres Leches', desc: 'Clásica y jugosa, con un toque de canela y crema suave.',     price: 17000, stock: 10 },
        { id: 'p3', img: 'cheesecake.png',    name: 'Cheesecake',  desc: 'Base de galleta, crema de queso y salsa de berries casera.', price: 20000, stock: 6 },
        { id: 'p4', img: 'chantilly.png',     name: 'Torta de Chantilly', desc: 'Suave, esponjosa y decorada con crema y frutas.',      price: 16500, stock: 8 },
        { id: 'p5', img: 'personalizada.png', name: 'Personalizada', desc: 'Cuéntanos tu idea y la hacemos realidad.',                price: 22000, stock: 4 },
      ],
      orders: [], customers: [], notifications: [], events: [],
    };
  }

  function guarda(orden) {
    const d = db() || semilla();
    d.seq = Math.max((d.seq || 3) + 1, 4);
    d.orders.unshift(orden);
    const c = d.customers.find(c => c.phone === orden.customer.phone);
    if (c) { c.orders++; c.spent += orden.total; }
    else d.customers.push({ phone: orden.customer.phone, name: orden.customer.name, orders: 1, spent: orden.total });
    d.notifications.unshift({ kind: 'order', text: `Nuevo pedido ${orden.id} de ${orden.customer.name}`, at: new Date().toLocaleTimeString('es', { hour12: false }) });
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {}
    try { bus && bus.postMessage(Date.now()); } catch {}
    return orden;
  }

  // ---------- carrito ----------
  let carrito = {};        // pid -> cantidad
  const items = () => Object.entries(carrito).map(([pid, qty]) => { const p = prod(pid); return { pid, nombre: p.nombre, precio: p.precio, qty }; });
  const total = () => items().reduce((s, it) => s + it.precio * it.qty, 0);
  const count = () => Object.values(carrito).reduce((s, n) => s + n, 0);

  // ---------- interfaz: botón flotante + drawer + checkout ----------
  const svg = {
    cart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 3h2l2.4 12.3a1 1 0 0 0 1 .7h8.4a1 1 0 0 0 1-.8L20.5 7H5.6"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    check: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  };

  document.body.insertAdjacentHTML('beforeend', `
    <button id="pj-fab" aria-label="Ver pedido">
      ${svg.cart}<span id="pj-badge" hidden>0</span>
    </button>
    <div id="pj-overlay" hidden></div>
    <aside id="pj-drawer" hidden>
      <div class="pj-head">
        <span class="pj-title">Tu pedido</span>
        <button class="pj-x" id="pj-cerrar" aria-label="Cerrar">${svg.x}</button>
      </div>
      <div id="pj-items"></div>
      <div class="pj-total"><span>Total</span><b id="pj-total">$0</b></div>
      <button class="pj-cta" id="pj-ir-checkout">Ir al pedido</button>
    </aside>
    <div id="pj-confirm" hidden>
      <div class="pj-confirm-card"></div>
    </div>`);

  const $ = s => document.querySelector(s);
  const abrir = () => { $('#pj-drawer').hidden = false; $('#pj-overlay').hidden = false; renderCarrito(); };
  const cerrar = () => { $('#pj-drawer').hidden = true; $('#pj-overlay').hidden = true; };
  $('#pj-fab').addEventListener('click', abrir);
  $('#pj-cerrar').addEventListener('click', cerrar);
  $('#pj-overlay').addEventListener('click', cerrar);

  function renderCarrito() {
    const n = count();
    $('#pj-badge').hidden = !n;
    $('#pj-badge').textContent = n;
    $('#pj-fab').classList.toggle('con-items', n > 0);
    $('#pj-items').innerHTML = items().length ? items().map(it => `
      <div class="pj-item">
        <img src="${img(prod(it.pid))}" alt="">
        <div class="pj-item-info">
          <div class="pj-item-n">${esc(it.nombre)}</div>
          <div class="pj-item-p">${money(it.precio)}</div>
        </div>
        <div class="pj-qty">
          <button data-pj="menos" data-id="${it.pid}" aria-label="menos">−</button><span>${it.qty}</span><button data-pj="mas" data-id="${it.pid}" aria-label="más">+</button>
        </div>
      </div>`).join('')
      : '<div class="pj-vacio">Tu pedido está vacío.<br>Elige una torta del catálogo.</div>';
    $('#pj-total').textContent = money(total());
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'pj-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // catálogo: los botones "Pedir" agregan al carrito
  document.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const p = prod(add.dataset.add);
      if (!p) return;
      carrito[p.id] = (carrito[p.id] || 0) + 1;
      toast(`${p.nombre} agregada al pedido`);
      renderCarrito();
      return;
    }
    const q = e.target.closest('[data-pj]');
    if (!q) return;
    if (q.dataset.pj === 'mas') carrito[q.dataset.id]++;
    else {
      carrito[q.dataset.id]--;
      if (carrito[q.dataset.id] <= 0) delete carrito[q.dataset.id];
    }
    renderCarrito();
  });

  // checkout dentro de la sección #pedidos
  const ancla = document.getElementById('pedido-checkout');
  if (ancla) {
    const hoy = new Date().toISOString().slice(0, 10);
    ancla.innerHTML = `
      <div class="pj-checkout">
        <h3>Formulario de pedido</h3>
        <p class="pj-checkout-sub">Completa tus datos ${CONFIG.endpoint ? '' : '— modo demo: el pedido queda en este navegador y aparece en el panel'}</p>
        <div class="pj-grid">
          <label>Nombre<input id="pj-nombre" placeholder="Ana Torres"></label>
          <label>Teléfono / WhatsApp<input id="pj-telefono" placeholder="999 999 999"></label>
          <label>Dirección de entrega<input id="pj-direccion" placeholder="Calle 1 #23, distrito"></label>
          <label>Fecha de entrega<input type="date" id="pj-fecha" min="${hoy}" value="${hoy}"></label>
          <label class="pj-ancho">Mensaje en la torta (opcional)<input id="pj-mensaje" placeholder="Feliz cumpleaños, Mamá"></label>
          <label>Forma de pago
            <select id="pj-pago">
              <option value="transferencia">Transferencia / Yape / Plin</option>
              <option value="efectivo">Efectivo al entregar</option>
            </select>
          </label>
        </div>
        <button class="pj-cta pj-cta-ancho" id="pj-enviar" disabled>Confirmar pedido</button>
        <p class="pj-nota">Yape, Plin y efectivo coordinados por WhatsApp al confirmar.</p>
      </div>`;

    const actualizarCta = () => { $('#pj-enviar').disabled = !count(); };
    new MutationObserver(actualizarCta).observe($('#pj-items'), { childList: true });
    $('#pj-ir-checkout').addEventListener('click', () => {
      cerrar();
      ancla.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    $('#pj-enviar').addEventListener('click', async () => {
      const nombre = $('#pj-nombre').value.trim(), telefono = $('#pj-telefono').value.trim(), direccion = $('#pj-direccion').value.trim();
      if (!nombre || !telefono || !direccion) return toast('Completa nombre, teléfono y dirección');
      if (!count()) return toast('Tu pedido está vacío');
      const btn = $('#pj-enviar');
      btn.disabled = true; btn.textContent = 'Enviando…';
      const payload = {
        token: CONFIG.token,
        cliente: { nombre, telefono, direccion, fecha: $('#pj-fecha').value, mensaje: $('#pj-mensaje').value.trim() },
        items: items(),
        total: total(),
        pago: $('#pj-pago').value,
      };
      try {
        let id;
        if (CONFIG.endpoint) {
          const res = await fetch(CONFIG.endpoint, { method: 'POST', body: JSON.stringify(payload) });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || 'error del servidor');
          id = out.id;
        } else {
          await new Promise(r => setTimeout(r, 600));   // latencia simulada
          const seq = (db() ? db().seq : 3);
          id = 'O-' + String(Math.max(seq, 3)).padStart(4, '0');
          guarda({
            id,
            customer: { name: nombre, phone: telefono, address: direccion, note: payload.cliente.mensaje },
            items: payload.items.map(it => ({ pid: it.pid, name: it.nombre, price: it.precio, qty: it.qty })),
            total: payload.total, payMethod: payload.pago, payStatus: 'pendiente', status: 'nuevo',
            deliveryDate: payload.cliente.fecha, createdAt: Date.now(),
            history: [{ status: 'nuevo', at: Date.now() }],
          });
        }
        carrito = {}; renderCarrito();
        const waTxt = encodeURIComponent(
          `Hola, Tortas · Hechas a Mano. Confirmo mi pedido ${id}:\n` +
          payload.items.map(it => `• ${it.qty}× ${it.nombre}`).join('\n') +
          `\nTotal: ${money(payload.total)} (${payload.pago})\nEntrega: ${payload.cliente.fecha}` +
          `\n${nombre} — ${direccion}`);
        $('#pj-confirm .pj-confirm-card').innerHTML = `
          <div class="pj-confirm-ic">${svg.check}</div>
          <h3>Pedido ${id} confirmado</h3>
          <p>Total: <b>${money(payload.total)}</b> · ${payload.pago}</p>
          <p class="pj-dim">Te escribimos para coordinar la entrega.${CONFIG.endpoint ? '' : ' (modo demo)'}</p>
          <a class="pj-wa" target="_blank" rel="noopener"
             href="https://wa.me/${CONFIG.whatsapp}?text=${waTxt}">Enviar por WhatsApp</a>
          <button class="pj-cerrar-btn" id="pj-confirm-cerrar">Cerrar</button>`;
        $('#pj-confirm').hidden = false;
        $('#pj-confirm-cerrar').addEventListener('click', () => { $('#pj-confirm').hidden = true; });
      } catch (err) {
        toast('No se pudo enviar: ' + err.message);
      }
      btn.disabled = !count(); btn.textContent = 'Confirmar pedido';
    });
  }

  return { CONFIG, carrito: () => carrito, items, total };
})();
