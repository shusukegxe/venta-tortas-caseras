#!/usr/bin/env python3
# Tortas · Hechas a Mano — bandeja: integra los pedidos que llegan por correo.
# El checkout (modo formsubmit) manda el pedido como correo vía FormSubmit; este
# script — que corre en GitHub Actions cada 5 minutos — lo extrae del buzón y lo
# agrega a data/pedidos.json. El push dispara el workflow "pedidos" (validación,
# pedidos.md y Discord si está configurado). Sin Apps Script de por medio.

import imaplib
import email
import json
import html as htmllib
import os
import re

USUARIO = os.environ.get('CORREO_USUARIO', '')
CLAVE = os.environ.get('CORREO_CLAVE_APP', '')
ASUNTO = 'Pedido web tortas'
MARCADOR = re.compile(r'\[\[PEDIDO\]\](.*?)\[\[FIN\]\]', re.S)

# ---------- funciones puras (testeables sin red) ----------

def extraer_texto(msg):
    """saca el cuerpo en texto del correo (plain o html sin entidades)"""
    if msg.is_multipart():
        partes = {p.get_content_type(): p for p in msg.walk()}
        if 'text/plain' in partes:
            return partes['text/plain'].get_payload(decode=True).decode('utf-8', 'replace')
        if 'text/html' in partes:
            return htmllib.unescape(partes['text/html'].get_payload(decode=True).decode('utf-8', 'replace'))
        return ''
    return msg.get_payload(decode=True).decode('utf-8', 'replace')


def extraer_pedido(texto):
    """busca [[PEDIDO]]{json}[[FIN]] en el cuerpo y lo parsea"""
    m = MARCADOR.search(texto or '')
    if not m:
        return None
    try:
        pedido = json.loads(htmllib.unescape(m.group(1)).strip())
        if not pedido.get('ref') or not isinstance(pedido.get('items'), list):
            return None
        return pedido
    except Exception:
        return None


def siguiente_num(pedidos):
    nums = [int(p['id'][2:]) for p in pedidos
            if str(p.get('id', '')).startswith('O-') and p['id'][2:].isdigit()]
    return max(nums, default=0) + 1


def fusionar(pedidos, nuevos):
    """agrega los pedidos nuevos (dedupe por ref), asigna id O-XXXX y los normaliza"""
    import time
    out = list(pedidos)
    seq = siguiente_num(out)
    agregados = []
    for p in nuevos:
        if not p or any(x.get('ref') == p.get('ref') for x in out):
            continue
        oid = 'O-' + str(seq).zfill(4)
        seq += 1
        out.insert(0, {
            'id': oid,
            'ref': p.get('ref'),
            'customer': p.get('cliente', {}),
            'items': p.get('items', []),
            'total': p.get('total', 0),
            'payMethod': p.get('pago', 'transferencia'),
            'payStatus': 'pendiente',
            'status': 'nuevo',
            'deliveryDate': p.get('cliente', {}).get('fecha', ''),
            'createdAt': p.get('createdAt') or int(time.time() * 1000),
            'history': [{'status': 'nuevo', 'at': p.get('createdAt') or int(time.time() * 1000)}],
        })
        agregados.append(oid)
    out.sort(key=lambda x: x.get('createdAt', 0), reverse=True)
    return out, agregados


def cuerpo_a_nuevos(texto):
    """de un correo FormSubmit puede venir más de un marcador; devuelve lista"""
    return [p for p in (extraer_pedido(texto),) if p]

# ---------- main: IMAP ----------

def main():
    if not USUARIO or not CLAVE:
        print('sin CORREO_USUARIO/CORREO_CLAVE_APP; omito la bandeja')
        return
    mail = imaplib.IMAP4_SSL('imap.gmail.com')
    mail.login(USUARIO, CLAVE)
    mail.select('inbox')

    _, data = mail.search(None, 'UNSEEN', f'SUBJECT "{ASUNTO}"')
    numeros = data[0].split() if data and data[0] else []
    nuevos, procesados = [], []
    for num in numeros:
        _, partes = mail.fetch(num, '(RFC822)')
        msg = email.message_from_bytes(partes[0][1])
        pedido = extraer_pedido(extraer_texto(msg))
        if pedido:
            nuevos.append(pedido)
            procesados.append(num)

    with open('data/pedidos.json', encoding='utf8') as f:
        actuales = json.load(f)
    fusion, agregados = fusionar(actuales, nuevos)

    if not agregados:
        print('sin pedidos nuevos en el buzón')
        return

    with open('data/pedidos.json', 'w', encoding='utf8') as f:
        json.dump(fusion, f, ensure_ascii=False, indent=2)
    for num in procesados:
        mail.store(num, '+FLAGS', '\\Seen')
    mail.logout()
    print('integrados:', ', '.join(agregados))


if __name__ == '__main__':
    main()
