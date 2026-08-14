/* ============================================================================
   siteContent.js
   ----------------------------------------------------------------------------
   Lê o conteúdo personalizável do site (DataService.SiteContent) e aplica em
   todos os elementos editáveis da loja: banner principal, carrossel de
   promoções, oferta relâmpago, quem somos, destaque de produto, FAQ e
   rodapé. É chamado sempre que a loja é exibida, então qualquer alteração
   feita pelo admin na aba "Personalizar" aparece assim que a página
   recarrega ou o visitante navega até a loja.
   ============================================================================ */

(function (global) {
  'use strict';

  let carouselHandle = null;
  let renderPromise = null;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // Converte quebras de linha em <br>, escapando o resto do texto.
  function setTextWithBreaks(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = Utils.escapeHtml(value || '').replace(/\n/g, '<br>');
  }

  function setImage(id, src, alt) {
    const el = document.getElementById(id);
    if (!el) return;
    const safeSource = Utils.safeImageSrc(src);
    if (safeSource) el.src = safeSource;
    if (alt) el.alt = alt;
  }

  // --------------------------------------------------------------------------
  // Tema e cores
  // --------------------------------------------------------------------------
  const THEME_VAR_MAP = {
    bg: '--color-bg',
    surface: '--color-surface',
    primary: '--color-primary',
    primaryDark: '--color-primary-dark',
    accent: '--color-accent',
    accentDark: '--color-accent-dark',
    text: '--color-text',
    textMuted: '--color-text-muted',
    dark: '--color-dark'
  };

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement.style;
    Object.keys(THEME_VAR_MAP).forEach((key) => {
      if (theme[key]) root.setProperty(THEME_VAR_MAP[key], theme[key]);
    });
  }

  // --------------------------------------------------------------------------
  // Banner principal
  // --------------------------------------------------------------------------
  function applyHero(hero) {
    setText('hero-eyebrow', hero.eyebrow);
    setTextWithBreaks('hero-title', hero.title);
    setText('hero-subtitle', hero.subtitle);
    setText('hero-cta-text', hero.ctaText);
  }

  // --------------------------------------------------------------------------
  // Carrossel de promoções
  // --------------------------------------------------------------------------
  function applyCarousel(slides) {
    const root = document.getElementById('promo-carousel');
    if (!root) return;

    if (carouselHandle) {
      clearInterval(carouselHandle);
      carouselHandle = null;
    }

    const list = Array.isArray(slides) ? slides.filter((slide) => slide && Utils.safeImageSrc(slide.image)) : [];
    if (!list.length) {
      root.innerHTML = '';
      return;
    }

    root.innerHTML =
      list
        .map(
          (slide, i) => `
        <div class="promo-carousel__slide${i === 0 ? ' is-active' : ''}">
          <img src="${Utils.escapeHtml(Utils.safeImageSrc(slide.image))}" alt="${Utils.escapeHtml(slide.alt || '')}" loading="lazy">
        </div>`
        )
        .join('') +
      (list.length > 1
        ? `<div class="promo-carousel__dots">
            ${list.map((_, i) => `<button class="${i === 0 ? 'is-active' : ''}" data-slide="${i}" aria-label="Slide ${i + 1}"></button>`).join('')}
          </div>`
        : '');

    if (list.length <= 1) return;

    const slideEls = Array.from(root.querySelectorAll('.promo-carousel__slide'));
    const dotEls = Array.from(root.querySelectorAll('.promo-carousel__dots button'));
    let index = 0;

    function show(i) {
      index = (i + slideEls.length) % slideEls.length;
      slideEls.forEach((s, n) => s.classList.toggle('is-active', n === index));
      dotEls.forEach((d, n) => d.classList.toggle('is-active', n === index));
    }

    function startAutoplay() {
      if (carouselHandle) clearInterval(carouselHandle);
      carouselHandle = setInterval(() => show(index + 1), 4500);
    }

    dotEls.forEach((dot) => {
      dot.addEventListener('click', () => {
        show(parseInt(dot.dataset.slide, 10));
        startAutoplay();
      });
    });

    startAutoplay();
  }

  // --------------------------------------------------------------------------
  // Oferta relâmpago
  // --------------------------------------------------------------------------
  function applyFlashSale(flashSale) {
    setText('flash-sale-tag', flashSale.tag);
    setText('flash-sale-title', flashSale.title);
    setText('flash-sale-description', flashSale.description);
  }

  // --------------------------------------------------------------------------
  // Quem somos
  // --------------------------------------------------------------------------
  function applyAbout(about) {
    setImage('about-image', about.image, 'Quem somos — Brincar de Desejo');
    setText('about-eyebrow', about.eyebrow);
    setText('about-title', about.title);
    setText('about-paragraph-1', about.paragraph1);
    setText('about-paragraph-2', about.paragraph2);

    const bulletsEl = document.getElementById('about-bullets');
    if (bulletsEl) {
      const bullets = Array.isArray(about.bullets) ? about.bullets : [];
      bulletsEl.innerHTML = bullets
        .map((b) => `<li><i class="fa-solid fa-check"></i> ${Utils.escapeHtml(b)}</li>`)
        .join('');
    }
  }

  // --------------------------------------------------------------------------
  // Destaque de produto
  // --------------------------------------------------------------------------
  function applySpotlight(spotlight) {
    setImage('spotlight-image', spotlight.image, spotlight.title);
    setText('spotlight-eyebrow', spotlight.eyebrow);
    setText('spotlight-title', spotlight.title);
    setText('spotlight-text', spotlight.text);
    setText('spotlight-button-text', spotlight.buttonText);
  }

  // --------------------------------------------------------------------------
  // Perguntas frequentes
  // --------------------------------------------------------------------------
  function applyFaq(faq) {
    const root = document.getElementById('faq');
    if (!root) return;

    const list = Array.isArray(faq) ? faq : [];
    root.innerHTML = list
      .map(
        (item) => `
      <div class="faq__item">
        <button class="faq__question" type="button" aria-expanded="false">
          <span>${Utils.escapeHtml(item.q)}</span>
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <div class="faq__answer">
          <p>${Utils.escapeHtml(item.a)}</p>
        </div>
      </div>`
      )
      .join('');

    root.querySelectorAll('.faq__item').forEach((item) => {
      const question = item.querySelector('.faq__question');
      question.addEventListener('click', () => {
        const isOpen = item.classList.contains('is-open');
        root.querySelectorAll('.faq__item').forEach((other) => other.classList.remove('is-open'));
        if (!isOpen) item.classList.add('is-open');
        root.querySelectorAll('.faq__question').forEach((button) => button.setAttribute('aria-expanded', 'false'));
        question.setAttribute('aria-expanded', String(!isOpen));
      });
    });
  }

  // --------------------------------------------------------------------------
  // Rodapé
  // --------------------------------------------------------------------------
  function applyFooter(footer) {
    setText('footer-about', footer.about);
    setText('footer-phone', footer.phone);
    setText('footer-email', footer.email);
    setText('footer-hours-1', footer.hours1);
    setText('footer-hours-2', footer.hours2);
  }

  // --------------------------------------------------------------------------
  // Aplicação geral
  // --------------------------------------------------------------------------
  function applyContent(content) {
    applyTheme(content.theme);
    applyHero(content.hero);
    applyCarousel(content.carousel);
    applyFlashSale(content.flashSale);
    applyAbout(content.about);
    applySpotlight(content.spotlight);
    applyFaq(content.faq);
    applyFooter(content.footer);
  }

  function render(force) {
    if (renderPromise && !force) return renderPromise;
    renderPromise = DataService.SiteContent.get(Boolean(force))
      .then(applyContent)
      .catch((err) => {
        renderPromise = null;
        console.warn('[site-content] Conteúdo remoto indisponível:', err.message);
      });
    return renderPromise;
  }

  global.SiteContentModule = { render };
})(window);
