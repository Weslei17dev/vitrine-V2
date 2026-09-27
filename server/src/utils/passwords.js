'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const bcrypt = require('bcryptjs');
const scrypt = promisify(crypto.scrypt);

// Scrypt considera a senha inteira, inclusive acima dos 72 bytes do bcrypt.
// Hashes bcrypt já existentes (inclusive criados por SQL) continuam válidos.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password, hash) {
  if (!hash.startsWith('scrypt$')) return bcrypt.compare(password, hash);
  const [, salt, encoded] = hash.split('$');
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(encoded)) return false;
  const key = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(key, Buffer.from(encoded, 'hex'));
}
module.exports = { hashPassword, verifyPassword };
