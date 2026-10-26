'use strict';

const crypto = require('node:crypto');
const pool = require('../db');
const V = require('../validation');

const environment = process.env.ME_ENVIRONMENT || 'disabled';
const enabled = () => environment === 'sandbox' || environment === 'production';
const baseUrl = () => environment === 'production' ? 'https://melhorenvio.com.br' : 'https://sandbox.melhorenvio.com.br';
const scopes = 'shipping-calculate cart-read cart-write orders-read shipping-checkout shipping-generate shipping-print shipping-tracking';
const bad = (message, status = 400, code) => Object.assign(new Error(message), {status, code});
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cartHash = (items, couponCode) => hash(JSON.stringify({items:items.map(({productId,qty,selectedColor}) => ({productId,qty,selectedColor:selectedColor||null})),couponCode:couponCode||''}));
const key = () => {
  const raw = Buffer.from(process.env.ME_TOKEN_KEY || '', 'base64');
  if (raw.length !== 32) throw bad('Configure ME_TOKEN_KEY (32 bytes em base64) no servidor.', 503);
  return raw;
};
function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
function open(value) {
  const payload = Buffer.from(value,'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm',key(),payload.subarray(0,12));
  decipher.setAuthTag(payload.subarray(12,28));
  return Buffer.concat([decipher.update(payload.subarray(28)),decipher.final()]).toString('utf8');
}
function configured() {
  if (!enabled()) throw bad('Ative ME_ENVIRONMENT no servidor para cotar com o Melhor Envio.',503,'shipping_unavailable');
  if (!process.env.ME_CLIENT_ID || !process.env.ME_CLIENT_SECRET || !process.env.ME_REDIRECT_URI || !process.env.ME_USER_AGENT) {
    throw bad('Configure ME_CLIENT_ID, ME_CLIENT_SECRET, ME_REDIRECT_URI e ME_USER_AGENT no Render.',503,'shipping_unavailable');
  }
  key();
}
async function http(path, {method='GET',body,token,oauth=false} = {}) {
  const headers = {'Accept':'application/json','User-Agent':process.env.ME_USER_AGENT};
  if (body) headers['Content-Type']='application/json';
  if (token) headers.Authorization=`Bearer ${token}`;
  let response;
  try {
    response = await fetch(baseUrl()+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  } catch (_) { throw bad('O Melhor Envio não respondeu. Tente novamente mais tarde.',502,'shipping_unavailable'); }
  const result = await response.json().catch(()=>({}));
  if (!response.ok) {
    if (response.status === 401) throw bad('A autorização do Melhor Envio expirou. Reconecte no painel.',401,'me_unauthorized');
    // Nunca incluir corpo bruto, tokens, remetente ou destinatário em erros/logs.
    const message = response.status === 422 ? 'Confira os dados de envio e os requisitos fiscais informados.' : 'O Melhor Envio não conseguiu concluir a solicitação.';
    throw bad(message,oauth?502:response.status>=500?502:400,'me_request_failed');
  }
  return result;
}
async function saveTokens(db, result) {
  if (!result.access_token || !result.refresh_token || !Number(result.expires_in)) throw bad('Resposta de autorização incompleta.',502);
  await db.query(`INSERT INTO me_oauth_tokens(id,environment,access_cipher,refresh_cipher,expires_at,refresh_expires_at)
    VALUES(1,$1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET environment=$1,access_cipher=$2,
    refresh_cipher=$3,expires_at=$4,refresh_expires_at=$5,updated_at=now()`,[
    environment,seal(result.access_token),seal(result.refresh_token),
    new Date(Date.now()+Number(result.expires_in)*1000),Number(result.refresh_expires_in)>0 ? new Date(Date.now()+Number(result.refresh_expires_in)*1000) : null
  ]);
}
async function tokenExchange(fields, db=pool) {
  configured();
  const result = await http('/oauth/token',{method:'POST',oauth:true,body:{client_id:process.env.ME_CLIENT_ID,client_secret:process.env.ME_CLIENT_SECRET,...fields}});
  await saveTokens(db,result);
  return result;
}
async function start(adminId) {
  configured();
  const state = crypto.randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM me_oauth_states WHERE expires_at<now()');
  await pool.query('INSERT INTO me_oauth_states(state_hash,admin_id,environment,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',[hash(state),adminId,environment]);
  const url = new URL('/oauth/authorize',baseUrl());
  for(const [name,value] of Object.entries({client_id:process.env.ME_CLIENT_ID,redirect_uri:process.env.ME_REDIRECT_URI,response_type:'code',state,scope:scopes}))url.searchParams.set(name,value);
  return url.toString();
}
async function finish(code,state) {
  configured();
  if (!code || !state || String(code).length>2048 || String(state).length>256) throw bad('Autorização inválida.',400);
  const consumed = await pool.query('DELETE FROM me_oauth_states WHERE state_hash=$1 AND expires_at>now() AND environment=$2 RETURNING admin_id',[hash(state),environment]);
  if (!consumed.rows.length) throw bad('Estado OAuth inválido ou expirado. Inicie novamente pelo painel.',400);
  await tokenExchange({grant_type:'authorization_code',redirect_uri:process.env.ME_REDIRECT_URI,code});
}
async function accessToken(force=false) {
  configured();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT * FROM me_oauth_tokens WHERE id=1 FOR UPDATE')).rows[0];
    if (!row || row.environment!==environment) throw bad('Conecte a conta do Melhor Envio no painel.',503,'me_not_connected');
    if (!force && new Date(row.expires_at).getTime()>Date.now()+5*60000) {
      await client.query('COMMIT'); return open(row.access_cipher);
    }
    if (row.refresh_expires_at && new Date(row.refresh_expires_at).getTime()<Date.now()+60000) throw bad('A autorização do Melhor Envio venceu. Reconecte a conta no painel.',503,'me_not_connected');
    const updated=await tokenExchange({grant_type:'refresh_token',refresh_token:open(row.refresh_cipher)},client);
    await client.query('COMMIT'); return updated.access_token;
  } catch(err) {await client.query('ROLLBACK').catch(()=>{});throw err;} finally {client.release();}
}
async function request(path,options={}) {
  let token=await accessToken();
  try {return await http(path,{...options,token});}
  catch(err) {
    if(err.code!=='me_unauthorized')throw err;
    token=await accessToken(true);
    return http(path,{...options,token});
  }
}
function requireMeasure(row) {
  for(const [field,label] of [['shipping_weight_kg','peso (kg)'],['shipping_height_cm','altura (cm)'],['shipping_width_cm','largura (cm)'],['shipping_length_cm','comprimento (cm)']]) {
    if (!Number.isFinite(Number(row[field])) || Number(row[field])<=0) throw bad(`Preencha ${label} do produto ${row.name} no painel.`,400,'missing_dimensions');
  }
}
function productsPayload(items, rows) {
  const byId=new Map(rows.map(row=>[row.id,row]));
  return items.map((item)=>{
    const row=byId.get(item.productId);
    if(!row)throw bad('Produto indisponível.',400);
    requireMeasure(row);
    return {id:row.id,width:Number(row.shipping_width_cm),height:Number(row.shipping_height_cm),length:Number(row.shipping_length_cm),weight:Number(row.shipping_weight_kg),insurance_value:Number(row.price),quantity:item.qty};
  });
}
function normalizedOptions(result) {
  if(!Array.isArray(result))throw bad('Resposta de cotação inválida.',502,'shipping_unavailable');
  return result.filter(o=>o && !o.error && Number.isInteger(Number(o.id)) && Number(o.id)>0 && Number.isFinite(Number(o.price)) && Number(o.price)>0 && Number.isFinite(Number(o.custom_price??o.price)) && Number(o.custom_price??o.price)>0 && Array.isArray(o.packages) && o.packages.length>0)
    .filter(o=>!/azul/i.test(o.company?.name||''))
    .filter(o=>!(o.packages.length>1 && (/correios|j&t|loggi/i.test(o.company?.name||'') || Number(o.id)===27)))
    .map(o=>({id:Number(o.id),company:String(o.company?.name||'Transportadora').slice(0,80),service:String(o.name||'Serviço').slice(0,80),price:Math.round(Number(o.custom_price??o.price)*100)/100,cost:Math.round(Number(o.price)*100)/100,days:Number(o.custom_delivery_time??o.delivery_time)||null,packages:Array.isArray(o.packages)?o.packages:[]}));
}
function volumesFromPackages(packages) {
  if(!Array.isArray(packages)||!packages.length)throw bad('A cotação não trouxe volumes para a etiqueta.',409,'invalid_packages');
  const volumes=packages.map(p=>({height:Number(p.dimensions?.height),width:Number(p.dimensions?.width),length:Number(p.dimensions?.length),weight:Number(p.weight)}));
  if(volumes.some(v=>Object.values(v).some(n=>!Number.isFinite(n)||n<=0)))throw bad('A cotação não trouxe dimensões válidas dos volumes. Faça uma nova cotação.',409,'invalid_packages');
  return volumes;
}
async function calculate(items,rows,zip,sender) {
  const origin=V.zip(sender.postal_code);
  const destination=V.zip(zip);
  const result=await request('/api/v2/me/shipment/calculate',{method:'POST',body:{from:{postal_code:origin},to:{postal_code:destination},products:productsPayload(items,rows),options:{receipt:false,own_hand:false}}});
  const options=normalizedOptions(result);
  if(!options.length)throw bad('Nenhum serviço de entrega disponível para este CEP e carrinho.',422,'no_shipping_services');
  return options;
}
module.exports={environment,enabled,configured,cartHash,start,finish,request,calculate,accessToken,bad,normalizedOptions,productsPayload,volumesFromPackages};
