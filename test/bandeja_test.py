#!/usr/bin/env python3
"""Test del parser de la bandeja: corrreo FormSubmit → pedido → fusión (sin red)."""
import json
import sys

sys.path.insert(0, '.github')
from bandeja import extraer_texto, extraer_pedido, fusionar, siguiente_num  # noqa: E402

fails = 0
def ok(cond, msg):
    global fails
    print(('  OK ' if cond else ' FAIL') + ' ' + msg)
    if not cond: fails += 1

# correo como lo manda FormSubmit (texto plano con el marcador)
CORREO_PLANO = """Nuevo envío de tu formulario

ref: REF-20261005120000
nombre: Sofía Ríos
telefono: 977222333
direccion: Jr. Dulce 7, Surco
fecha: 2026-10-07
pago: transferencia
total: S/ 192.00
pedido: [[PEDIDO]]{"ref":"REF-20261005120000","cliente":{"nombre":"Sofía Ríos","telefono":"977222333","direccion":"Jr. Dulce 7, Surco","fecha":"2026-10-07","mensaje":""},"items":[{"pid":"p1","nombre":"Selva Negra","tam":"M","precio":72,"qty":1},{"pid":"p5","nombre":"Personalizada","precio":120,"qty":1,"descripcion":"Torta personalizada: tema de mariposas."}],"total":192}[[FIN]]"""

class Parte:
    def __init__(self, tipo, texto):
        self.tipo = tipo
        self.texto = texto
    def get_content_type(self): return self.tipo
    def get_payload(self, decode=True): return self.texto.encode('utf8')

class Mensaje:
    def __init__(self, partes, multipart):
        self.partes = partes
        self.multipart_ = multipart
    def is_multipart(self): return self.multipart_
    def walk(self): return self.partes
    def get_payload(self, decode=True): return self.partes[0].get_payload(decode)

# 1. extracción desde texto plano
pedido = extraer_pedido(CORREO_PLANO)
ok(pedido is not None, 'parser: pedido extraído del correo plano')
ok(pedido['ref'] == 'REF-20261005120000', 'parser: ref correcta')
ok(pedido['items'][1]['descripcion'].includes if False else 'mariposas' in pedido['items'][1]['descripcion'], 'parser: descripción personalizada intacta')

# 2. correo HTML con entidades (FormSubmit a veces escapa)
CORREO_HTML = '<table><tr><td>pedido:</td></tr><tr><td>[[PEDIDO]]{"ref":"REF-20261005120000","items":[],"total":192}[[FIN]]</td></tr></table>'
msg_html = Mensaje([Parte('text/html', CORREO_HTML.replace('<', '&lt;').replace('>', '&gt;'))], False)
# el contenido viene ya escapado: simulamos el payload con entidades
msg_html2 = Mensaje([Parte('text/html', CORREO_HTML.replace('<', '&lt;').replace('>', '&gt;').encode('utf8').decode('utf8'))], False)
pedido_html = extraer_pedido(extraer_texto(msg_html2))
ok(pedido_html is not None and pedido_html['ref'] == 'REF-20261005120000', 'parser: correo HTML escapado se decodifica')

# 3. correo sin marcador
ok(extraer_pedido('correo normal sin nada') is None, 'parser: ignora correos ajenos')

# 4. fusión: ids correlativos y dedupe por ref
existentes = [
    {'id': 'O-0001', 'ref': 'REF-VIEJA', 'createdAt': 100},
    {'id': 'O-0002', 'ref': 'REF-OTRA', 'createdAt': 200},
]
nuevos = [
    pedido,                                   # ref nueva → entra como O-0003
    pedido,                                   # misma ref → dedupe
    {'ref': 'REF-20261005130000', 'cliente': {'nombre': 'Otro'}, 'items': [], 'total': 0, 'createdAt': 300},
]
fusion, agregados = fusionar(existentes, nuevos)
ok(agregados == ['O-0003', 'O-0004'], f'fusión: ids correlativos {agregados}') if agregados == ['O-0003', 'O-0004'] else ok(False, f'fusión: ids {agregados} (esperaba O-0003/O-0004)')
ok(len(fusion) == 4, 'fusión: sin duplicados por ref')
ok(fusion[0]['id'] == 'O-0003' and fusion[0]['customer'].get('nombre') == 'Sofía Ríos', 'fusión: el más reciente primero')
ok(fusion[1]['id'] == 'O-0004' and fusion[1]['customer'].get('nombre') == 'Otro', 'fusión: segundo pedido en su lugar')

# 5. siguiente_num con archivo vacío
ok(siguiente_num([]) == 1, 'fusión: archivo vacío empieza en O-0001')

print(f'\n{"TODO OK" if not fails else str(fails) + " FALLOS"}')
sys.exit(1 if fails else 0)
