'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const { expirePendingOrders } = require('../utils/orderLifecycle');
const { parseReportFilters, percentChange } = require('../utils/reporting');

const router = express.Router();

const RECOGNIZED_STATUSES = "'Pago','Em Produção','Enviado','Finalizado'";
const PENDING_STATUSES = "'Aguardando Pagamento','Aguardando Confirmação'";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildContext(filters, startDate, endDate) {
  const params = [startDate, endDate];
  const baseWhere = [
    "o.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')",
    "o.created_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo')"
  ];
  const itemWhere = [];
  const inventoryWhere = ['p.active=true'];
  const accountWhere = [
    "u.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')",
    "u.created_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo')",
    "u.role='client'"
  ];

  let customerPlaceholder = null;
  if (filters.customerId) {
    params.push(filters.customerId);
    customerPlaceholder = `$${params.length}`;
    baseWhere.push(`o.user_id=${customerPlaceholder}::uuid`);
    accountWhere.push(`u.id=${customerPlaceholder}::uuid`);
  }
  if (filters.status) {
    params.push(filters.status);
    baseWhere.push(`o.status=$${params.length}::text`);
  }
  if (filters.productId) {
    params.push(filters.productId);
    const placeholder = `$${params.length}`;
    baseWhere.push(`o.items @> jsonb_build_array(jsonb_build_object('productId', ${placeholder}::text))`);
    itemWhere.push(`ri.product_id=${placeholder}::text`);
    inventoryWhere.push(`p.id=${placeholder}::uuid`);
  }
  if (filters.category) {
    params.push(filters.category);
    const placeholder = `$${params.length}`;
    itemWhere.push(`ri.category=${placeholder}::text`);
    inventoryWhere.push(`p.category=${placeholder}::text`);
  }

  return {
    params,
    baseWhere: baseWhere.join(' AND '),
    accountWhere: accountWhere.join(' AND '),
    itemWhere: itemWhere.length ? itemWhere.join(' AND ') : 'TRUE',
    inventoryWhere: inventoryWhere.join(' AND '),
    itemFiltered: itemWhere.length > 0,
    customerPlaceholder,
    startDate,
    endDate,
    granularity: filters.granularity
  };
}

