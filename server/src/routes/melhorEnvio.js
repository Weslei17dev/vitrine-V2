'use strict';

const express=require('express');
const pool=require('../db');
const {requireAdmin,requireAuth}=require('../auth-middleware');
const {orderLimiter}=require('../security');
const V=require('../validation');
const me=require('../utils/melhorEnvio');
const router=express.Router();

const digits=value=>String(value||'').replace(/\D/g,'');
function senderPayload(raw) {
  const result={
    name:V.text(raw.name,'Nome do remetente',{min:2,max:120}),
    email:V.normalizeEmail(raw.email), phone:V.phone(raw.phone),
    address:V.text(raw.address,'Rua de origem',{min:3,max:160}),
    number:V.text(raw.number,'Número de origem',{max:20}),
    district:V.text(raw.district,'Bairro de origem',{max:100}),
    city:V.text(raw.city,'Cidade de origem',{max:100}),
    state_abbr:V.state(raw.state_abbr),postal_code:V.zip(raw.postal_code),
    complement:V.text(raw.complement,'Complemento',{required:false,max:100}),
    state_register:V.text(raw.state_register,'Inscrição estadual',{required:false,max:25})
  };
  const doc=digits(raw.document),company=digits(raw.company_document);
  if (company) {if(company.length!==14)throw new V.ValidationError('CNPJ do remetente inválido.');result.company_document=company;}
  else {if(doc.length!==11)throw new V.ValidationError('CPF do remetente inválido.');result.document=doc;}
  const cnae=digits(raw.economic_activity_code);
  if(cnae) {if(cnae.length!==7)throw new V.ValidationError('CNAE do remetente inválido (7 dígitos).');result.economic_activity_code=cnae;}
  return result;
}
function recipient(order,body) {
  const document=digits(body.document);
  if(![11,14].includes(document.length))throw new V.ValidationError('Informe o CPF ou CNPJ do destinatário para a etiqueta.');
  const data={
    name:V.text(order.customer_name,'Destinatário',{max:120}),
    email:V.normalizeEmail(body.email),phone:V.phone(order.shipping_phone),
    address:V.text(body.address,'Rua de entrega (sem número)',{max:160}),
    number:V.text(body.number,'Número de entrega',{max:20}),
    district:V.text(body.district,'Bairro de entrega',{max:100}),
    city:V.text(order.shipping_city,'Cidade de entrega',{max:100}),
    state_abbr:V.state(order.shipping_state),postal_code:V.zip(order.shipping_zip),
    complement:V.text(body.complement,'Complemento',{required:false,max:100}),
    country_id:'BR'
  };
  data[document.length===14?'company_document':'document']=document;
  return data;
}
async function readSender() {
  const row=(await pool.query('SELECT sender FROM me_settings WHERE id=1')).rows[0];
  if(!row?.sender?.postal_code)throw me.bad('Preencha os dados do remetente em Frete no painel.',400,'missing_sender');
  return row.sender;
}
async function dataForOrder(orderId,body) {
  const order=(await pool.query('SELECT * FROM orders WHERE id=$1',[V.uuid(orderId,'Pedido')])).rows[0];
  if(!order)throw me.bad('Pedido não encontrado.',404);
  if(order.shipping_provider!=='melhor_envio')throw me.bad('Este pedido não possui cotação do Melhor Envio.',400);
  if(!['Pago','Em Produção','Enviado'].includes(order.status))throw me.bad('Confirme o pagamento do cliente antes de criar a etiqueta.',400);
  const sender=await readSender();
  // A cotação gravada no pedido preserva os volumes escolhidos, inclusive se medidas forem editadas depois.
  const quoted=(await pool.query('SELECT options FROM me_shipping_quotes WHERE id=$1',[order.shipping_quote_id])).rows[0];
  const service=quoted?.options?.find(o=>o.id===order.shipping_service_id);
  if(!service?.packages?.length)throw me.bad('Os volumes da cotação não estão disponíveis. Consulte o pedido antes de contratar.',400);
  const to=recipient(order,body);
  const invoiceKey=digits(body.invoiceKey);
  if(invoiceKey && invoiceKey.length!==44)throw new V.ValidationError('A chave da NF-e deve ter 44 dígitos.');
  if(sender.state_register && sender.state_register!=='ISENTO' && !invoiceKey)throw new V.ValidationError('Envio comercial: informe a chave da NF-e.');
  if(invoiceKey && (!sender.company_document || !sender.state_register || sender.state_register==='ISENTO'))throw new V.ValidationError('Envio comercial: preencha CNPJ e inscrição estadual válida do remetente.');
  if(/latam/i.test(order.shipping_company||'') && sender.company_document && !sender.economic_activity_code)throw new V.ValidationError('LATAM Cargo exige o CNAE do remetente pessoa jurídica. Preencha em Frete e etiquetas.');
  const options={insurance_value:Math.round(order.items.reduce((sum,i)=>sum+Number(i.price)*i.qty,0)*100)/100,receipt:false,own_hand:false,tags:[{tag:`Pedido ${order.number}`,url:null}]};
  if(invoiceKey)options.invoice={key:invoiceKey};
  const products=order.items.map(i=>({name:String(i.name).slice(0,120),quantity:i.qty,unitary_value:Number(i.price)}));
  const volumes=me.volumesFromPackages(service.packages);
  return {order,shipment:{service:order.shipping_service_id,from:sender,to,products,volumes,options}};
}
function safePrintUrl(value) {
  const url=new URL(String(value));
  if(url.protocol!=='https:' || !['melhorenvio.com.br','www.melhorenvio.com.br','sandbox.melhorenvio.com.br'].includes(url.hostname))throw me.bad('Link de impressão inválido.',502);
  return url.toString();
}

