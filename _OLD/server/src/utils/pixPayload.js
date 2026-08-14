/* ============================================================================
   pixPayload.js (servidor)
   ----------------------------------------------------------------------------
   Mesma lógica de js/pixPayload.js do front-end, em CommonJS, usada para
   gerar o código Pix "Copia e Cola" (padrão EMV do Banco Central) no momento
   em que um pedido é criado — usando a chave configurada em site_content.
   ============================================================================ */

function tlv(id, value) {
  const length = String(value.length).padStart(2, '0');
  return `${id}${length}${value}`;
}

function sanitize(str, maxLen) {
  const clean = String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .trim()
    .slice(0, maxLen);
  return clean || '-';
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function build({ chave, nome, cidade, valor, txid }) {
  const merchantAccount = tlv('00', 'br.gov.bcb.pix') + tlv('01', String(chave || '').trim());
  const txidClean = String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const additionalData = tlv('05', txidClean);

  let payload =
    tlv('00', '01') +
    tlv('26', merchantAccount) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', Number(valor || 0).toFixed(2)) +
    tlv('58', 'BR') +
    tlv('59', sanitize(nome, 25)) +
    tlv('60', sanitize(cidade, 15)) +
    tlv('62', additionalData);

  payload += '6304';
  payload += crc16(payload);
  return payload;
}

module.exports = { build };