function baseCtes(context) {
  const itemRevenueExpression = `CASE
    WHEN (entry.item->>'subtotal') ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$'
      THEN (entry.item->>'subtotal')::numeric
    ELSE
      (CASE WHEN (entry.item->>'price') ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$' THEN (entry.item->>'price')::numeric ELSE 0 END)
      * (CASE WHEN (entry.item->>'qty') ~ '^[0-9]{1,3}$' THEN (entry.item->>'qty')::integer ELSE 0 END)
  END`;

  return `
    base_orders AS (
      SELECT o.* FROM orders o WHERE ${context.baseWhere}
    ),
    normalized_items AS (
      SELECT
        o.id AS order_id,
        o.user_id,
        o.created_at,
        o.status,
        entry.item->>'productId' AS product_id,
        NULLIF(entry.item->>'name', '') AS snapshot_name,
        CASE WHEN (entry.item->>'qty') ~ '^[0-9]{1,3}$' THEN (entry.item->>'qty')::integer ELSE 0 END AS qty,
        CASE WHEN (entry.item->>'price') ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$' THEN (entry.item->>'price')::numeric ELSE 0 END AS unit_price,
        ${itemRevenueExpression} AS item_revenue
      FROM base_orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END
      ) AS entry(item)
    ),
    raw_items AS (
      SELECT
        ni.*,
        p.name AS current_name,
        p.category,
        p.stock,
        p.active,
        p.price AS current_price
      FROM normalized_items ni
      LEFT JOIN products p ON p.id::text=ni.product_id
    ),
    matched_items AS (
      SELECT ri.* FROM raw_items ri WHERE ${context.itemWhere}
    ),
    scoped_orders AS (
      SELECT bo.*
      FROM base_orders bo
      WHERE ${context.itemFiltered ? 'EXISTS (SELECT 1 FROM matched_items mi WHERE mi.order_id=bo.id)' : 'TRUE'}
    ),
    matched_by_order AS (
      SELECT
        mi.order_id,
        COALESCE(SUM(mi.qty), 0)::integer AS units,
        COALESCE(SUM(mi.item_revenue), 0)::numeric AS item_revenue
      FROM matched_items mi
      GROUP BY mi.order_id
    ),
    first_purchases AS (
      SELECT user_id, MIN(created_at) AS first_purchase_at
      FROM orders
      WHERE user_id IS NOT NULL AND status IN (${RECOGNIZED_STATUSES})
      GROUP BY user_id
    ),
    customer_metrics_base AS (
      SELECT
        o.user_id,
        COALESCE(u.name, (array_agg(o.customer_name ORDER BY o.created_at DESC))[1], 'Cliente') AS name,
        COALESCE(
          (array_agg(NULLIF(o.shipping_city, '') ORDER BY o.created_at DESC)
            FILTER (WHERE NULLIF(o.shipping_city, '') IS NOT NULL))[1],
          u.city,
          'Não informado'
        ) AS city,
        COALESCE(
          (array_agg(NULLIF(o.shipping_state, '') ORDER BY o.created_at DESC)
            FILTER (WHERE NULLIF(o.shipping_state, '') IS NOT NULL))[1],
          u.state,
          ''
        ) AS state,
        COUNT(*)::integer AS order_count,
        COALESCE(SUM(${context.itemFiltered ? 'mbo.item_revenue' : 'o.total'}), 0)::numeric AS revenue,
        COALESCE(SUM(mbo.units), 0)::integer AS units,
        MAX(o.created_at) AS last_order_at,
        fp.first_purchase_at
      FROM scoped_orders o
      LEFT JOIN matched_by_order mbo ON mbo.order_id=o.id
      LEFT JOIN users u ON u.id=o.user_id
      LEFT JOIN first_purchases fp ON fp.user_id=o.user_id
      WHERE o.user_id IS NOT NULL AND o.status IN (${RECOGNIZED_STATUSES})
      GROUP BY o.user_id, u.name, u.city, u.state, fp.first_purchase_at
    ),
    customer_metrics AS (
      SELECT
        cmb.*,
        CASE
          WHEN cmb.first_purchase_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND cmb.first_purchase_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo') THEN 'Novo'
          WHEN EXTRACT(EPOCH FROM (((($2::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo') - cmb.last_order_at)) / 86400 > 90 THEN 'Em risco'
          WHEN cmb.order_count >= 3 AND cmb.revenue >= AVG(cmb.revenue) OVER () THEN 'VIP'
          WHEN cmb.order_count >= 2 THEN 'Recorrente'
          ELSE 'Ocasional'
        END AS segment,
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (((($2::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo') - cmb.last_order_at)) / 86400))::integer AS recency_days
      FROM customer_metrics_base cmb
    )`;
}

