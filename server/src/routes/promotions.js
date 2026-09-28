'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const V = require('../validation');
const { normalizeCode } = require('../utils/promotions');
const { recordAudit } = require('../utils/audit');
const router = express.Router();

function validate(body) {
  const kind = String(body.kind || '');
  const scope = String(body.scope || '');
  const discountType = String(body.discountType || '');
  if (!['automatic','coupon'].includes(kind) || !['all','category','product'].includes(scope) || !['percent','fixed','free_shipping'].includes(discountType)) {
    throw new V.ValidationError('Tipo de desconto ou abrangência inválido.');
  }
  if (discountType === 'free_shipping' && kind !== 'coupon') throw new V.ValidationError('Frete grátis precisa ser um cupom.');
  const value = discountType === 'free_shipping' ? 0 : V.positiveMoney(body.value, 'Valor do desconto');
  if (discountType === 'percent' && value > 100) throw new V.ValidationError('O percentual não pode ultrapassar 100%.');
  const code = kind === 'coupon' ? normalizeCode(body.code) : null;
  if (kind === 'coupon' && !code) throw new V.ValidationError('Informe o código do cupom.');
  const category = scope === 'category' ? V.text(body.category, 'Categoria', {min:2,max:80}) : null;
  const productId = scope === 'product' ? V.uuid(body.productId, 'Produto') : null;
  const maxUses = kind === 'coupon' && body.maxUses !== '' && body.maxUses != null
    ? V.positiveInteger(body.maxUses, 'Limite de usos', 1000000) : null;
  const start = body.startsAt ? new Date(body.startsAt) : null;
  const end = body.endsAt ? new Date(body.endsAt) : null;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && start >= end)) {
    throw new V.ValidationError('Confira as datas de início e término.');
  }
  return {
    name: V.text(body.name, 'Nome do desconto', {min:2,max:100}), kind, code, scope, category, productId,
    discountType, value, maxUses, startsAt:start, endsAt:end, active:body.active !== false
  };
}

function publicRule(row) {
  return {
    id:row.id, name:row.name, kind:row.kind, code:row.code, scope:row.scope,
    category:row.category, productId:row.product_id, discountType:row.discount_type,
    value:Number(row.value), maxUses:row.max_uses, usedCount:row.used_count,
    startsAt:row.starts_at, endsAt:row.ends_at, active:row.active
  };
}

router.use(requireAdmin);
router.get('/', async (_req,res,next) => {
  try { const rows = await pool.query('SELECT * FROM promotions ORDER BY created_at DESC, id'); res.json(rows.rows.map(publicRule)); }
  catch (err) { next(err); }
});

router.post('/', async (req,res,next) => {
  try {
    const p = validate(req.body || {});
    if (p.productId && !(await pool.query('SELECT 1 FROM products WHERE id=$1',[p.productId])).rows[0]) throw new V.ValidationError('Produto não encontrado.');
    const result = await pool.query(`INSERT INTO promotions(name,kind,code,scope,category,product_id,discount_type,value,max_uses,starts_at,ends_at,active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [p.name,p.kind,p.code,p.scope,p.category,p.productId,p.discountType,p.value,p.maxUses,p.startsAt,p.endsAt,p.active]);
    await recordAudit(pool,{adminId:req.user.id,action:'promotion.create',entityType:'promotion',entityId:result.rows[0].id,details:{name:p.name,code:p.code}});
    res.status(201).json(publicRule(result.rows[0]));
  } catch (err) { if (err.code==='23505') return res.status(409).json({message:'Este código de cupom já existe.'}); next(err); }
});

router.put('/:id', async (req,res,next) => {
  try {
    const id=V.uuid(req.params.id,'Desconto'); const p=validate(req.body || {});
    const prior=await pool.query('SELECT * FROM promotions WHERE id=$1',[id]);
    if (!prior.rows[0]) return res.status(404).json({message:'Desconto não encontrado.'});
    if (prior.rows[0].kind!==p.kind) throw new V.ValidationError('O tipo do desconto não pode ser alterado. Crie outro desconto.');
    if (p.maxUses!=null && p.maxUses < prior.rows[0].used_count) throw new V.ValidationError('O limite não pode ser menor que o número de usos realizados.');
    if (p.productId && !(await pool.query('SELECT 1 FROM products WHERE id=$1',[p.productId])).rows[0]) throw new V.ValidationError('Produto não encontrado.');
    const result=await pool.query(`UPDATE promotions SET name=$1,code=$2,scope=$3,category=$4,product_id=$5,discount_type=$6,
      value=$7,max_uses=$8,starts_at=$9,ends_at=$10,active=$11,updated_at=now() WHERE id=$12 RETURNING *`,
      [p.name,p.code,p.scope,p.category,p.productId,p.discountType,p.value,p.maxUses,p.startsAt,p.endsAt,p.active,id]);
    await recordAudit(pool,{adminId:req.user.id,action:'promotion.update',entityType:'promotion',entityId:id,details:{name:p.name,active:p.active}});
    res.json(publicRule(result.rows[0]));
  } catch (err) { if (err.code==='23505') return res.status(409).json({message:'Este código de cupom já existe.'}); next(err); }
});

router.patch('/:id/active', async (req,res,next) => {
  try {
    const id=V.uuid(req.params.id,'Desconto');
    if (typeof req.body?.active!=='boolean') throw new V.ValidationError('Informe o status do desconto.');
    const result=await pool.query('UPDATE promotions SET active=$1,updated_at=now() WHERE id=$2 RETURNING *',[req.body.active,id]);
    if (!result.rows[0]) return res.status(404).json({message:'Desconto não encontrado.'});
    await recordAudit(pool,{adminId:req.user.id,action:'promotion.status',entityType:'promotion',entityId:id,details:{active:req.body.active}});
    res.json(publicRule(result.rows[0]));
  } catch(err) { next(err); }
});

module.exports=router;
