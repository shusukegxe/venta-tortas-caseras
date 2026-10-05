'use strict';
/* Smoke test de la web de tortas: tamaños, soles, personalizada (editor + IA tab) y modos demo/real. */
const fs = require('fs');
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
  let dom = await nuevaWeb();
  let d = dom.window.document;

  // catálogo con precios en soles y botones
  ok(d.querySelectorAll('[data-add]').length === 5, 'catálogo: 5 botones (4 tortas + Personalizar)');
  ok(d.body.textContent.includes('Desde S/ 52.00'), 'catálogo: precios en soles');
  ok(!!d.querySelector('[data-add="p5"]'), 'personalizada: botón Personalizar presente');

  // carrito con tamaños
  d.querySelector('[data-add="p1"]').click();
  d.querySelector('[data-add="p1"]').click();
  d.querySelector('[data-add="p3"]').click();
  await sleep(50);
  ok(d.getElementById('pj-badge').textContent === '3', 'carrito: 3 items');
  d.getElementById('pj-fab').click();
  ok(d.querySelectorAll('#pj-items .pj-item').length === 2, 'drawer: 2 líneas');
  ok(d.getElementById('pj-total').textContent === 'S/ 222.00', 'tamaños: 2× Selva Negra M (S/ 72) + Cheesecake M (S/ 78) = S/ 222.00');

  // cambiar tamaño de la Selva Negra a Grande
  const sel = d.querySelector('.pj-tam[data-tam="p1-M"]');
  ok(!!sel, 'drawer: selector de tamaño presente');
  sel.value = 'G';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await sleep(30);
  ok(d.getElementById('pj-total').textContent === 'S/ 268.00', 'tamaños: al cambiar a Grande → S/ 268.00');

  // checkout demo
  d.getElementById('pj-enviar').disabled === false || await sleep(50);
  d.getElementById('pj-nombre').value = 'Cliente Web';
  d.getElementById('pj-telefono').value = '999111222';
  d.getElementById('pj-direccion').value = 'Jr. Prueba 123';
  d.getElementById('pj-enviar').click();
  await sleep(1200);
  ok(d.getElementById('pj-modal-card').textContent.includes('Pedido O-0003 confirmado'), 'checkout demo: O-0003 confirmado');
  ok(d.getElementById('pj-modal-card').textContent.includes('S/ 268.00'), 'checkout demo: total en soles');
  d.getElementById('pj-confirm-cerrar').click();

  // ---------- personalizada: editor manual ----------
  d.querySelector('[data-add="p5"]').click();
  await sleep(30);
  ok(!d.getElementById('pj-modal').hidden, 'personalizada: modal abierto');
  ok(!!d.querySelector('#pj-tab-editor .pj-grid'), 'personalizada: editor manual con campos');
  ok(!!d.querySelector('[data-tab="ia"]'), 'personalizada: pestaña Con IA presente');
  d.getElementById('pj-dedicatoria').value = 'Feliz 15 años, Sofía';
  d.getElementById('pj-extra').value = 'tema de mariposas, tonos lavanda';
  d.getElementById('pj-generar-desc').click();
  const desc = d.getElementById('pj-desc').value;
  ok(desc.includes('Torta personalizada') && desc.includes('manjar blanco') && desc.includes('mariposas'), 'editor: descripción armada desde los campos');
  d.getElementById('pj-add-pers').click();
  await sleep(30);
  ok(d.getElementById('pj-badge').textContent === '1', 'personalizada: agregada al carrito (el checkout anterior lo vació)');
  ok(d.getElementById('pj-total').textContent === 'S/ 120.00', 'personalizada: total S/ 120.00');
  const guardada = JSON.parse(dom.window.localStorage.getItem('tortas-pedidos-v1'));

  // checkout demo con personalizada → la descripción viaja en el item
  await sleep(60);
  d.getElementById('pj-enviar').click();
  await sleep(1200);
  ok(d.getElementById('pj-modal-card').textContent.includes('Pedido O-0004 confirmado'), 'checkout: O-0004 confirmado');
  ok(d.getElementById('pj-modal-card').textContent.includes('S/ 120.00'), 'checkout: total S/ 120.00');
  const despues = JSON.parse(dom.window.localStorage.getItem('tortas-pedidos-v1'));
  const o4 = despues.orders.find(o => o.id === 'O-0004');
  ok(o4 && o4.items.some(i => i.descripcion && i.descripcion.includes('mariposas')), 'personalizada: descripción guardada en el pedido');

  // ---------- modo real: apps-script (payload completo) ----------
  dom = await nuevaWeb();
  d = dom.window.document;
  let capturada = null;
  dom.window.fetch = async (url, opts) => {
    capturada = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ ok: true, id: 'O-0042' }) };
  };
  d.querySelector('[data-add="p1"]').click();
  await sleep(60);
  d.getElementById('pj-nombre').value = 'Cliente Real';
  d.getElementById('pj-telefono').value = '998887776';
  d.getElementById('pj-direccion').value = 'Av. Real 456';
  dom.window.eval('Pedidos.CONFIG.tipo = "appsscript"; Pedidos.CONFIG.endpoint = "https://script.google.com/macros/s/TEST/exec";');
  d.getElementById('pj-enviar').click();
  await sleep(400);
  ok(!!capturada && capturada.body.items[0].tam === 'M' && capturada.body.items[0].precio === 72, 'modo apps-script: item con tamaño y precio de servidor');
  ok(!!capturada && capturada.body.total === 72, 'modo apps-script: total recalculado');

  // ---------- modo real sin Apps Script: formsubmit (correo con marcador) ----------
  dom = await nuevaWeb();
  d = dom.window.document;
  capturada = null;
  dom.window.fetch = async (url, opts) => {
    capturada = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ success: 'true' }) };
  };
  d.querySelector('[data-add="p1"]').click();
  await sleep(60);
  d.getElementById('pj-nombre').value = 'Cliente Correo';
  d.getElementById('pj-telefono').value = '911222333';
  d.getElementById('pj-direccion').value = 'Av. Correo 789';
  dom.window.eval('Pedidos.CONFIG.tipo = "formsubmit"; Pedidos.CONFIG.endpoint = "https://formsubmit.co/ajax/test@mail.com";');
  d.getElementById('pj-enviar').click();
  await sleep(400);
  ok(!!capturada && capturada.url === 'https://formsubmit.co/ajax/test@mail.com', 'formsubmit: POST al endpoint ajax');
  ok(capturada.body._subject.startsWith('Pedido web tortas — REF-'), 'formsubmit: asunto con ref para la bandeja');
  ok(capturada.body.pedido.includes('[[PEDIDO]]') && capturada.body.pedido.includes('[[FIN]]'), 'formsubmit: pedido entre marcadores');
  const canonico = JSON.parse(capturada.body.pedido.replace('[[PEDIDO]]', '').replace('[[FIN]]', ''));
  ok(canonico.items[0].pid === 'p1' && canonico.items[0].precio === 72 && canonico.total === 72, 'formsubmit: canonical con tamaño y total');
  ok(!!canonico.createdAt, 'formsubmit: createdAt para el orden en la bandeja');
  ok(d.getElementById('pj-modal-card').textContent.includes('Pedido REF-'), 'formsubmit: confirmación con la ref');

  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXCEPCIÓN:', e); process.exit(1); });
