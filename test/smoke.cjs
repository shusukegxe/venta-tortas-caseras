'use strict';
/* Smoke test de la web de tortas con pedidos integrados (código real en jsdom). */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = __dirname + '/..';
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8')
  .replace('<script src="js/pedidos.js"></script>', () =>
    `<script>\n${fs.readFileSync(`${DIR}/js/pedidos.js`, 'utf8')}\n</script>`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK ' : ' FAIL') + ' ' + msg); if (!cond) fails++; };

async function nuevaWeb() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
  dom.window.onerror = e => { console.log('  ONERROR ' + e); fails++; };
  await sleep(250);
  return dom;
}

(async () => {
  // ---------- modo demo (sin endpoint configurado) ----------
  let dom = await nuevaWeb();
  let d = dom.window.document;

  ok(d.querySelectorAll('[data-add]').length === 4, 'catálogo: 4 tortas con botón Pedir');
  ok(!!d.getElementById('pj-fab'), 'interfaz: botón flotante del carrito presente');
  ok(!!d.querySelector('#pedido-checkout .pj-checkout'), 'checkout: formulario montado en #pedidos');
  ok(d.getElementById('pj-enviar').disabled, 'checkout: botón deshabilitado con carrito vacío');

  d.querySelector('[data-add="p1"]').click();
  d.querySelector('[data-add="p1"]').click();
  d.querySelector('[data-add="p3"]').click();
  await sleep(50);
  ok(d.getElementById('pj-badge').textContent === '3' && !d.getElementById('pj-badge').hidden, 'carrito: badge con 3 items');
  d.getElementById('pj-fab').click();
  ok(d.querySelectorAll('#pj-items .pj-item').length === 2, 'drawer: 2 líneas (2× Selva Negra + 1× Cheesecake)');
  ok(d.getElementById('pj-total').textContent === '$56.000', 'drawer: total $56.000');
  ok(!d.getElementById('pj-enviar').disabled, 'checkout: botón habilitado con items');

  // checkout demo → guarda en el Store compartido
  d.getElementById('pj-nombre').value = 'Cliente Web';
  d.getElementById('pj-telefono').value = '999111222';
  d.getElementById('pj-direccion').value = 'Jr. Prueba 123';
  d.getElementById('pj-ir-checkout') && d.getElementById('pj-enviar').click();
  await sleep(1200);
  ok(d.getElementById('pj-confirm').textContent.includes('Pedido O-0003 confirmado'), 'checkout demo: confirmación con O-0003');
  ok(d.getElementById('pj-confirm').textContent.includes('$56.000'), 'checkout demo: total correcto');
  ok(!!d.querySelector('.pj-wa'), 'checkout: botón WhatsApp presente');
  const persisted = JSON.parse(dom.window.localStorage.getItem('tortas-pedidos-v1'));
  ok(persisted.orders.some(o => o.id === 'O-0003' && o.total === 56000), 'modo demo: pedido en el Store compartido (lo ve el manager)');

  // ---------- modo real (con endpoint): la request viaja como JSON ----------
  dom = await nuevaWeb();
  d = dom.window.document;
  let capturada = null;
  dom.window.fetch = async (url, opts) => {
    capturada = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ ok: true, id: 'O-0042' }) };
  };
  d.querySelector('[data-add="p2"]').click();
  await sleep(50);   // el observer del checkout habilita el botón en una microtarea
  d.getElementById('pj-nombre').value = 'Cliente Real';
  d.getElementById('pj-telefono').value = '998887776';
  d.getElementById('pj-direccion').value = 'Av. Real 456';
  dom.window.eval('Pedidos.CONFIG.endpoint = "https://script.google.com/macros/s/TEST/exec";');
  d.getElementById('pj-enviar').click();
  await sleep(400);
  ok(!!capturada, 'modo real: la request salió por fetch');
  ok(capturada.url === 'https://script.google.com/macros/s/TEST/exec', 'modo real: URL del endpoint correcta');
  ok(capturada.body.items.length === 1 && capturada.body.items[0].pid === 'p2' && capturada.body.total === 17000, 'modo real: payload con items y total');
  ok(d.getElementById('pj-confirm').textContent.includes('Pedido O-0042 confirmado'), 'modo real: confirmación con el id del servidor');

  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXCEPCIÓN:', e); process.exit(1); });
