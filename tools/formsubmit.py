import io

# ---------- js/pedidos.js: modo formsubmit (sin Apps Script) ----------
p = 'js/pedidos.js'
s = io.open(p, encoding='utf8').read()

old = """  const CONFIG = {
    endpoint: '',            // URL de tu Apps Script (ver README)
    token: 'cambia-este-token',
    whatsapp: '',            // ej: '51987654321'
  };"""
new = """  const CONFIG = {
    tipo: '',                // 'formsubmit' (sin Apps Script) | 'appsscript' | '' = demo
    endpoint: '',            // formsubmit: https://formsubmit.co/ajax/TUCORREO · appsscript: URL /exec
    token: 'cambia-este-token',
    whatsapp: '',            // ej: '51987654321'
  };"""
assert old in s; s = s.replace(old, new)

old = """      try {
        let id;
        if (CONFIG.endpoint) {
          const res = await fetch(CONFIG.endpoint, { method: 'POST', body: JSON.stringify(payload) });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || 'error del servidor');
          id = out.id;
        } else {"""
new = """      try {
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
        } else {"""
assert old in s; s = s.replace(old, new)

# sin repo-write en modo formsubmit: ocultar la subida de imágenes
old = """      <label class="pj-archivos">Imágenes de referencia (hasta 3)
        <input type="file" id="pj-imgs" accept="image/*" multiple>
        <div class="pj-thumbs" id="pj-thumbs"></div>
      </label>"""
new = """      ${CONFIG.tipo === 'appsscript' ? `
      <label class="pj-archivos">Imágenes de referencia (hasta 3)
        <input type="file" id="pj-imgs" accept="image/*" multiple>
        <div class="pj-thumbs" id="pj-thumbs"></div>
      </label>` : ''}"""
assert old in s; s = s.replace(old, new)

io.open(p, 'w', encoding='utf8').write(s)
print('pedidos.js OK')

# ---------- confirmación en modo formsubmit: el id es la ref ----------
p = 'js/pedidos.js'
s = io.open(p, encoding='utf8').read()
old = """          <h3 class="pj-modal-titulo">Pedido ${id} confirmado</h3>
          <p>Total: <b>${money(payload.total)}</b> · ${payload.pago}</p>
          <p class="pj-dim">Te escribimos para coordinar la entrega.${CONFIG.endpoint ? '' : ' (modo demo)'}</p>"""
new = """          <h3 class="pj-modal-titulo">Pedido ${id} confirmado</h3>
          <p>Total: <b>${money(payload.total)}</b> · ${payload.pago}</p>
          <p class="pj-dim">Te escribimos para coordinar la entrega.${CONFIG.endpoint || CONFIG.tipo ? '' : ' (modo demo)'}</p>"""
assert old in s; s = s.replace(old, new)
io.open(p, 'w', encoding='utf8').write(s)
print('confirmación OK')