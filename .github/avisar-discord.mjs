// Anuncia el último pedido en Discord vía webhook (URL en secrets del repo).
// Lo llama el workflow .github/workflows/pedidos.yml tras validar el pedido.
import fs from 'node:fs';

const webhook = process.env.TORTAS_DISCORD_WEBHOOK;
if (!webhook) { console.log('sin TORTAS_DISCORD_WEBHOOK; omito Discord'); process.exit(0); }

const pedidos = JSON.parse(fs.readFileSync('data/pedidos.json', 'utf8'));
const o = pedidos[0];
if (!o) { console.log('sin pedidos'); process.exit(0); }

const TAM = { P: 'Pequeña', M: 'Mediana', G: 'Grande' };
const items = o.items
  .map(it => `• ${it.qty}× ${it.name}${it.tam ? ` (${TAM[it.tam] || it.tam})` : ''}`)
  .join('\n')
  .slice(0, 1000);

const campos = [
  { name: 'Entrega', value: o.deliveryDate || 'por coordinar' },
  { name: 'Artículos', value: items || '—' },
  { name: 'Total', value: `S/ ${Number(o.total).toFixed(2)} · ${o.payMethod}`, inline: true },
  { name: 'Pago', value: o.payStatus, inline: true },
  { name: 'Teléfono', value: o.customer.phone || '—', inline: true },
  { name: 'Dirección', value: o.customer.address || '—' },
];
const personalizada = o.items.find(i => i.descripcion);
if (personalizada) {
  campos.push({ name: 'Torta personalizada', value: personalizada.descripcion.slice(0, 1000) });
}

const embed = {
  title: `Pedido ${o.id} — ${o.customer.name || 'cliente'}`,
  color: 0xc9a227,
  fields: campos,
  footer: { text: 'Tortas · Hechas a Mano — pedido desde la web' },
  timestamp: new Date(o.createdAt || Date.now()).toISOString(),
};

const imagenes = o.items.flatMap(i => i.images || []);
if (imagenes.length) {
  embed.image = { url: `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/main/${imagenes[0]}` };
}

const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'Tortas · Pedidos', embeds: [embed] }),
});
if (!res.ok) {
  console.error('discord respondió', res.status, await res.text().catch(() => ''));
  process.exit(1);
}
console.log('anunciado en Discord:', o.id);
