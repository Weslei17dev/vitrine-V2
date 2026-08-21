/* ============================================================================
   utils.js
   ----------------------------------------------------------------------------
   Funções utilitárias reutilizadas por todos os módulos: formatação,
   toasts (notificações), controle de modais, som de notificação e mapa
   visual de status dos pedidos.
   ============================================================================ */

(function (global) {
  'use strict';

  // --------------------------------------------------------------------------
  // Formatação
  // --------------------------------------------------------------------------
  function formatCurrency(value) {
    return Number(value).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function escapeHtml(str) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str ?? '').replace(/[&<>"']/g, (character) => entities[character]);
  }

  function safeImageSrc(value) {
    if (!value) return '';
    const source = String(value).trim();
    const isHttps = /^https:\/\/[^\s]+$/i.test(source);
    const isLocal = /^img\/[A-Za-z0-9._/-]+$/.test(source) && !source.includes('..');
    const isDataImage = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(source);
    return isHttps || isLocal || isDataImage ? source : '';
  }

  function safeColor(value) {
    const color = String(value || '');
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#D99163';
  }

  function compressImageFile(file, options = {}) {
    const maxWidth = options.maxWidth || 1200;
    const maxHeight = options.maxHeight || 1200;
    const quality = options.quality || 0.78;
    if (!file || !/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      return Promise.reject(new Error('Selecione uma imagem PNG, JPG, WEBP ou GIF.'));
    }
    if (file.size > 8 * 1024 * 1024) {
      return Promise.reject(new Error('A imagem original deve ter no máximo 8 MB.'));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
        image.onload = () => {
          const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const result = canvas.toDataURL('image/webp', quality);
          if (result.length > 300000) return reject(new Error('A imagem continua muito grande após a otimização. Use uma imagem menor ou mais simples.'));
          resolve(result);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function maskPhone(value) {
    return value
      .replace(/\D/g, '')
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .slice(0, 15);
  }

  function maskCep(value) {
    return value
      .replace(/\D/g, '')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .slice(0, 9);
  }

  // --------------------------------------------------------------------------
  // Status: cor/ícone associados a cada status de pedido (usado em vários
  // lugares: tabela do admin, histórico do cliente, stepper de progresso).
  // --------------------------------------------------------------------------
  const STATUS_META = {
    'Aguardando Pagamento': { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)', icon: 'fa-clock' },
    'Aguardando Confirmação': { color: 'var(--color-info)', bg: 'var(--color-info-bg)', icon: 'fa-hourglass-half' },
    'Pago': { color: 'var(--color-success)', bg: 'var(--color-success-bg)', icon: 'fa-circle-check' },
    'Em Produção': { color: 'var(--color-primary)', bg: 'var(--color-primary-bg)', icon: 'fa-gears' },
    'Enviado': { color: 'var(--color-accent-dark)', bg: 'var(--color-accent-bg)', icon: 'fa-truck-fast' },
    'Finalizado': { color: 'var(--color-success)', bg: 'var(--color-success-bg)', icon: 'fa-flag-checkered' },
    'Cancelado': { color: 'var(--color-danger)', bg: 'var(--color-danger-bg)', icon: 'fa-ban' }
  };

  function statusMeta(status) {
    return STATUS_META[status] || { color: 'var(--color-text-muted)', bg: '#eee', icon: 'fa-circle' };
  }

  function statusBadgeHtml(status) {
    const meta = statusMeta(status);
    return `<span class="status-badge" style="--badge-color:${meta.color}; --badge-bg:${meta.bg}">
              <i class="fa-solid ${meta.icon}"></i> ${escapeHtml(status)}
            </span>`;
  }

  // --------------------------------------------------------------------------
  // Toasts (notificações flutuantes no canto da tela)
  // --------------------------------------------------------------------------
  function ensureToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, type = 'info', options = {}) {
    const container = ensureToastContainer();
    const icons = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      info: 'fa-circle-info',
      warning: 'fa-triangle-exclamation',
      order: 'fa-bell'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <i class="fa-solid ${icons[type] || icons.info}"></i>
      <div class="toast__content">
        ${options.title ? `<strong>${escapeHtml(options.title)}</strong>` : ''}
        <span>${escapeHtml(message)}</span>
      </div>
      <button class="toast__close" aria-label="Fechar notificação"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));

    const remove = () => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 250);
    };

    toast.querySelector('.toast__close').addEventListener('click', remove);
    setTimeout(remove, options.duration || 4500);
  }

  // --------------------------------------------------------------------------
  // Modais genéricos (abrir/fechar por id, fecha ao clicar fora ou ESC)
  // --------------------------------------------------------------------------
  let lastFocusedElement = null;

  function focusableElements(modal) {
    return Array.from(modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    modal.classList.add('modal--open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    const focusable = focusableElements(modal);
    if (focusable[0]) focusable[0].focus();
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('modal--open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal--open')) {
      document.body.classList.remove('no-scroll');
    }
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
  }

  function setupModalDismiss() {
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-close-modal]')) {
        const modal = e.target.closest('.modal');
        if (modal) closeModal(modal.id);
      }
      if (e.target.classList.contains('modal') && e.target.classList.contains('modal--open')) {
        closeModal(e.target.id);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal--open').forEach((m) => closeModal(m.id));
      }
      if (e.key === 'Tab') {
        const modal = document.querySelector('.modal--open');
        if (!modal) return;
        const focusable = focusableElements(modal);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Som de notificação (gerado via Web Audio API — não depende de arquivo
  // externo, então funciona 100% offline).
  // --------------------------------------------------------------------------
  function playNotificationSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const notes = [880, 1108.73];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.14 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.14 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.14);
        osc.stop(ctx.currentTime + i * 0.14 + 0.32);
      });
    } catch (err) {
      // Ambientes sem suporte a áudio simplesmente ignoram o som.
      console.warn('[utils] Som de notificação indisponível:', err.message);
    }
  }

  // --------------------------------------------------------------------------
  // Validação simples de e-mail
  // --------------------------------------------------------------------------
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  // --------------------------------------------------------------------------
  // Exposição pública
  // --------------------------------------------------------------------------
  global.Utils = {
    formatCurrency,
    escapeHtml,
    safeImageSrc,
    safeColor,
    compressImageFile,
    maskPhone,
    maskCep,
    statusMeta,
    statusBadgeHtml,
    showToast,
    openModal,
    closeModal,
    setupModalDismiss,
    playNotificationSound,
    isValidEmail
  };
})(window);
