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
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  function maskPhone(value) {
    return value
      .replace(/\D/g, '')
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .slice(0, 15);
  }

  function maskCpf(value) {
    return value
      .replace(/\D/g, '')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
      .slice(0, 14);
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
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('modal--open');
    document.body.classList.add('no-scroll');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('modal--open');
    if (!document.querySelector('.modal--open')) {
      document.body.classList.remove('no-scroll');
    }
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
    maskPhone,
    maskCpf,
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