function buildSummaryQuery(context) {
  const revenueExpression = context.itemFiltered
    ? "COALESCE((SELECT SUM(item_revenue) FROM matched_items WHERE status IN (" + RECOGNIZED_STATUSES + ")), 0)"
    : "COALESCE(SUM(total) FILTER (WHERE status IN (" + RECOGNIZED_STATUSES + ")), 0)";

  return `
    WITH ${baseCtes(context)}
    SELECT jsonb_build_object(
      'orderSummary', (
        SELECT jsonb_build_object(
          'totalOrders', COUNT(*)::integer,
          'paidOrders', COUNT(*) FILTER (WHERE status IN (${RECOGNIZED_STATUSES}))::integer,
          'pendingOrders', COUNT(*) FILTER (WHERE status IN (${PENDING_STATUSES}))::integer,
          'cancelledOrders', COUNT(*) FILTER (WHERE status='Cancelado')::integer,
          'revenue', ${revenueExpression},
          'grossOrderValue', COALESCE(SUM(total) FILTER (WHERE status <> 'Cancelado'), 0),
          'shippingRevenue', COALESCE(SUM(shipping_total) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0),
          'buyers', COUNT(DISTINCT user_id) FILTER (WHERE status IN (${RECOGNIZED_STATUSES}))::integer
        ) FROM scoped_orders
      ),
      'itemSummary', (
        SELECT jsonb_build_object(
          'units', COALESCE(SUM(qty) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0)::integer,
          'itemRevenue', COALESCE(SUM(item_revenue) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0),
          'distinctProducts', COUNT(DISTINCT product_id) FILTER (WHERE status IN (${RECOGNIZED_STATUSES}))::integer
        ) FROM matched_items
      ),
      'customerSummary', (
        SELECT jsonb_build_object(
          'repeatBuyers', COUNT(*) FILTER (WHERE order_count >= 2)::integer,
          'newBuyers', COUNT(*) FILTER (
            WHERE first_purchase_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
              AND first_purchase_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo')
          )::integer
        ) FROM customer_metrics
      ),
      'accountsCreated', (SELECT COUNT(*)::integer FROM users u WHERE ${context.accountWhere})
    ) AS report`;
}

