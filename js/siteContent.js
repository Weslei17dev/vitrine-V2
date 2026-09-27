/* ============================================================================
   siteContent.js
   ----------------------------------------------------------------------------
   Lê o conteúdo personalizável do site (DataService.SiteContent) e aplica em
   todos os elementos editáveis da loja: banner integrado, seleção especial,
   destaque de produto, FAQ e rodapé. É chamado sempre que a loja é exibida,
   então qualquer alteração feita pelo admin na aba "Personalizar" aparece
   assim que a página
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
    root.setProperty('--color-on-primary', readableTextColor(theme.primary));
    root.setProperty('--color-on-accent', readableTextColor(theme.accent));
  }

  function readableTextColor(hex) {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return '#FDFCFA';
    const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    const contrastLight = 1.05 / (luminance + 0.05);
    const contrastDark = (luminance + 0.05) / 0.0603;
    return contrastLight >= contrastDark ? '#FDFCFA' : '#1A1A1A';
  }

  // --------------------------------------------------------------------------
  // Carrossel de promoções
  // --------------------------------------------------------------------------
  function applyCarousel(slides, hero) {
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

    const fallback = hero || {};
    const targetMap = {
      catalog: '#product-grid-anchor',
      categories: '#category-navigation-section',
      selection: '#selection-special'
    };
    root.innerHTML =
      list
        .map(
          (slide, i) => `
        <div class="promo-carousel__slide${i === 0 ? ' is-active' : ''}" aria-hidden="${i === 0 ? 'false' : 'true'}"${i === 0 ? '' : ' inert'}>
          <img src="${Utils.escapeHtml(Utils.safeImageSrc(slide.image))}" alt="${Utils.escapeHtml(slide.alt || '')}" loading="${i === 0 ? 'eager' : 'lazy'}"${i === 0 ? ' fetchpriority="high"' : ''}>
          <div class="promo-carousel__content">
            <span class="promo-carousel__eyebrow">${Utils.escapeHtml(slide.eyebrow || fallback.eyebrow || '')}</span>
            <h1>${Utils.escapeHtml(slide.title || fallback.title || '').replace(/\n/g, '<br>')}</h1>
            <p>${Utils.escapeHtml(slide.subtitle || fallback.subtitle || '')}</p>
            <a href="${targetMap[slide.ctaTarget] || targetMap.catalog}" class="btn btn--accent btn--lg" tabindex="${i === 0 ? '0' : '-1'}"><i class="fa-solid fa-arrow-right"></i> ${Utils.escapeHtml(slide.ctaText || fallback.ctaText || 'Ver catálogo')}</a>
          </div>
        </div>`
        )
        .join('') +
      (list.length > 1
        ? `<button type="button" class="promo-carousel__arrow promo-carousel__arrow--prev" data-carousel-direction="prev" aria-label="Banner anterior">&#10094;</button>
           <button type="button" class="promo-carousel__arrow promo-carousel__arrow--next" data-carousel-direction="next" aria-label="Próximo banner">&#10095;</button>
           <div class="promo-carousel__dots">
            ${list.map((_, i) => `<button type="button" class="${i === 0 ? 'is-active' : ''}" data-slide="${i}" aria-label="Mostrar banner ${i + 1}" aria-current="${i === 0 ? 'true' : 'false'}"></button>`).join('')}
           </div>
           <button type="button" class="promo-carousel__toggle" data-carousel-toggle aria-label="Pausar rotação dos banners"><i class="fa-solid fa-pause"></i></button>`
        : '');

    if (list.length <= 1) return;

    const slideEls = Array.from(root.querySelectorAll('.promo-carousel__slide'));
    const dotEls = Array.from(root.querySelectorAll('.promo-carousel__dots button'));
    const autoplayToggle = root.querySelector('[data-carousel-toggle]');
    const prefersReducedMotion = Boolean(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let autoplayPaused = prefersReducedMotion;
    let index = 0;

    function show(i) {
      index = (i + slideEls.length) % slideEls.length;
      slideEls.forEach((s, n) => {
        s.classList.toggle('is-active', n === index);
        s.setAttribute('aria-hidden', String(n !== index));
        s.toggleAttribute('inert', n !== index);
        const link = s.querySelector('a');
        if (link) link.tabIndex = n === index ? 0 : -1;
      });
      dotEls.forEach((d, n) => {
        d.classList.toggle('is-active', n === index);
        d.setAttribute('aria-current', String(n === index));
      });
    }

    function stopAutoplay() {
      if (carouselHandle) clearInterval(carouselHandle);
      carouselHandle = null;
    }

    function startAutoplay() {
      stopAutoplay();
      if (autoplayPaused) return;
      carouselHandle = setInterval(() => show(index + 1), 4500);
    }

    function updateAutoplayControl() {
      if (!autoplayToggle) return;
      autoplayToggle.setAttribute('aria-label', autoplayPaused ? 'Retomar rotação dos banners' : 'Pausar rotação dos banners');
      autoplayToggle.innerHTML = autoplayPaused ? '&#9654;' : '&#10074;&#10074;';
    }

    dotEls.forEach((dot) => {
      dot.addEventListener('click', () => {
        show(parseInt(dot.dataset.slide, 10));
        startAutoplay();
      });
    });

    root.querySelector('[data-carousel-direction="prev"]')?.addEventListener('click', () => {
      show(index - 1);
      startAutoplay();
    });
    root.querySelector('[data-carousel-direction="next"]')?.addEventListener('click', () => {
      show(index + 1);
      startAutoplay();
    });
    autoplayToggle?.addEventListener('click', () => {
      autoplayPaused = !autoplayPaused;
      if (autoplayPaused) stopAutoplay();
      else startAutoplay();
      updateAutoplayControl();
    });
    root.onmouseenter = stopAutoplay;
    root.onmouseleave = startAutoplay;
    root.onfocusin = stopAutoplay;
    root.onfocusout = startAutoplay;
    root.onkeydown = (event) => {
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault(); show(index + (event.key === 'ArrowRight' ? 1 : -1)); stopAutoplay();
    };
    let touchStart = null;
    root.ontouchstart = (event) => { touchStart = { x:event.changedTouches[0].clientX, y:event.changedTouches[0].clientY }; stopAutoplay(); };
    root.ontouchend = (event) => {
      if (!touchStart) return;
      const dx = event.changedTouches[0].clientX-touchStart.x;
      const dy = event.changedTouches[0].clientY-touchStart.y;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
      touchStart = null; startAutoplay();
    };

    updateAutoplayControl();
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

    const phoneDigits = String(footer.phone || '').replace(/\D/g, '');
    const phoneLink = document.getElementById('footer-phone-link');
    const emailLink = document.getElementById('footer-email-link');
    const emailIconLink = document.getElementById('footer-email-icon-link');
    const phoneRow = document.getElementById('footer-phone-row');
    const emailRow = document.getElementById('footer-email-row');
    if (phoneLink && phoneDigits) phoneLink.href = `tel:+${phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`}`;
    if (emailLink && footer.email) emailLink.href = `mailto:${footer.email}`;
    if (emailIconLink && footer.email) emailIconLink.href = `mailto:${footer.email}`;
    if (phoneRow) phoneRow.classList.toggle('is-hidden', !phoneDigits);
    if (emailRow) emailRow.classList.toggle('is-hidden', !footer.email);

    const legalInfo = [footer.legalName, footer.document, footer.address].filter(Boolean).join(' · ');
    const legalEl = document.getElementById('footer-legal-info');
    if (legalEl) {
      legalEl.textContent = legalInfo;
      legalEl.classList.toggle('is-hidden', !legalInfo);
    }
  }

  // --------------------------------------------------------------------------
  // Aplicação geral
  // --------------------------------------------------------------------------
  function applyContent(content) {
    applyTheme(content.theme);
    applyCarousel(content.carousel, content.hero);
    applyFlashSale(content.flashSale);
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
