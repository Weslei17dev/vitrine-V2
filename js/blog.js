/* Conteúdo educativo do blog e renderização das páginas da SPA. */
(function (global) {
  'use strict';

  const POSTS = [
    {
      slug: 'primeira-escolha-com-seguranca',
      title: 'Como fazer sua primeira escolha com mais segurança',
      category: 'Guia para iniciantes',
      date: '20 de agosto de 2026',
      image: 'img/promo-acessorios.jpg',
      alt: 'Acessórios apresentados de forma discreta',
      excerpt: 'Material, tamanho, finalidade e cuidados: um roteiro simples para comparar opções sem pressa.',
      sections: [
        {
          title: 'Comece pela finalidade',
          paragraphs: [
            'Antes de comparar modelos, pense no tipo de experiência que você procura e no seu nível de familiaridade. Uma escolha adequada não precisa ser a mais potente ou a mais completa; precisa ser confortável para você.',
            'Leia a descrição inteira, confira dimensões e evite produtos sem informações claras sobre material, uso e higienização.'
          ]
        },
        {
          title: 'Priorize materiais e procedência',
          paragraphs: [
            'Prefira materiais não porosos e próprios para contato com o corpo, seguindo sempre as instruções do fabricante. Embalagem íntegra, identificação do fornecedor e orientações em português ajudam a avaliar a procedência.'
          ]
        },
        {
          title: 'Respeite seus limites',
          paragraphs: [
            'Conforto e consentimento vêm primeiro. Interrompa o uso diante de dor, irritação ou desconforto persistente e procure orientação de um profissional de saúde quando necessário.'
          ]
        }
      ]
    },
    {
      slug: 'higienizacao-e-armazenamento',
      title: 'Higienização e armazenamento: cuidados que fazem diferença',
      category: 'Cuidado e conservação',
      date: '20 de agosto de 2026',
      image: 'img/promo-dessensibilizante.jpg',
      alt: 'Imagem abstrata sobre cuidado e conforto',
      excerpt: 'Boas práticas para conservar seus produtos, reduzir riscos e seguir corretamente o manual do fabricante.',
      sections: [
        {
          title: 'Consulte o manual primeiro',
          paragraphs: [
            'A forma de limpeza depende do material, da resistência à água e dos componentes eletrônicos. Por isso, o manual do fabricante sempre prevalece sobre orientações genéricas.',
            'Produtos apenas resistentes a respingos não devem ser submersos. Quando houver bateria ou entrada de carregamento, mantenha a área indicada seca.'
          ]
        },
        {
          title: 'Limpeza e secagem',
          paragraphs: [
            'Use o produto de limpeza recomendado, enxágue somente quando permitido e seque completamente antes de guardar. Evite substâncias abrasivas, perfumes e soluções não indicadas para o material.'
          ]
        },
        {
          title: 'Guarde separadamente',
          paragraphs: [
            'Mantenha cada item limpo, seco e protegido de calor e luz direta. O armazenamento separado reduz contato entre materiais diferentes e ajuda a preservar a superfície.'
          ]
        }
      ]
    },
    {
      slug: 'consentimento-e-comunicacao',
      title: 'Consentimento e comunicação: o ponto de partida',
      category: 'Bem-estar e relações',
      date: '20 de agosto de 2026',
      image: 'img/promo-bdsm.jpg',
      alt: 'Imagem conceitual sobre confiança e comunicação',
      excerpt: 'Conversas claras, limites respeitados e liberdade para mudar de ideia tornam qualquer experiência mais segura.',
      sections: [
        {
          title: 'Consentimento precisa ser claro',
          paragraphs: [
            'Consentimento é uma concordância livre, informada e específica. Silêncio, pressão ou medo de decepcionar não significam consentimento.',
            'Qualquer pessoa pode mudar de ideia a qualquer momento. Quando isso acontece, a atividade deve parar sem discussão ou cobrança.'
          ]
        },
        {
          title: 'Converse antes',
          paragraphs: [
            'Alinhe expectativas, limites e sinais de pausa antes da experiência. Perguntas simples e diretas evitam suposições e criam espaço para respostas honestas.'
          ]
        },
        {
          title: 'Faça uma checagem depois',
          paragraphs: [
            'Depois, conversem sobre como cada pessoa se sentiu. Essa checagem ajuda a ajustar limites futuros e reforça uma cultura de respeito e cuidado.'
          ]
        }
      ]
    }
  ];

  function cardHtml(post) {
    return `
      <article class="blog-card" data-blog-slug="${Utils.escapeHtml(post.slug)}" tabindex="0" role="link" aria-label="Ler: ${Utils.escapeHtml(post.title)}">
        <div class="blog-card__image"><img src="${Utils.escapeHtml(post.image)}" alt="${Utils.escapeHtml(post.alt)}" loading="lazy"></div>
        <div class="blog-card__body">
          <span class="blog-card__meta">${Utils.escapeHtml(post.category)}</span>
          <h3>${Utils.escapeHtml(post.title)}</h3>
          <p>${Utils.escapeHtml(post.excerpt)}</p>
          <span class="blog-card__link">Ler artigo <i class="fa-solid fa-arrow-right"></i></span>
        </div>
      </article>`;
  }

  function renderCards(root, posts) {
    if (!root) return;
    root.innerHTML = posts.map(cardHtml).join('');
  }

  function renderLists() {
    renderCards(document.getElementById('blog-preview-grid'), POSTS.slice(0, 3));
    renderCards(document.getElementById('blog-grid'), POSTS);
  }

  function articleHtml(post) {
    const sections = post.sections.map((section) => `
      <section>
        <h2>${Utils.escapeHtml(section.title)}</h2>
        ${section.paragraphs.map((paragraph) => `<p>${Utils.escapeHtml(paragraph)}</p>`).join('')}
      </section>`).join('');

    return `
      <span class="section-eyebrow">${Utils.escapeHtml(post.category)}</span>
      <h1>${Utils.escapeHtml(post.title)}</h1>
      <p class="text-muted">Publicado em ${Utils.escapeHtml(post.date)} · Conteúdo educativo para maiores de 18 anos</p>
      <img class="blog-article__cover" src="${Utils.escapeHtml(post.image)}" alt="${Utils.escapeHtml(post.alt)}">
      <p>${Utils.escapeHtml(post.excerpt)}</p>
      ${sections}
      <p class="blog-article__disclaimer"><strong>Importante:</strong> este conteúdo é informativo e não substitui orientação médica. Em caso de dor, reação ou dúvida sobre sua saúde, procure um profissional qualificado.</p>`;
  }

  function show(slug) {
    const post = POSTS.find((item) => item.slug === slug);
    if (!post) return;
    const root = document.getElementById('blog-article-content');
    if (root) root.innerHTML = articleHtml(post);
    global.App.navigate('blog-article');
    document.title = `${post.title} — Brincar de Desejo`;
  }

  function handleCardActivation(event) {
    const card = event.target.closest('[data-blog-slug]');
    if (!card) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    show(card.dataset.blogSlug);
  }

  function init() {
    renderLists();
    ['blog-preview-grid', 'blog-grid'].forEach((id) => {
      const root = document.getElementById(id);
      if (!root) return;
      root.addEventListener('click', handleCardActivation);
      root.addEventListener('keydown', handleCardActivation);
    });
  }

  global.BlogModule = { init, render: renderLists, show, posts: POSTS.slice() };
})(window);
