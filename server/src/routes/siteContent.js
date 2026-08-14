'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const { SITE_CONTENT_DEFAULTS, deepMerge } = require('../site-defaults');
const V = require('../validation');

const router = express.Router();

async function readContent() {
  const result = await pool.query('SELECT content FROM site_content WHERE id = 1');
  return deepMerge(SITE_CONTENT_DEFAULTS, result.rows[0] ? result.rows[0].content : {});
}

function shortText(value, label, max = 300) {
  return V.text(value, label, { required: false, max });
}

function normalizeImageList(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 6) throw new V.ValidationError('O carrossel aceita no máximo 6 imagens.');
  return list.map((slide, index) => ({
    image: V.imageSource(slide && slide.image, `Imagem ${index + 1} do carrossel`),
    alt: shortText(slide && slide.alt, 'Texto alternativo', 180)
  })).filter((slide) => slide.image);
}

function normalizeContent(content) {
  const requiredSections = ['theme', 'pix', 'hero', 'flashSale', 'about', 'spotlight', 'footer'];
  for (const section of requiredSections) {
    if (!content[section] || typeof content[section] !== 'object' || Array.isArray(content[section])) {
      throw new V.ValidationError(`Seção de personalização inválida: ${section}.`);
    }
  }
  const faq = Array.isArray(content.faq) ? content.faq : [];
  const bullets = Array.isArray(content.about.bullets) ? content.about.bullets : [];
  if (faq.length > 12) throw new V.ValidationError('A FAQ aceita no máximo 12 perguntas.');
  if (bullets.length > 8) throw new V.ValidationError('A lista de destaques aceita no máximo 8 itens.');

  return {
    theme: {
      bg: V.color(content.theme.bg), surface: V.color(content.theme.surface),
      primary: V.color(content.theme.primary), primaryDark: V.color(content.theme.primaryDark),
      accent: V.color(content.theme.accent), accentDark: V.color(content.theme.accentDark),
      text: V.color(content.theme.text), textMuted: V.color(content.theme.textMuted), dark: V.color(content.theme.dark)
    },
    pix: {
      chave: shortText(content.pix.chave, 'Chave PIX', 77),
      nomeBeneficiario: shortText(content.pix.nomeBeneficiario, 'Nome do beneficiário', 25),
      cidadeBeneficiario: shortText(content.pix.cidadeBeneficiario, 'Cidade do beneficiário', 15)
    },
    hero: {
      eyebrow: shortText(content.hero.eyebrow, 'Selo do banner', 100),
      title: shortText(content.hero.title, 'Título do banner', 180),
      subtitle: shortText(content.hero.subtitle, 'Subtítulo do banner', 500),
      ctaText: shortText(content.hero.ctaText, 'Texto do botão', 60)
    },
    carousel: normalizeImageList(content.carousel),
    flashSale: {
      tag: shortText(content.flashSale.tag, 'Selo da seleção', 60),
      title: shortText(content.flashSale.title, 'Título da seleção', 140),
      description: shortText(content.flashSale.description, 'Descrição da seleção', 400)
    },
    about: {
      image: V.imageSource(content.about.image, 'Imagem institucional'),
      eyebrow: shortText(content.about.eyebrow, 'Selo institucional', 80),
      title: shortText(content.about.title, 'Título institucional', 180),
      paragraph1: shortText(content.about.paragraph1, 'Parágrafo institucional', 1200),
      paragraph2: shortText(content.about.paragraph2, 'Parágrafo institucional', 1200),
      bullets: bullets.map((item) => shortText(item, 'Destaque institucional', 160)).filter(Boolean)
    },
    spotlight: {
      image: V.imageSource(content.spotlight.image, 'Imagem de destaque'),
      eyebrow: shortText(content.spotlight.eyebrow, 'Selo do destaque', 80),
      title: shortText(content.spotlight.title, 'Título do destaque', 180),
      text: shortText(content.spotlight.text, 'Texto do destaque', 700),
      buttonText: shortText(content.spotlight.buttonText, 'Texto do botão', 60)
    },
    faq: faq.map((item) => ({
      q: shortText(item && item.q, 'Pergunta', 250),
      a: shortText(item && item.a, 'Resposta', 1200)
    })).filter((item) => item.q && item.a),
    footer: {
      about: shortText(content.footer.about, 'Texto do rodapé', 500),
      phone: shortText(content.footer.phone, 'Telefone do rodapé', 40),
      email: shortText(content.footer.email, 'E-mail do rodapé', 254),
      hours1: shortText(content.footer.hours1, 'Horário de atendimento', 120),
      hours2: shortText(content.footer.hours2, 'Horário de atendimento', 120)
    }
  };
}

router.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    res.json(await readContent());
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const content = await readContent();
    const { pix, ...publicContent } = content;
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(publicContent);
  } catch (err) {
    next(err);
  }
});

router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const current = await readContent();
    const normalized = normalizeContent(deepMerge(current, req.body || {}));
    await pool.query(
      `INSERT INTO site_content (id, content, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [normalized]
    );
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});

router.post('/reset', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(
      `INSERT INTO site_content (id, content, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [SITE_CONTENT_DEFAULTS]
    );
    res.json(SITE_CONTENT_DEFAULTS);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