function buildAnalyticsQuery(context) {
  const interval = context.granularity === 'day'
    ? '1 day'
    : context.granularity === 'week' ? '1 week' : '1 month';
  const orderRevenueExpression = context.itemFiltered ? 'COALESCE(it.item_revenue, 0)' : 'COALESCE(ot.order_revenue, 0)';
  const scopedValueExpression = context.itemFiltered ? 'COALESCE(mbo.item_revenue, 0)' : 'o.total';
  const highValueExpression = context.itemFiltered ? 'COALESCE(mbo.item_revenue, 0)' : 'so.total';

  return `
    WITH ${baseCtes(context)},
    product_metrics AS (
      SELECT
        COALESCE(NULLIF(mi.product_id, ''), 'legacy:' || md5(COALESCE(mi.snapshot_name, 'Produto'))) AS product_id,
        COALESCE(NULLIF(MAX(mi.current_name), ''), NULLIF(MAX(mi.snapshot_name), ''), 'Produto removido') AS name,
        COALESCE(NULLIF(MAX(mi.category), ''), 'Sem categoria') AS category,
        COALESCE(SUM(mi.qty), 0)::integer AS units,
        COALESCE(SUM(mi.item_revenue), 0)::numeric AS revenue,
        COUNT(DISTINCT mi.order_id)::integer AS orders,
        MAX(mi.stock)::integer AS stock,
        BOOL_OR(COALESCE(mi.active, false)) AS active,
        MAX(mi.current_price)::numeric AS current_price
      FROM matched_items mi
      WHERE mi.status IN (${RECOGNIZED_STATUSES})
      GROUP BY COALESCE(NULLIF(mi.product_id, ''), 'legacy:' || md5(COALESCE(mi.snapshot_name, 'Produto')))
    ),
    category_metrics AS (
      SELECT
        COALESCE(NULLIF(mi.category, ''), 'Sem categoria') AS category,
        COALESCE(SUM(mi.qty), 0)::integer AS units,
        COALESCE(SUM(mi.item_revenue), 0)::numeric AS revenue,
        COUNT(DISTINCT mi.order_id)::integer AS orders
      FROM matched_items mi
      WHERE mi.status IN (${RECOGNIZED_STATUSES})
      GROUP BY COALESCE(NULLIF(mi.category, ''), 'Sem categoria')
    ),
    timeline_periods AS (
      SELECT generate_series(
        date_trunc('${context.granularity}', $1::date::timestamp),
        date_trunc('${context.granularity}', $2::date::timestamp),
        interval '${interval}'
      )::date AS period
    ),
    order_timeline AS (
      SELECT
        date_trunc('${context.granularity}', timezone('America/Sao_Paulo', o.created_at))::date AS period,
        COUNT(*)::integer AS orders,
        COUNT(DISTINCT o.user_id) FILTER (WHERE o.status IN (${RECOGNIZED_STATUSES}))::integer AS buyers,
        COALESCE(SUM(o.total) FILTER (WHERE o.status IN (${RECOGNIZED_STATUSES})), 0)::numeric AS order_revenue
      FROM scoped_orders o
      GROUP BY 1
    ),
    item_timeline AS (
      SELECT
        date_trunc('${context.granularity}', timezone('America/Sao_Paulo', mi.created_at))::date AS period,
        COALESCE(SUM(mi.qty) FILTER (WHERE mi.status IN (${RECOGNIZED_STATUSES})), 0)::integer AS units,
        COALESCE(SUM(mi.item_revenue) FILTER (WHERE mi.status IN (${RECOGNIZED_STATUSES})), 0)::numeric AS item_revenue
      FROM matched_items mi
      GROUP BY 1
    ),
    timeline AS (
      SELECT
        tp.period,
        COALESCE(ot.orders, 0)::integer AS orders,
        COALESCE(ot.buyers, 0)::integer AS buyers,
        COALESCE(it.units, 0)::integer AS units,
        ${orderRevenueExpression}::numeric AS revenue
      FROM timeline_periods tp
      LEFT JOIN order_timeline ot ON ot.period=tp.period
      LEFT JOIN item_timeline it ON it.period=tp.period
      ORDER BY tp.period
    ),
    status_metrics AS (
      SELECT status, COUNT(*)::integer AS orders, COALESCE(SUM(total), 0)::numeric AS value
      FROM scoped_orders GROUP BY status
    ),
    region_metrics AS (
      SELECT
        COALESCE(NULLIF(TRIM(o.shipping_city), ''), 'Não informado') AS city,
        COALESCE(NULLIF(TRIM(o.shipping_state), ''), '') AS state,
        COUNT(*)::integer AS orders,
        COUNT(DISTINCT o.user_id)::integer AS buyers,
        COALESCE(SUM(${scopedValueExpression}), 0)::numeric AS revenue
      FROM scoped_orders o
      LEFT JOIN matched_by_order mbo ON mbo.order_id=o.id
      WHERE o.status IN (${RECOGNIZED_STATUSES})
      GROUP BY 1, 2
    ),
    order_values AS (
      SELECT o.*, ${scopedValueExpression}::numeric AS report_value
      FROM scoped_orders o
      LEFT JOIN matched_by_order mbo ON mbo.order_id=o.id
    ),
    value_band_definitions AS (
      SELECT * FROM (VALUES
        (1, 'Até R$ 99', 0::numeric, 100::numeric),
        (2, 'R$ 100 a R$ 199', 100::numeric, 200::numeric),
        (3, 'R$ 200 a R$ 399', 200::numeric, 400::numeric),
        (4, 'R$ 400 ou mais', 400::numeric, NULL::numeric)
      ) AS bands(sort_order, label, minimum, maximum)
    ),
    value_bands AS (
      SELECT
        b.sort_order,
        b.label,
        COUNT(o.id)::integer AS orders,
        COALESCE(SUM(o.report_value), 0)::numeric AS revenue
      FROM value_band_definitions b
      LEFT JOIN order_values o
        ON o.status IN (${RECOGNIZED_STATUSES})
        AND o.report_value >= b.minimum
        AND (b.maximum IS NULL OR o.report_value < b.maximum)
      GROUP BY b.sort_order, b.label
    ),
    weekday_metrics AS (
      SELECT
        EXTRACT(ISODOW FROM timezone('America/Sao_Paulo', created_at))::integer AS weekday,
        COUNT(*)::integer AS orders,
        COALESCE(SUM(report_value) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0)::numeric AS revenue
      FROM order_values GROUP BY 1
    ),
    hour_metrics AS (
      SELECT
        EXTRACT(HOUR FROM timezone('America/Sao_Paulo', created_at))::integer AS hour,
        COUNT(*)::integer AS orders,
        COALESCE(SUM(report_value) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0)::numeric AS revenue
      FROM order_values GROUP BY 1
    ),
    segment_metrics AS (
      SELECT segment, COUNT(*)::integer AS customers, COALESCE(SUM(revenue), 0)::numeric AS revenue
      FROM customer_metrics GROUP BY segment
    ),
    inventory_metrics AS (
      SELECT
        p.id AS product_id,
        p.name,
        p.category,
        p.stock,
        p.price,
        COALESCE(pm.units, 0)::integer AS units,
        COALESCE(pm.revenue, 0)::numeric AS revenue,
        CASE
          WHEN p.stock <= 5 THEN 'Crítico'
          WHEN p.stock <= GREATEST(10, COALESCE(pm.units, 0) * 0.35) THEN 'Atenção'
          ELSE 'Saudável'
        END AS stock_status
      FROM products p
      LEFT JOIN product_metrics pm ON pm.product_id=p.id::text
      WHERE ${context.inventoryWhere}
    )
    SELECT jsonb_build_object(
      'summaryData', (
        SELECT jsonb_build_object(
          'orderSummary', jsonb_build_object(
            'totalOrders', COUNT(*)::integer,
            'paidOrders', COUNT(*) FILTER (WHERE status IN (${RECOGNIZED_STATUSES}))::integer,
            'pendingOrders', COUNT(*) FILTER (WHERE status IN (${PENDING_STATUSES}))::integer,
            'cancelledOrders', COUNT(*) FILTER (WHERE status='Cancelado')::integer,
            'orderRevenue', COALESCE(SUM(total) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0),
            'grossOrderValue', COALESCE(SUM(total) FILTER (WHERE status <> 'Cancelado'), 0),
            'shippingRevenue', COALESCE(SUM(shipping_total) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0),
            'buyers', COUNT(DISTINCT user_id) FILTER (WHERE status IN (${RECOGNIZED_STATUSES}))::integer
          ),
          'itemSummary', (SELECT jsonb_build_object(
            'units', COALESCE(SUM(qty) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0)::integer,
            'itemRevenue', COALESCE(SUM(item_revenue) FILTER (WHERE status IN (${RECOGNIZED_STATUSES})), 0),
            'distinctProducts', COUNT(DISTINCT product_id) FILTER (WHERE status IN (${RECOGNIZED_STATUSES}))::integer
          ) FROM matched_items),
          'customerSummary', (SELECT jsonb_build_object(
            'repeatBuyers', COUNT(*) FILTER (WHERE order_count >= 2)::integer,
            'newBuyers', COUNT(*) FILTER (
              WHERE first_purchase_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
                AND first_purchase_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo')
            )::integer
          ) FROM customer_metrics),
          'accountsCreated', (SELECT COUNT(*)::integer FROM users u WHERE ${context.accountWhere})
        ) FROM scoped_orders
      ),
      'timeline', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.period) FROM (
        SELECT period::text AS period, orders, buyers, units, revenue FROM timeline
      ) t), '[]'::jsonb),
      'products', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM (
        SELECT product_id AS "productId", name, category, units, revenue, orders, stock, active,
          current_price AS "currentPrice",
          CASE WHEN SUM(revenue) OVER () > 0 THEN ROUND(revenue * 100 / SUM(revenue) OVER (), 1) ELSE 0 END AS share
        FROM product_metrics ORDER BY revenue DESC, units DESC, name LIMIT 15
      ) p), '[]'::jsonb),
      'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (
        SELECT category, units, revenue, orders,
          CASE WHEN SUM(revenue) OVER () > 0 THEN ROUND(revenue * 100 / SUM(revenue) OVER (), 1) ELSE 0 END AS share
        FROM category_metrics ORDER BY revenue DESC, units DESC, category LIMIT 12
      ) c), '[]'::jsonb),
      'customers', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (
        SELECT user_id AS "customerId", name, city, state, order_count AS orders, revenue, units,
          CASE WHEN order_count > 0 THEN ROUND(revenue / order_count, 2) ELSE 0 END AS "averageTicket",
          last_order_at AS "lastOrderAt", recency_days AS "recencyDays", segment
        FROM customer_metrics ORDER BY revenue DESC, order_count DESC, name LIMIT 15
      ) c), '[]'::jsonb),
      'segments', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT segment, customers, revenue FROM segment_metrics
        ORDER BY CASE segment WHEN 'VIP' THEN 1 WHEN 'Recorrente' THEN 2 WHEN 'Novo' THEN 3 WHEN 'Ocasional' THEN 4 ELSE 5 END
      ) s), '[]'::jsonb),
      'regions', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (
        SELECT city, state, orders, buyers, revenue FROM region_metrics
        ORDER BY revenue DESC, orders DESC, city LIMIT 12
      ) r), '[]'::jsonb),
      'statuses', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT status, orders, value FROM status_metrics
        ORDER BY CASE status
          WHEN 'Aguardando Pagamento' THEN 1 WHEN 'Aguardando Confirmação' THEN 2 WHEN 'Pago' THEN 3
          WHEN 'Em Produção' THEN 4 WHEN 'Enviado' THEN 5 WHEN 'Finalizado' THEN 6 ELSE 7 END
      ) s), '[]'::jsonb),
      'valueBands', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM (
        SELECT label, orders, revenue FROM value_bands ORDER BY sort_order
      ) v), '[]'::jsonb),
      'weekdays', COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM (
        SELECT d.weekday,
          (ARRAY['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'])[d.weekday] AS label,
          COALESCE(wm.orders, 0)::integer AS orders,
          COALESCE(wm.revenue, 0)::numeric AS revenue
        FROM generate_series(1, 7) AS d(weekday)
        LEFT JOIN weekday_metrics wm ON wm.weekday=d.weekday ORDER BY d.weekday
      ) w), '[]'::jsonb),
      'hours', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM (
        SELECT d.hour, COALESCE(hm.orders, 0)::integer AS orders, COALESCE(hm.revenue, 0)::numeric AS revenue
        FROM generate_series(0, 23) AS d(hour)
        LEFT JOIN hour_metrics hm ON hm.hour=d.hour ORDER BY d.hour
      ) h), '[]'::jsonb),
      'inventory', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM (
        SELECT product_id AS "productId", name, category, stock, price, units, revenue, stock_status AS "stockStatus"
        FROM inventory_metrics
        ORDER BY CASE stock_status WHEN 'Crítico' THEN 1 WHEN 'Atenção' THEN 2 ELSE 3 END, units DESC, stock ASC, name
        LIMIT 15
      ) i), '[]'::jsonb),
      'highValueOrders', COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM (
        SELECT so.id, so.number, so.customer_name AS "customerName", ${highValueExpression} AS total,
          so.status, so.created_at AS "createdAt"
        FROM scoped_orders so
        LEFT JOIN matched_by_order mbo ON mbo.order_id=so.id
        WHERE so.status IN (${RECOGNIZED_STATUSES})
        ORDER BY ${highValueExpression} DESC, so.created_at DESC LIMIT 8
      ) o), '[]'::jsonb)
    ) AS report`;
}