router.get('/oauth/callback',orderLimiter,async(req,res)=>{
  try {
    await me.finish(req.query.code,req.query.state);
    const front=process.env.ME_FRONTEND_URL||'https://weslei17dev.github.io/vitrine-V2/';
    const url=new URL(front);url.searchParams.set('melhorEnvio','conectado');
    res.redirect(303,url.toString());
  } catch(_) {res.status(400).type('text/plain').send('Falha na autorização. Volte ao painel administrativo e conecte novamente.');}
});
router.get('/tracking/:id',requireAuth,orderLimiter,async(req,res,next)=>{try {
  const id=V.uuid(req.params.id,'Pedido');
  const row=(await pool.query('SELECT o.user_id,o.shipping_tracking_code,o.shipping_transport_status,s.external_id,s.environment FROM orders o LEFT JOIN me_shipments s ON s.order_id=o.id WHERE o.id=$1',[id])).rows[0];
  if(!row)throw me.bad('Pedido não encontrado.',404);
  if(req.user.role!=='admin'&&row.user_id!==req.user.id)throw me.bad('Você não tem acesso a este pedido.',403);
  if(!row.external_id||row.environment!==me.environment)return res.json({trackingCode:row.shipping_tracking_code||null,transportStatus:row.shipping_transport_status||null});
  const result=await me.request('/api/v2/me/shipment/tracking',{method:'POST',body:{orders:[row.external_id]}});
  const info=result?.[row.external_id]||result?.[0]||{};
  const tracking=String(info.tracking||row.shipping_tracking_code||'').slice(0,100);
  const status=String(info.status||row.shipping_transport_status||'').slice(0,100);
  await pool.query('UPDATE orders SET shipping_tracking_code=NULLIF($2,\'\'),shipping_transport_status=NULLIF($3,\'\') WHERE id=$1',[id,tracking,status]);
  res.json({trackingCode:tracking||null,transportStatus:status||null});
}catch(err){next(err)}});
router.use(requireAdmin);
router.get('/status',async(_req,res,next)=>{try {
  const [token,sender,missing]=await Promise.all([
    pool.query('SELECT environment,expires_at FROM me_oauth_tokens WHERE id=1'),
    pool.query('SELECT sender FROM me_settings WHERE id=1'),
    pool.query('SELECT id,name FROM products WHERE active=true AND (shipping_weight_kg IS NULL OR shipping_height_cm IS NULL OR shipping_width_cm IS NULL OR shipping_length_cm IS NULL) ORDER BY name LIMIT 100')
  ]);
  res.json({environment:me.environment,connected:me.enabled()&&token.rows[0]?.environment===me.environment,expiresAt:token.rows[0]?.expires_at||null,sender:sender.rows[0]?.sender||{},missingProducts:missing.rows});
}catch(err){next(err)}});
router.post('/oauth/start',orderLimiter,async(req,res,next)=>{try {res.json({url:await me.start(req.user.id)});}catch(err){next(err)}});
router.put('/sender',async(req,res,next)=>{try {
  const sender=senderPayload(req.body||{});
  await pool.query('INSERT INTO me_settings(id,sender) VALUES(1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET sender=$1::jsonb,updated_at=now()',[JSON.stringify(sender)]);
  res.json({sender});
}catch(err){next(err)}});
router.get('/orders/:id',async(req,res,next)=>{try {
  const row=(await pool.query('SELECT s.*,o.shipping_cost,o.shipping_company,o.shipping_service,o.shipping_tracking_code,o.shipping_transport_status FROM orders o LEFT JOIN me_shipments s ON s.order_id=o.id WHERE o.id=$1',[V.uuid(req.params.id,'Pedido')])).rows[0];
  if(!row)throw me.bad('Pedido não encontrado.',404);
  res.json({externalId:row.external_id||null,state:row.state||'not_created',lastError:row.last_error||null,cost:row.actual_cost==null?null:Number(row.actual_cost),quotedCost:row.shipping_cost==null?null:Number(row.shipping_cost),company:row.shipping_company,service:row.shipping_service,trackingCode:row.shipping_tracking_code,transportStatus:row.shipping_transport_status});
}catch(err){next(err)}});
router.post('/orders/:id/create',orderLimiter,async(req,res,next)=>{try {
  const {order,shipment}=await dataForOrder(req.params.id,req.body||{});
  if(shipment.volumes.length>1 && /correios|j&t|loggi/i.test(order.shipping_company||''))throw me.bad('Este serviço exige etiquetas separadas por volume; escolha outro serviço antes de comprar.',400);
  const inserted=await pool.query("INSERT INTO me_shipments(order_id,environment,state,fiscal) VALUES($1,$2,'creating',$3::jsonb) ON CONFLICT DO NOTHING RETURNING order_id",[order.id,me.environment,JSON.stringify(req.body||{})]);
  if(!inserted.rows.length)throw me.bad('Já existe uma operação de etiqueta para este pedido. Consulte o estado antes de tentar novamente.',409,'shipment_exists');
  try {
    const result=await me.request('/api/v2/me/cart',{method:'POST',body:shipment});
    if(!result?.id)throw me.bad('O Melhor Envio não retornou o ID. Verifique a conta antes de tentar novamente.',502);
    const actual=Number(result.price);
    if(!Number.isFinite(actual)||actual<=0)throw me.bad('O carrinho não retornou o custo a contratar. Verifique a etiqueta na conta.',502);
    await pool.query("UPDATE me_shipments SET external_id=$2,actual_cost=$3,state='cart_added',updated_at=now() WHERE order_id=$1",[order.id,String(result.id),actual]);
    res.json({state:'cart_added',externalId:String(result.id),cost:actual});
  } catch(err) {
    await pool.query("UPDATE me_shipments SET state='create_uncertain',last_error=$2,updated_at=now() WHERE order_id=$1",[order.id,'Verifique o carrinho no Melhor Envio antes de nova tentativa.']);
    throw err;
  }
}catch(err){next(err)}});
router.post('/orders/:id/reconcile',orderLimiter,async(req,res,next)=>{try {
  const id=V.uuid(req.params.id,'Pedido');
  const externalId=V.uuid(req.body?.externalId,'ID da etiqueta');
  const row=(await pool.query('SELECT s.state,s.environment,o.number,o.shipping_service_id FROM me_shipments s JOIN orders o ON o.id=s.order_id WHERE s.order_id=$1',[id])).rows[0];
  if(!row||row.state!=='create_uncertain'||row.environment!==me.environment)throw me.bad('Esta etiqueta não pode ser vinculada neste estado.',409);
  const item=await me.request('/api/v2/me/cart/'+encodeURIComponent(externalId));
  const tags=item.options?.tags||item.tags||[];
  const tag=`Pedido ${row.number}`;
  if(String(item.id)!==externalId||Number(item.service_id??item.service?.id??item.service)!==row.shipping_service_id||!tags.some(entry=>entry.tag===tag))throw me.bad('O ID informado não corresponde ao pedido e serviço original. Confira o carrinho do Melhor Envio.',409);
  const cost=Number(item.price);
  if(!Number.isFinite(cost)||cost<=0)throw me.bad('Não foi possível verificar o custo desta etiqueta.',409);
  const saved=await pool.query("UPDATE me_shipments SET external_id=$2,actual_cost=$3,state='cart_added',last_error=NULL,updated_at=now() WHERE order_id=$1 AND state='create_uncertain' RETURNING external_id",[id,externalId,cost]);
  if(!saved.rows.length)throw me.bad('O estado da etiqueta mudou. Atualize o pedido.',409);
  res.json({state:'cart_added',externalId,cost});
}catch(err){next(err)}});
router.post('/orders/:id/buy',orderLimiter,async(req,res,next)=>{try {
  const id=V.uuid(req.params.id,'Pedido');
  const row=(await pool.query("SELECT s.*,o.status AS order_status FROM me_shipments s JOIN orders o ON o.id=s.order_id WHERE s.order_id=$1",[id])).rows[0];
  if(!row?.external_id||row.state!=='cart_added')throw me.bad('Etiqueta indisponível para compra ou já em processamento.',409);
  if(!['Pago','Em Produção','Enviado'].includes(row.order_status))throw me.bad('Confirme o pagamento do pedido antes da compra.',400);
  if(req.body?.confirm!==true||row.actual_cost==null||Math.round(Number(req.body?.confirmedCost)*100)!==Math.round(Number(row.actual_cost)*100))throw me.bad('Confirme explicitamente o custo do frete exibido no painel.',400);
  const lock=await pool.query("UPDATE me_shipments SET state='checkout_pending',confirmed_by=$2,confirmed_at=now(),updated_at=now() WHERE order_id=$1 AND state='cart_added' RETURNING external_id",[id,req.user.id]);
  if(!lock.rows.length)throw me.bad('Compra já iniciada. Consulte o estado do envio.',409);
  try {
    await me.request('/api/v2/me/shipment/checkout',{method:'POST',body:{orders:[row.external_id]}});
    await pool.query("UPDATE me_shipments SET state='paid',updated_at=now() WHERE order_id=$1",[id]);
    res.json({state:'paid'});
  } catch(err) {
    await pool.query("UPDATE me_shipments SET state='checkout_uncertain',last_error='Pagamento indefinido. Confira no Melhor Envio e sincronize; não repita a compra.',updated_at=now() WHERE order_id=$1",[id]);
    throw err;
  }
}catch(err){next(err)}});
router.post('/orders/:id/sync',orderLimiter,async(req,res,next)=>{try {
  const id=V.uuid(req.params.id,'Pedido');
  const row=(await pool.query('SELECT * FROM me_shipments WHERE order_id=$1',[id])).rows[0];
  if(!row?.external_id)throw me.bad('ID da etiqueta ausente. Consulte o carrinho do Melhor Envio para reconciliar manualmente.',409);
  if(row.environment!==me.environment)throw me.bad('Ambiente da etiqueta diferente do ambiente configurado.',409);
  const info=await me.request('/api/v2/me/orders/'+encodeURIComponent(row.external_id));
  const state=String(info.status||info.state||'').toLowerCase();
  const paid=['released','posted','delivered','generated'].includes(state)||Boolean(info.paid_at);
  const nextState=paid ? (info.generated_at||['generated','printed','posted','delivered'].includes(state)?'generated':'paid') : 'cart_added';
  if(row.state==='checkout_uncertain' && !paid)throw me.bad('A compra ainda não foi confirmada no Melhor Envio. Confira a carteira antes de qualquer nova tentativa.',409);
  await pool.query('UPDATE me_shipments SET state=$2,updated_at=now() WHERE order_id=$1',[id,nextState]);
  let trackingInfo={};
  try {const response=await me.request('/api/v2/me/shipment/tracking',{method:'POST',body:{orders:[row.external_id]}});trackingInfo=response?.[row.external_id]||response?.[0]||{};} catch (_) { /* A consulta do pedido ainda pode atualizar o estado sem rastreamento. */ }
  const tracking=String(trackingInfo.tracking||info.tracking||info.self_tracking||'').slice(0,100);
  const transport=String(trackingInfo.status||state||'').slice(0,100);
  await pool.query('UPDATE orders SET shipping_tracking_code=NULLIF($2,\'\'),shipping_transport_status=$3 WHERE id=$1',[id,tracking,transport||null]);
  res.json({state:nextState,trackingCode:tracking,transportStatus:transport});
}catch(err){next(err)}});
router.post('/orders/:id/generate',orderLimiter,async(req,res,next)=>{try {
  const id=V.uuid(req.params.id,'Pedido');
  const locked=await pool.query("UPDATE me_shipments SET state='generate_pending',updated_at=now() WHERE order_id=$1 AND state='paid' RETURNING external_id",[id]);
  if(!locked.rows.length)throw me.bad('A etiqueta precisa estar paga e ainda não gerada.',409);
  try {await me.request('/api/v2/me/shipment/generate',{method:'POST',body:{orders:[locked.rows[0].external_id]}});
    await pool.query("UPDATE me_shipments SET state='generated',updated_at=now() WHERE order_id=$1",[id]);res.json({state:'generated'});
  } catch(err) {await pool.query("UPDATE me_shipments SET state='generate_uncertain',updated_at=now() WHERE order_id=$1",[id]);throw err;}
}catch(err){next(err)}});
router.post('/orders/:id/print',orderLimiter,async(req,res,next)=>{try {
  const id=V.uuid(req.params.id,'Pedido');
  const row=(await pool.query('SELECT * FROM me_shipments WHERE order_id=$1',[id])).rows[0];
  if(!row?.external_id||row.environment!==me.environment||!['generated','printed'].includes(row.state))throw me.bad('Gere a etiqueta primeiro.',409);
  const result=await me.request('/api/v2/me/shipment/print',{method:'POST',body:{orders:[row.external_id],mode:'private'}});
  const link=typeof result==='string'?result:(result.url||result.link);
  res.json({url:safePrintUrl(link)});
}catch(err){next(err)}});

module.exports=router;
