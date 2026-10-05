'use strict';
/* Tortas · Hechas a Mano — pedidos integrados al sitio (precios en soles).
   - Selector de tamaño por torta (Pequeña / Mediana / Grande).
   - Tortas personalizadas: editor manual + chatbot de IA (Puter.js) para
     redactar la descripción, y subida de imágenes de referencia que el
     mini-API guarda en /uploads del repo.
   - Modo demo (sin endpoint): el pedido queda en el mismo Store del sistema
     (localStorage 'tortas-pedidos-v1') y aparece en tortas-manager.
   - Modo real (con endpoint): POST al mini-API (Apps Script) que guarda en la
     hoja, avisa por email y hace commit de data/pedidos.json; ese push dispara
     el workflow .github/workflows/pedidos.yml. */

const Pedidos = (() => {
  const CONFIG = {
    tipo: '',                // 'formsubmit' (sin Apps Script) | 'appsscript' | '' = demo
    endpoint: '',            // formsubmit: https://formsubmit.co/ajax/TUCORREO · appsscript: URL /exec
    token: 'cambia-este-token',
    whatsapp: '',            // ej: '51987654321'
  };

  const KEY = 'tortas-pedidos-v1';

  // precios realistas de Lima en soles, por tamaño
  const TAMAÑOS = [
    { k: 'P', etiqueta: 'Pequeña', detalle: 'Ø 18 cm · ~8 porciones' },
    { k: 'M', etiqueta: 'Mediana', detalle: 'Ø 22 cm · ~15 porciones' },
    { k: 'G', etiqueta: 'Grande', detalle: 'Ø 26 cm · ~25 porciones' },
  ];
  const CATALOGO = [
    { id: 'p1', nombre: 'Selva Negra', img: 'rodaja de torta selvanegra.png', precios: { P: 52, M: 72, G: 95 } },
    { id: 'p2', nombre: 'Tres Leches', img: 'torta 3leches.png', precios: { P: 48, M: 68, G: 89 } },
    { id: 'p3', nombre: 'Cheesecake', img: 'cheeze cake.png', precios: { P: 55, M: 78, G: 102 } },
    { id: 'p4', nombre: 'Torta de Chantilly', img: 'chantilli.png', precios: { P: 45, M: 62, G: 82 } },
    { id: 'p5', nombre: 'Personalizada', img: 'freza partida.png', desde: 120 },
  ];
  const prod = id => CATALOGO.find(p => p.id === id);
  const tamEtiqueta = k => (TAMAÑOS.find(t => t.k === k) || {}).etiqueta || '';
  const money = n => 'S/ ' + Number(n).toFixed(2);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const img = p => 'assets/' + encodeURIComponent(p.img);

  // ---------- mini-store (misma base que tortas-manager) ----------
  const bus = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  function db() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.products)) return d;
    } catch {}
    return null;
  }
  function semilla() {
    return {
      seq: 3,
      products: CATALOGO.map((p, i) => ({
        id: p.id, img: ['selva-negra.png', 'tres-leches.png', 'cheesecake.png', 'chantilly.png', 'personalizada.png'][i],
        name: p.nombre,
        desc: ['Bizcocho de chocolate, crema chantilly, cerezas y virutas.', 'Clásica y jugosa, con un toque de canela y crema suave.', 'Base de galleta, crema de queso y salsa de berries casera.', 'Suave, esponjosa y decorada con crema y frutas.', 'Cuéntanos tu idea y la hacemos realidad.'][i],
        price: p.desde || p.precios.M, stock: [7, 10, 6, 8, 4][i],
      })),
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

  // ---------- carrito (clave = pid-tamaño; la personalizada viaja con detalle) ----------
  let carrito = {};                      // 'p1-M' -> qty
  let personal = { desc: '', imgs: [] }; // detalle de la Personalizada
  const llaves = () => Object.keys(carrito);
  function itemDe(llave) {
    const [pid, tam] = llave.split('-');
    const p = prod(pid);
    const precio = p.desde || p.precios[tam];
    return { pid, nombre: p.nombre, tam: p.desde ? null : tam, precio, qty: carrito[llave], llave };
  }
  const items = () => llaves().map(itemDe);
  const total = () => items().reduce((s, it) => s + it.precio * it.qty, 0);
  const count = () => Object.values(carrito).reduce((s, n) => s + n, 0);
  const agregar = (pid, tam) => { const k = pid + (tam ? '-' + tam : ''); carrito[k] = (carrito[k] || 0) + 1; };

  // ---------- interfaz base ----------
  const svg = {
    cart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 3h2l2.4 12.3a1 1 0 0 0 1 .7h8.4a1 1 0 0 0 1-.8L20.5 7H5.6"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    check: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  };
  document.body.insertAdjacentHTML('beforeend', `
    <button id="pj-fab" aria-label="Ver pedido">${svg.cart}<span id="pj-badge" hidden>0</span></button>
    <div id="pj-overlay" hidden></div>
    <aside id="pj-drawer" hidden>
      <div class="pj-head"><span class="pj-title">Tu pedido</span><button class="pj-x" id="pj-cerrar" aria-label="Cerrar">${svg.x}</button></div>
      <div id="pj-items"></div>
      <div class="pj-total"><span>Total</span><b id="pj-total">S/ 0.00</b></div>
      <button class="pj-cta" id="pj-ir-checkout">Ir al pedido</button>
    </aside>
    <div id="pj-modal" hidden><div class="pj-modal-card" id="pj-modal-card"></div></div>`);

  const $ = s => document.querySelector(s);
  const abrir = () => { $('#pj-drawer').hidden = false; $('#pj-overlay').hidden = false; renderCarrito(); };
  const cerrar = () => { $('#pj-drawer').hidden = true; $('#pj-overlay').hidden = true; };
  const modal = html => { $('#pj-modal-card').innerHTML = html; $('#pj-modal').hidden = false; };
  const cerrarModal = () => { $('#pj-modal').hidden = true; };
  $('#pj-fab').addEventListener('click', abrir);
  $('#pj-cerrar').addEventListener('click', cerrar);
  $('#pj-overlay').addEventListener('click', cerrar);
  $('#pj-modal').addEventListener('click', e => { if (e.target.id === 'pj-modal') cerrarModal(); });

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'pj-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function renderCarrito() {
    const n = count();
    $('#pj-badge').hidden = !n;
    $('#pj-badge').textContent = n;
    $('#pj-fab').classList.toggle('con-items', n > 0);
    $('#pj-items').innerHTML = items().length ? items().map(it => {
      const p = prod(it.pid);
      const selector = p.desde
        ? `<div class="pj-pers-tag">${it.desc ? esc(it.desc.slice(0, 42)) + '…' : 'torta personalizada'}${it.imgs ? ' · ' + it.imgs.length + ' img' : ''}</div>`
        : `<select class="pj-tam" data-tam="${it.llave}" aria-label="Tamaño">
             ${TAMAÑOS.map(t => `<option value="${t.k}" ${t.k === it.tam ? 'selected' : ''}>${t.etiqueta} — ${money(p.precios[t.k])}</option>`).join('')}
           </select>`;
      return `
        <div class="pj-item">
          <img src="${img(p)}" alt="">
          <div class="pj-item-info">
            <div class="pj-item-n">${esc(it.nombre)}</div>
            ${selector}
            <div class="pj-item-p">${money(it.precio)} c/u</div>
          </div>
          <div class="pj-qty">
            <button data-pj="menos" data-id="${it.llave}" aria-label="menos">−</button><span>${it.qty}</span><button data-pj="mas" data-id="${it.llave}" aria-label="más">+</button>
          </div>
        </div>`;
    }).join('') : '<div class="pj-vacio">Tu pedido está vacío.<br>Elige una torta del catálogo.</div>';
    $('#pj-total').textContent = money(total());
  }

  document.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const p = prod(add.dataset.add);
      if (!p) return;
      if (p.desde) return abrirPersonalizada();
      agregar(p.id, 'M');
      toast(`${p.nombre} (Mediana) agregada — cambia el tamaño en el pedido`);
      renderCarrito();
      return;
    }
    const q = e.target.closest('[data-pj]');
    if (q) {
      if (q.dataset.pj === 'mas') carrito[q.dataset.id]++;
      else { carrito[q.dataset.id]--; if (carrito[q.dataset.id] <= 0) delete carrito[q.dataset.id]; }
      renderCarrito();
    }
  });
  document.addEventListener('change', e => {
    const tam = e.target.closest('.pj-tam');
    if (!tam) return;
    const vieja = tam.dataset.tam, nueva = tam.value;
    if (nueva === vieja) return;
    const qty = carrito[vieja];
    delete carrito[vieja];
    carrito[vieja.split('-')[0] + '-' + nueva] = qty;
    renderCarrito();
  });

  // ---------- torta personalizada: editor manual + chatbot (Puter.js) ----------
  let chatHistoria = [];
  let puterCargado = false;
  function cargarPuter() {
    if (puterCargado) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://js.puter.com/v2/';
      s.onload = () => { puterCargado = true; res(); };
      s.onerror = () => rej(new Error('No se pudo cargar Puter.js'));
      document.head.appendChild(s);
    });
  }

  function abrirPersonalizada() {
    modal(`
      <h3 class="pj-modal-titulo">Torta personalizada</h3>
      <p class="pj-dim">Desde ${money(120)} — el precio final se confirma por WhatsApp según tu diseño.</p>
      <div class="pj-tabs">
        <button class="pj-tab activo" data-tab="editor">Editor manual</button>
        <button class="pj-tab" data-tab="ia">Con IA</button>
      </div>
      <div id="pj-tab-editor">
        <div class="pj-grid">
          <label>Masa
            <select id="pj-masa"><option>Vainilla</option><option>Chocolate</option><option>Marmoleado</option><option>Naranja</option></select>
          </label>
          <label>Relleno
            <select id="pj-relleno"><option>Manjar blanco</option><option>Crema de lúcuma</option><option>Chocolate</option><option>Fresa</option><option>Chantilly</option></select>
          </label>
          <label>Cobertura
            <select id="pj-cobertura"><option>Chantilly</option><option>Fondant</option><option>Buttercream</option><option>Merengue</option></select>
          </label>
          <label>Porciones
            <select id="pj-porciones"><option>~10</option><option selected>~20</option><option>~30</option><option>~50</option></select>
          </label>
          <label class="pj-ancho">Dedicatoria<input id="pj-dedicatoria" placeholder="Feliz cumpleaños, Mamá"></label>
          <label class="pj-ancho">Detalles extra (decoración, colores, tema)<input id="pj-extra" placeholder="tema de gatitos, colores rosado y dorado"></label>
        </div>
        <button class="pj-cta pj-sec" id="pj-generar-desc">Armar descripción</button>
        <label class="pj-desc-label">Descripción de la torta
          <textarea id="pj-desc" rows="4" placeholder="Describe tu torta… o usa las pestañas de arriba para armarla"></textarea>
        </label>
      </div>
      <div id="pj-tab-ia" hidden>
        <div class="pj-chat" id="pj-chat-msgs"><div class="pj-chat-msg ia">¡Hola! Cuéntame qué torta imaginas (ocasión, sabores, decoración) y te ayudo a redactarla.</div></div>
        <div class="pj-chat-row"><input id="pj-chat-input" placeholder="Quiero una torta para…"><button class="pj-cta pj-mini" id="pj-chat-enviar">Enviar</button></div>
        <button class="pj-cta pj-sec" id="pj-chat-usar" disabled>Usar esta descripción</button>
        <p class="pj-dim">La IA corre con Puter.js: la primera vez te pedirá iniciar sesión gratis con tu cuenta Puter.</p>
      </div>
      ${CONFIG.tipo === 'appsscript' ? `
      <label class="pj-archivos">Imágenes de referencia (hasta 3)
        <input type="file" id="pj-imgs" accept="image/*" multiple>
        <div class="pj-thumbs" id="pj-thumbs"></div>
      </label>` : ''}
      <button class="pj-cta" id="pj-add-pers">Agregar al pedido</button>`);

    $('#pj-modal-card').querySelectorAll('.pj-tab').forEach(b => b.addEventListener('click', () => {
      $('#pj-modal-card').querySelectorAll('.pj-tab').forEach(x => x.classList.toggle('activo', x === b));
      $('#pj-tab-editor').hidden = b.dataset.tab !== 'editor';
      $('#pj-tab-ia').hidden = b.dataset.tab !== 'ia';
    }));

    $('#pj-generar-desc').addEventListener('click', () => {
      const v = id => $(id).value;
      $('#pj-desc').value = `Torta personalizada: masa de ${v('#pj-masa').toLowerCase()}, relleno de ${v('#pj-relleno').toLowerCase()}, cobertura de ${v('#pj-cobertura').toLowerCase()}, aprox. ${v('#pj-porciones')} porciones` +
        (v('#pj-dedicatoria') ? `, con la dedicatoria "${v('#pj-dedicatoria')}"` : '') +
        (v('#pj-extra') ? `. Detalles: ${v('#pj-extra')}` : '') + '.';
    });

    const chatMsgs = () => $('#pj-chat-msgs');
    const burbuja = (txt, quien) => {
      chatMsgs().insertAdjacentHTML('beforeend', `<div class="pj-chat-msg ${quien}">${esc(txt)}</div>`);
      chatMsgs().scrollTop = chatMsgs().scrollHeight;
    };
    $('#pj-chat-enviar').addEventListener('click', async () => {
      const entrada = $('#pj-chat-input');
      const texto = entrada.value.trim();
      if (!texto) return;
      entrada.value = '';
      burbuja(texto, 'yo');
      chatHistoria.push({ role: 'user', content: texto });
      const burbujaIA = document.createElement('div');
      burbujaIA.className = 'pj-chat-msg ia';
      burbujaIA.textContent = 'Pensando…';
      chatMsgs().appendChild(burbujaIA);
      try {
        await cargarPuter();
        const sistema = 'Eres el asistente de pedidos de "Tortas Hechas a Mano", pastelería casera en Perú. Ayuda a definir la torta personalizada del cliente: masa (vainilla, chocolate, marmoleado), relleno (manjar blanco, lúcuma, chocolate, fresa), cobertura (chantilly, fondant, buttercream), porciones, decoración y dedicatoria. Responde breve; cuando el cliente esté conforme, entrega SOLO la descripción final del pedido en un párrafo que empiece con "Torta personalizada:".';
        const r = await window.puter.ai.chat(chatHistoria.concat([{ role: 'system', content: sistema }]).slice(-8));
        const bruto = r && (r.message?.content || r.text);
        const limpio = typeof bruto === 'string' ? bruto : JSON.stringify(bruto ?? r);
        chatHistoria.push({ role: 'assistant', content: limpio });
        burbujaIA.textContent = limpio;
        $('#pj-chat-usar').disabled = false;
      } catch (err) {
        burbujaIA.textContent = 'No se pudo conectar con la IA (' + (err.message || 'inicia sesión con Puter') + '). Usa el editor manual, que funciona siempre.';
      }
    });
    $('#pj-chat-usar').addEventListener('click', () => {
      const ultima = [...chatHistoria].reverse().find(m => m.role === 'assistant');
      if (!ultima) return;
      $('#pj-desc').value = ultima.content;
      $('#pj-modal-card').querySelector('[data-tab="editor"]').click();
    });

    const pjImgs = $('#pj-imgs');
    if (pjImgs) pjImgs.addEventListener('change', async e => {
      const archivos = [...e.target.files].slice(0, 3 - personal.imgs.length);
      for (const archivo of archivos) {
        try {
          if (personal.imgs.length < 3) personal.imgs.push(await comprimir(archivo));
        } catch { toast('No se pudo leer una imagen'); }
      }
      renderThumbs();
    });
    function renderThumbs() {
      $('#pj-thumbs').innerHTML = personal.imgs.map((src, i) =>
        `<div class="pj-thumb"><img src="${src}" alt=""><button data-quit-img="${i}" aria-label="quitar">✕</button></div>`).join('');
      $('#pj-thumbs').querySelectorAll('[data-quit-img]').forEach(b => b.addEventListener('click', () => {
        personal.imgs.splice(+b.dataset.quitImg, 1); renderThumbs();
      }));
    }

    $('#pj-add-pers').addEventListener('click', () => {
      const desc = $('#pj-desc').value.trim();
      if (!desc) return toast('Describe tu torta (editor o IA)');
      personal.desc = desc;
      agregar('p5', null);
      cerrarModal();
      renderCarrito();
      toast('Torta personalizada agregada al pedido');
    });
  }

  async function comprimir(archivo) {
    const bmp = await createImageBitmap(archivo);
    const max = 1100, r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  // ---------- checkout en #pedidos ----------
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
          <label>Dirección de entrega<input id="pj-direccion" placeholder="Jr. Los Rosales 123, distrito"></label>
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
        <p class="pj-nota">Yape, Plin y efectivo se coordinan por WhatsApp al confirmar.</p>
      </div>`;

    const actualizarCta = () => { $('#pj-enviar').disabled = !count(); };
    new MutationObserver(actualizarCta).observe($('#pj-items'), { childList: true });
    $('#pj-ir-checkout').addEventListener('click', () => { cerrar(); ancla.scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    $('#pj-enviar').addEventListener('click', async () => {
      const nombre = $('#pj-nombre').value.trim(), telefono = $('#pj-telefono').value.trim(), direccion = $('#pj-direccion').value.trim();
      if (!nombre || !telefono || !direccion) return toast('Completa nombre, teléfono y dirección');
      if (!count()) return toast('Tu pedido está vacío');
      const btn = $('#pj-enviar');
      btn.disabled = true; btn.textContent = 'Enviando…';
      const payload = {
        token: CONFIG.token,
        cliente: { nombre, telefono, direccion, fecha: $('#pj-fecha').value, mensaje: $('#pj-mensaje').value.trim() },
        items: items().map(it => ({
          pid: it.pid, nombre: it.nombre, tam: it.tam, precio: it.precio, qty: it.qty,
          ...(it.pid === 'p5' ? { descripcion: personal.desc, images: personal.imgs } : {}),
        })),
        total: total(),
        pago: $('#pj-pago').value,
      };
      try {
        let id;
        if (CONFIG.tipo === 'formsubmit') {
          // sin Apps Script: el pedido viaja como correo (FormSubmit) y el
          // workflow "bandeja" lo integra a data/pedidos.json por IMAP
          const ref = 'REF-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const plano = {
            _subject: `Pedido web tortas — ${ref}`,
            _template: 'table',
            _captcha: 'false',
            ref,
            nombre, telefono, direccion,
            fecha: payload.cliente.fecha,
            pago: payload.pago,
            total: money(payload.total),
            pedido: '[[PEDIDO]]' + JSON.stringify({
              ref,
              cliente: payload.cliente,
              items: payload.items.map(it => ({ ...it, images: undefined })),
              total: payload.total,
              createdAt: Date.now(),
            }) + '[[FIN]]',
          };
          const res = await fetch(CONFIG.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(plano),
          });
          const out = await res.json().catch(() => ({}));
          if (!out.success) throw new Error(out.message || 'no se pudo registrar');
          id = ref;
        } else if (CONFIG.endpoint) {
          const res = await fetch(CONFIG.endpoint, { method: 'POST', body: JSON.stringify(payload) });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || 'error del servidor');
          id = out.id;
        } else {
          await new Promise(r => setTimeout(r, 600));
          const seq = (db() ? db().seq : 3);
          id = 'O-' + String(Math.max(seq, 3)).padStart(4, '0');
          guarda({
            id,
            customer: { name: nombre, phone: telefono, address: direccion, note: payload.cliente.mensaje },
            items: payload.items.map(it => ({ pid: it.pid, name: it.nombre + (it.tam ? ' · ' + tamEtiqueta(it.tam) : ''), price: it.precio, qty: it.qty, tam: it.tam, ...(it.descripcion ? { descripcion: it.descripcion } : {}) })),
            total: payload.total, payMethod: payload.pago, payStatus: 'pendiente', status: 'nuevo',
            deliveryDate: payload.cliente.fecha, createdAt: Date.now(),
            history: [{ status: 'nuevo', at: Date.now() }],
          });
        }
        carrito = {}; personal = { desc: '', imgs: [] }; chatHistoria = [];
        renderCarrito();
        const waTxt = encodeURIComponent(
          `Hola, Tortas · Hechas a Mano. Confirmo mi pedido ${id}:\n` +
          payload.items.map(it => `• ${it.qty}× ${it.nombre}${it.tam ? ' (' + tamEtiqueta(it.tam) + ')' : ''}`).join('\n') +
          (payload.items.some(it => it.descripcion) ? `\nPersonalizada: ${payload.items.find(it => it.descripcion).descripcion}` : '') +
          `\nTotal: ${money(payload.total)} (${payload.pago})\nEntrega: ${payload.cliente.fecha}` +
          `\n${nombre} — ${direccion}`);
        $('#pj-modal-card').innerHTML = `
          <div class="pj-confirm-ic">${svg.check}</div>
          <h3 class="pj-modal-titulo">Pedido ${id} confirmado</h3>
          <p>Total: <b>${money(payload.total)}</b> · ${payload.pago}</p>
          <p class="pj-dim">Te escribimos para coordinar la entrega.${CONFIG.endpoint || CONFIG.tipo ? '' : ' (modo demo)'}</p>
          <a class="pj-wa" target="_blank" rel="noopener" href="https://wa.me/${CONFIG.whatsapp}?text=${waTxt}">Enviar por WhatsApp</a>
          <button class="pj-cerrar-btn" id="pj-confirm-cerrar">Cerrar</button>`;
        $('#pj-modal').hidden = false;
        $('#pj-confirm-cerrar').addEventListener('click', cerrarModal);
      } catch (err) {
        toast('No se pudo enviar: ' + err.message);
      }
      btn.disabled = !count(); btn.textContent = 'Confirmar pedido';
    });
  }

  return { CONFIG, carrito: () => carrito, items, total, personal: () => personal };
})();