function normalizeSummary(summaryData, itemFiltered) {
  const orders = summaryData.orderSummary || {};
  const items = summaryData.itemSummary || {};
  const customers = summaryData.customerSummary || {};
  const revenue = itemFiltered ? number(items.itemRevenue) : number(orders.orderRevenue ?? orders.revenue);
  const paidOrders = number(orders.paidOrders);
  const buyers = number(orders.buyers);
  const repeatBuyers = number(customers.repeatBuyers);
  const totalOrders = number(orders.totalOrders);
  const cancelledOrders = number(orders.cancelledOrders);

  return {
    revenue,
    productRevenue: number(items.itemRevenue),
    grossOrderValue: number(orders.grossOrderValue),
    shippingRevenue: number(orders.shippingRevenue),
    totalOrders,
    paidOrders,
    pendingOrders: number(orders.pendingOrders),
    cancelledOrders,
    cancellationRate: totalOrders ? Math.round(cancelledOrders * 1000 / totalOrders) / 10 : 0,
    averageTicket: paidOrders ? Math.round(revenue * 100 / paidOrders) / 100 : 0,
    unitsSold: number(items.units),
    distinctProducts: number(items.distinctProducts),
    buyers,
    accountsCreated: number(summaryData.accountsCreated),
    newBuyers: number(customers.newBuyers),
    repeatBuyers,
    repeatRate: buyers ? Math.round(repeatBuyers * 1000 / buyers) / 10 : 0,
    averageCustomerValue: buyers ? Math.round(revenue * 100 / buyers) / 100 : 0,
    averageItemsPerPaidOrder: paidOrders ? Math.round(number(items.units) * 100 / paidOrders) / 100 : 0
  };
}

