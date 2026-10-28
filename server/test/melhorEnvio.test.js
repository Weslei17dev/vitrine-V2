'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.ME_ENVIRONMENT='sandbox';
process.env.ME_CLIENT_ID='test-app';
process.env.ME_CLIENT_SECRET='test-secret';
process.env.ME_REDIRECT_URI='https://example.test/callback';
process.env.ME_USER_AGENT='Test App (test@example.test)';
process.env.ME_TOKEN_KEY=Buffer.alloc(32,17).toString('base64');
const dbPath=require.resolve('../src/db');
const db={query:async()=>({rows:[]}),connect:async()=>({query:db.query,release(){}})};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
const me=require('../src/utils/melhorEnvio');
const product={id:'11',name:'Produto',price:42,shipping_weight_kg:0.35,shipping_height_cm:8,shipping_width_cm:12,shipping_length_cm:20};
test('OAuth pode ficar habilitado sem ativar frete real no checkout',()=>{
  const previous=process.env.ME_CHECKOUT_ENABLED;
  try {
    delete process.env.ME_CHECKOUT_ENABLED;
    assert.equal(me.enabled(),true);
    assert.equal(me.checkoutEnabled(),false);
    process.env.ME_CHECKOUT_ENABLED='true';
    assert.equal(me.checkoutEnabled(),true);
  } finally {
    if(previous===undefined)delete process.env.ME_CHECKOUT_ENABLED;
    else process.env.ME_CHECKOUT_ENABLED=previous;
  }
});
test('envia dimensões unitárias e quantidades por produto',()=>{
  const rows=[product,{...product,id:'22',name:'Outro',shipping_weight_kg:1.2}];
  const payload=me.productsPayload([{productId:'11',qty:3},{productId:'22',qty:2}],rows);
  assert.equal(payload[0].weight,0.35);assert.equal(payload[0].quantity,3);
  assert.equal(payload[1].weight,1.2);assert.equal(payload[1].quantity,2);
});
test('recusa item sem medidas',()=>{
  assert.throws(()=>me.productsPayload([{productId:'11',qty:1}],[{...product,shipping_weight_kg:null}]),/peso/);
});
test('normaliza custo e impede serviço multi-volume incompatível',()=>{
  const options=me.normalizedOptions([
    {id:1,name:'PAC',price:'21.20',company:{name:'Correios'},packages:[{weight:1},{weight:1}]},
    {id:2,name:'Expresso',price:'32.00',custom_price:'34.50',delivery_time:5,company:{name:'Outra'},packages:[{weight:1},{weight:1}]},
    {id:3,error:'not available'}
  ]);
  assert.equal(options.length,1);assert.equal(options[0].price,34.5);assert.equal(options[0].cost,32);
});
test('hash da cotação vincula quantidade, cor e cupom',()=>{
  const items=[{productId:'11',qty:1,selectedColor:'Azul'}];
  assert.notEqual(me.cartHash(items,''),me.cartHash([{...items[0],qty:2}],''));
  assert.notEqual(me.cartHash(items,''),me.cartHash(items,'FRETE'));
});
test('usa as dimensões de packages retornadas pela API ao preparar volumes',()=>{
  assert.deepEqual(me.volumesFromPackages([{dimensions:{height:12,width:20,length:30},weight:'1.5'}]),[{height:12,width:20,length:30,weight:1.5}]);
  assert.throws(()=>me.volumesFromPackages([{height:12,width:20,length:30,weight:'1.5'}]),/dimensões/);
});
test('OAuth recusa state desconhecido sem trocar código por tokens',async()=>{
  const oldFetch=global.fetch;
  let calls=0;
  global.fetch=async()=>{calls++;throw Error('Não deveria ser chamado');};
  try {await assert.rejects(me.finish('code','state-desconhecido'),/Estado OAuth inválido/);assert.equal(calls,0);}
  finally {global.fetch=oldFetch;}
});
test('renova token vencido e persiste somente valores cifrados',async()=>{
  const oldFetch=global.fetch;
  const oldQuery=db.query;
  const oldConnect=db.connect;
  let row=null;
  const grants=[];
  db.query=async(sql,params=[])=>{
    if(sql.startsWith('DELETE FROM me_oauth_states'))return {rows:[{admin_id:'admin'}]};
    if(sql.startsWith('INSERT INTO me_oauth_tokens')){
      row={environment:params[0],access_cipher:params[1],refresh_cipher:params[2],expires_at:params[3],refresh_expires_at:params[4]};
      return {rows:[]};
    }
    if(sql.startsWith('SELECT * FROM me_oauth_tokens'))return {rows:[row]};
    return {rows:[]};
  };
  db.connect=async()=>({query:(...args)=>db.query(...args),release(){}});
  global.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);grants.push(body.grant_type);
    return {ok:true,json:async()=>({access_token:'access-'+grants.length,refresh_token:'refresh-'+grants.length,expires_in:3600})};
  };
  try {
    await me.finish('sample-code','sample-state');
    assert.equal(row.environment,'sandbox');
    assert.ok(!row.access_cipher.includes('access-1'));
    assert.ok(!row.refresh_cipher.includes('refresh-1'));
    row.expires_at=new Date(Date.now()-1000);
    assert.equal(await me.accessToken(),'access-2');
    assert.deepEqual(grants,['authorization_code','refresh_token']);
  } finally {global.fetch=oldFetch;db.query=oldQuery;db.connect=oldConnect;}
});
