'use strict';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

function text(value, label, options = {}) {
  const { required = true, min = required ? 1 : 0, max = 255 } = options;
  const normalized = String(value == null ? '' : value).trim();
  if (required && !normalized) throw new ValidationError(`${label} é obrigatório.`);
  if (normalized && normalized.length < min) throw new ValidationError(`${label} é muito curto.`);
  if (normalized.length > max) throw new ValidationError(`${label} ultrapassa ${max} caracteres.`);
  return normalized;
}

function normalizeEmail(value) {
  const normalized = text(value, 'E-mail', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ValidationError('Informe um e-mail válido.');
  }
  return normalized;
}

function password(value, label = 'Senha') {
  const normalized = String(value || '');
  if (!normalized) throw new ValidationError(`${label} é obrigatória.`);
  return normalized;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function phone(value) {
  const normalized = digits(value);
  if (normalized.length < 10 || normalized.length > 13) {
    throw new ValidationError('Informe um telefone válido com DDD.');
  }
  return normalized;
}

function zip(value) {
  const normalized = digits(value);
  if (normalized.length !== 8) throw new ValidationError('Informe um CEP válido.');
  return normalized;
}

function state(value) {
  const normalized = text(value, 'Estado', { min: 2, max: 2 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw new ValidationError('Informe a UF com duas letras.');
  return normalized;
}

function uuid(value, label = 'Identificador') {
  const normalized = String(value || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new ValidationError(`${label} inválido.`);
  }
  return normalized;
}

function positiveInteger(value, label, max = 999999) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new ValidationError(`${label} inválida.`);
  }
  return number;
}

function nonNegativeInteger(value, label, max = 999999) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new ValidationError(`${label} inválido.`);
  }
  return number;
}

function positiveMoney(value, label = 'Preço') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 99999999.99) {
    throw new ValidationError(`${label} inválido.`);
  }
  return Math.round(number * 100) / 100;
}

function nonNegativeMoney(value, label = 'Valor') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 99999999.99) {
    throw new ValidationError(`${label} inválido.`);
  }
  return Math.round(number * 100) / 100;
}

function optionalMoney(value, label = 'Valor') {
  if (value == null || value === '') return null;
  return positiveMoney(value, label);
}

function timestamp(value, label = 'Data de atualização') {
  const normalized = String(value || '');
  const date = new Date(normalized);
  if (!normalized || Number.isNaN(date.getTime())) throw new ValidationError(`${label} inválida.`);
  return date.toISOString();
}

function color(value) {
  const normalized = String(value || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) throw new ValidationError('Cor inválida.');
  return normalized.toUpperCase();
}

function imageSource(value, label = 'Imagem') {
  if (!value) return null;
  const source = String(value).trim();
  if (source.length > 400000) throw new ValidationError(`${label} ultrapassa o limite aproximado de 300 KB.`);
  const isHttps = /^https:\/\/[^\s]+$/i.test(source);
  const isLocal = /^img\/[A-Za-z0-9._/-]+$/.test(source) && !source.includes('..');
  const isDataImage = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(source);
  if (!isHttps && !isLocal && !isDataImage) throw new ValidationError(`${label} possui formato ou endereço inválido.`);
  return source;
}

module.exports = {
  ValidationError,
  text,
  normalizeEmail,
  password,
  phone,
  zip,
  state,
  uuid,
  positiveInteger,
  nonNegativeInteger,
  positiveMoney,
  nonNegativeMoney,
  optionalMoney,
  timestamp,
  color,
  imageSource
};