router.get('/filters', requireAdmin, async (req, res, next) => {
  try {
    const [customers, products, categories, range] = await Promise.all([
      pool.query("SELECT id, name FROM users WHERE role='client' ORDER BY lower(name), created_at DESC LIMIT 500"),
      pool.query('SELECT id, name, category, active FROM products ORDER BY active DESC, lower(name) LIMIT 500'),
      pool.query("SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category LIMIT 200"),
      pool.query("SELECT to_char(MIN(timezone('America/Sao_Paulo', created_at)), 'YYYY-MM-DD') AS first_date FROM orders")
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      customers: customers.rows.map((row) => ({ id: row.id, name: row.name })),
      products: products.rows.map((row) => ({ id: row.id, name: row.name, category: row.category, active: row.active })),
      categories: categories.rows.map((row) => row.category),
      firstOrderDate: range.rows[0] && range.rows[0].first_date ? String(range.rows[0].first_date).slice(0, 10) : null
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    await expirePendingOrders();
    const filters = parseReportFilters(req.query);
    const currentContext = buildContext(filters, filters.startDate, filters.endDate);
    const previousContext = buildContext(filters, filters.previousStartDate, filters.previousEndDate);

    const [currentResult, previousResult] = await Promise.all([
      pool.query(buildAnalyticsQuery(currentContext), currentContext.params),
      pool.query(buildSummaryQuery(previousContext), previousContext.params)
    ]);

    const report = currentResult.rows[0] ? currentResult.rows[0].report : {};
    const previousReport = previousResult.rows[0] ? previousResult.rows[0].report : {};
    const summary = normalizeSummary(report.summaryData || {}, currentContext.itemFiltered);
    const previous = normalizeSummary(previousReport || {}, previousContext.itemFiltered);

    summary.changes = {
      revenue: percentChange(summary.revenue, previous.revenue),
      totalOrders: percentChange(summary.totalOrders, previous.totalOrders),
      paidOrders: percentChange(summary.paidOrders, previous.paidOrders),
      averageTicket: percentChange(summary.averageTicket, previous.averageTicket),
      unitsSold: percentChange(summary.unitsSold, previous.unitsSold),
      buyers: percentChange(summary.buyers, previous.buyers)
    };

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      meta: {
        generatedAt: new Date().toISOString(),
        startDate: filters.startDate,
        endDate: filters.endDate,
        previousStartDate: filters.previousStartDate,
        previousEndDate: filters.previousEndDate,
        days: filters.days,
        granularity: filters.granularity,
        timezone: filters.timezone,
        revenueBasis: currentContext.itemFiltered ? 'filtered-items' : 'paid-orders',
        recognizedStatuses: ['Pago', 'Em Produção', 'Enviado', 'Finalizado'],
        appliedFilters: {
          customerId: filters.customerId,
          productId: filters.productId,
          category: filters.category,
          status: filters.status
        }
      },
      summary,
      previous,
      timeline: report.timeline || [],
      products: report.products || [],
      categories: report.categories || [],
      customers: report.customers || [],
      segments: report.segments || [],
      regions: report.regions || [],
      statuses: report.statuses || [],
      valueBands: report.valueBands || [],
      weekdays: report.weekdays || [],
      hours: report.hours || [],
      inventory: report.inventory || [],
      highValueOrders: report.highValueOrders || []
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
