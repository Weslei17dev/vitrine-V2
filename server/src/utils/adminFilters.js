'use strict';
const V = require('../validation');
function adminFilters(query, definitions) {
  const params = [];
  const clauses = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  for (const [key, definition] of Object.entries(definitions)) {
    if (query[key] == null || query[key] === '') continue;
    const [column, type = 'text'] = definition;
    let value = V.text(query[key], 'Filtro', { max: 200 });
    if (type === 'search') clauses.push(`${column} ILIKE ${add(`%${value}%`)}`);
    else if (type === 'min' || type === 'max') clauses.push(`${column} ${type === 'min' ? '>=' : '<='} ${add(V.nonNegativeMoney(value, 'Filtro de valor'))}`);
    else if (type === 'from' || type === 'to') {
      const date = new Date(`${value}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new V.ValidationError('Data de filtro inválida.');
      const placeholder = add(value);
      clauses.push(type === 'from' ? `${column} >= (${placeholder}::date::timestamp AT TIME ZONE 'America/Sao_Paulo')` : `${column} < ((${placeholder}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`);
    } else if (type === 'boolean') {
      if (!['true', 'false'].includes(value)) throw new V.ValidationError('Status de filtro inválido.');
      clauses.push(`${column}=${add(value === 'true')}`);
    } else clauses.push(`${column}=${add(value)}`);
  }
  if (query.from && query.to && query.from > query.to) throw new V.ValidationError('A data inicial não pode ser posterior à final.');
  if (query.minValue && query.maxValue && Number(query.minValue) > Number(query.maxValue)) throw new V.ValidationError('O valor mínimo não pode superar o máximo.');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  const pagination = `LIMIT ${add(limit)} OFFSET ${add(offset)}`;
  return { params, where, pagination };
}
module.exports = { adminFilters };
