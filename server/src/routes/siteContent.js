'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const { SITE_CONTENT_DEFAULTS, deepMerge } = require('../site-defaults');
const V = require('../validation');
const { recordAudit } = require('../utils/audit');

const router = express.Router();

async function readContent() {
  const result = await pool.query('SELECT content FROM site_content WHERE id = 1');
  const content = deepMerge(SITE_CONTENT_DEFAULTS, result.rows[0] ? result.rows[0].content : {});
  const defaults = SITE_CONTENT_DEFAULTS.carousel;
  content.carousel = (Array.isArray(content.carousel) ? content.carousel : []).map((slide, index) => ({
    ...(defaults[index % defaults.length] || defaults[0]),
    ...(slide || {})
  }));
  return content;
}

function shortText(value, label, max = 300) {
  return V.text(value, label, { required: false, max });
}

function normalizeImageList(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 4) throw new V.ValidationError('O banner aceita no máximo 4 slides.');
  return list.map((slide, index) => ({
    image: V.imageSource(slide && slide.image, `Imagem ${index + 1} do carrossel`),
    alt: shortText(slide && slide.alt, 'Texto alternativo', 180),
    eyebrow: shortText(slide && slide.eyebrow, 'Selo do slide', 100),
    title: shortText(slide && slide.title, 'Título do slide', 180),
    subtitle: shortText(slide && slide.subtitle, 'Frase do slide', 500),
    ctaText: shortText(slide && slide.ctaText, 'Botão do slide', 60) || 'Ver catálogo',
    ctaTarget: ['catalog', 'categories', 'selection'].includes(slide && slide.ctaTarget) ? slide.ctaTarget : 'catalog'
  })).filter((slide) => slide.image);
}

function normalizeContent(content) {
  const requiredSections = ['theme', 'pix', 'shipping', 'hero', 'flashSale', 'about', 'spotlight', 'footer'];
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
    shipping: {
      flatRate: V.nonNegativeMoney(content.shipping.flatRate || 0, 'Valor do frete'),
      freeAbove: V.nonNegativeMoney(content.shipping.freeAbove || 0, 'Limite para frete grátis'),
      estimatedDays: V.positiveInteger(content.shipping.estimatedDays || 7, 'Prazo do frete', 60)
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
      legalName: shortText(content.footer.legalName, 'Razão social', 180),
      document: shortText(content.footer.document, 'Documento comercial', 40),
      address: shortText(content.footer.address, 'Endereço comercial', 300),
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
    const { pix, about, ...publicContent } = content;
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
    if (JSON.stringify(normalized).length > 2500000) {
      throw new V.ValidationError('A personalização ficou muito grande. Reduza a quantidade ou o tamanho das imagens.');
    }
    await pool.query(
      `INSERT INTO site_content (id, content, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [normalized]
    );
    await recordAudit(pool, {
      adminId: req.user.id, action: 'site_content.update', entityType: 'site_content', entityId: '1',
      details: { sections: Object.keys(req.body || {}) }
    });
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});

router.post('/reset', requireAdmin, async (req, res, next) => {
  try {
    const current = await readContent();
    const resetContent = deepMerge(SITE_CONTENT_DEFAULTS, {
      pix: current.pix,
      footer: {
        legalName: current.footer.legalName,
        document: current.footer.document,
        address: current.footer.address
      }
    });
    await pool.query(
      `INSERT INTO site_content (id, content, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [resetContent]
    );
    await recordAudit(pool, {
      adminId: req.user.id, action: 'site_content.reset', entityType: 'site_content', entityId: '1',
      details: { preserved: ['pix', 'footer.legalName', 'footer.document', 'footer.address'] }
    });
    res.json(resetContent);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
