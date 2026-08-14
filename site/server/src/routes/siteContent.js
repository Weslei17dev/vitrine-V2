/* ============================================================================
   routes/siteContent.js
   ----------------------------------------------------------------------------
   GET   /api/site-content        — público
   PUT   /api/site-content        — atualiza (admin), faz merge com o que já existe
   POST  /api/site-content/reset  — restaura os padrões (admin)
   ============================================================================ */

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM site_content WHERE id = 1');
    res.json(result.rows[0] ? result.rows[0].content : {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar conteúdo do site.' });
  }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const current = await pool.query('SELECT content FROM site_content WHERE id = 1');
    const merged = Object.assign({}, current.rows[0] ? current.rows[0].content : {}, req.body || {});

    await pool.query(
      `INSERT INTO site_content (id, content, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = $1, updated_at = now()`,
      [merged]
    );
    res.json(merged);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao salvar conteúdo do site.' });
  }
});

router.post('/reset', requireAdmin, async (req, res) => {
  const { defaults } = req.body || {};
  if (!defaults) return res.status(400).json({ message: 'Conteúdo padrão não informado.' });

  try {
    await pool.query(
      `INSERT INTO site_content (id, content, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = $1, updated_at = now()`,
      [defaults]
    );
    res.json(defaults);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao restaurar conteúdo do site.' });
  }
});

module.exports = router;
