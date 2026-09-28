'use strict';
const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const { parseReportFilters } = require('../utils/reporting');
const router = express.Router();

const salesQuery = `
WITH lines AS (
  SELECT o.created_at, item->>'productId' AS product_id,
    COALESCE(item->>'name',p.name,'Produto removido') AS name,
    CASE WHEN item->>'qty' ~ '^[0-9]{1,3}$' THEN (item->>'qty')::numeric ELSE 0 END AS qty,
    CASE WHEN item->>'subtotal' ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$' THEN (item->>'subtotal')::numeric
      ELSE (CASE WHEN item->>'price' ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$' THEN (item->>'price')::numeric ELSE 0 END)
        * (CASE WHEN item->>'qty' ~ '^[0-9]{1,3}$' THEN (item->>'qty')::numeric ELSE 0 END) END AS revenue,
    CASE WHEN item->>'unitCost' ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$' THEN (item->>'unitCost')::numeric ELSE NULL END AS cost
  FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.items) item
  LEFT JOIN products p ON p.id::text=item->>'productId'
  WHERE o.status IN ('Pago','Em Produção','Enviado','Finalizado')
    AND o.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND o.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND ($3::text IS NULL OR item->>'productId'=$3)
    AND ($4::text IS NULL OR p.category=$4)
)
SELECT product_id, MAX(name) AS name, SUM(qty) AS units,
  SUM(revenue) AS revenue,
  COALESCE(SUM(revenue) FILTER(WHERE cost IS NOT NULL),0) AS covered_revenue,
  COALESCE(SUM(qty*cost),0) AS cost,
  COALESCE(SUM(qty) FILTER(WHERE cost IS NULL),0) AS missing_units
FROM lines GROUP BY product_id ORDER BY revenue DESC`;

const inventoryQuery = `SELECT id, name, category, price, cost_price, stock, active
  FROM products WHERE ($1::text IS NULL OR id::text=$1) AND ($2::text IS NULL OR category=$2)
  ORDER BY name`;

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const filters = parseReportFilters(req.query);
    const [sales, inventory] = await Promise.all([
      pool.query(salesQuery, [filters.startDate, filters.endDate, filters.productId, filters.category]),
      pool.query(inventoryQuery, [filters.productId, filters.category])
    ]);
    const products = sales.rows.map((row) => ({
      id: row.product_id, name: row.name, units: Number(row.units), revenue: Number(row.revenue),
      coveredRevenue: Number(row.covered_revenue), cost: Number(row.cost),
      profit: Number(row.covered_revenue) - Number(row.cost), missingUnits: Number(row.missing_units)
    }));
    const summary = products.reduce((s, p) => {
      for (const field of ['units','revenue','coveredRevenue','cost','profit','missingUnits']) s[field] += p[field];
      return s;
    }, { units:0, revenue:0, coveredRevenue:0, cost:0, profit:0, missingUnits:0 });
    summary.margin = summary.coveredRevenue > 0 ? summary.profit / summary.coveredRevenue * 100 : null;
    const stock = inventory.rows.map((p) => ({ id:p.id, name:p.name, category:p.category, active:p.active,
      stock:Number(p.stock), price:Number(p.price), cost:p.cost_price == null ? null : Number(p.cost_price) }));
    summary.inventoryValue = stock.reduce((s,p) => s + (p.cost == null ? 0 : p.stock*p.cost),0);
    summary.productsWithoutCost = stock.filter((p) => p.cost == null).length;
    res.setHeader('Cache-Control','no-store');
    res.json({ filters, summary, products, inventory:stock });
  } catch (err) { next(err); }
});
module.exports = router;
module.exports.salesQuery = salesQuery;
module.exports.inventoryQuery = inventoryQuery;
