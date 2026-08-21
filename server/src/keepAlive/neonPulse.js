'use strict';

const DEFAULT_INTERVAL_MS = 4 * 60 * 1000;

function startNeonPulse(pool, options = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('O pool PostgreSQL precisa possuir o método query().');
  }

  const intervalMs = Number(options.intervalMs) || DEFAULT_INTERVAL_MS;
  let running = false;

  async function pulse() {
    if (running) return;
    running = true;

    try {
      await pool.query('SELECT 1');
      console.log(`[keep-alive] Neon respondeu em ${new Date().toISOString()}`);
    } catch (error) {
      console.error('[keep-alive] Falha no pulso do Neon:', error.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(pulse, intervalMs);
  timer.unref();
  pulse();

  return () => clearInterval(timer);
}

module.exports = { startNeonPulse };
