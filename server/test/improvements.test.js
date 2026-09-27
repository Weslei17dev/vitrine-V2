'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {hashPassword,verifyPassword} = require('../src/utils/passwords');
const {adminFilters} = require('../src/utils/adminFilters');
test('senhas novas longas usam todos os caracteres, sem truncamento bcrypt',async()=>{
  const password = 'á'.repeat(250) + '1';
  const hash = await hashPassword(password);
  assert.ok(await verifyPassword(password,hash));
  assert.equal(await verifyPassword(password.slice(0,-1)+'2',hash),false);
});
test('mantém compatibilidade com hash bcrypt criado por SQL',async()=>{
  const hash = await bcrypt.hash('ContaExistente123',4);
  assert.ok(await verifyPassword('ContaExistente123',hash));
  assert.equal(await verifyPassword('outra',hash),false);
});
test('filtros parametrizam pesquisa e aplicam paginação depois do filtro',()=>{
  const f = adminFilters({search:"' OR 1=1 --",active:'false',limit:10,offset:20}, {search:['name','search'],active:['active','boolean']});
  assert.equal(f.where,'WHERE name ILIKE $1 AND active=$2');
  assert.deepEqual(f.params,["%' OR 1=1 --%",false,10,20]);
  assert.equal(f.pagination,'LIMIT $3 OFFSET $4');
});
test('filtros recusam data impossível e faixas invertidas',()=>{
  assert.throws(()=>adminFilters({from:'2026-02-30'},{from:['created_at','from']}),/Data/);
  assert.throws(()=>adminFilters({minValue:100,maxValue:50},{minValue:['price','min'],maxValue:['price','max']}),/mínimo/);
});
