'use strict';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

function startRenderPulse(options = {}) {
  const baseUrl = String(
    options.baseUrl ||
    process.env.KEEP_ALIVE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  ).replace(/\/$/, '');

  if (!baseUrl) {
    console.warn('[keep-alive] KEEP_ALIVE_URL não configurada; pulso do Render desativado.');
    return () => {};
  }

  const intervalMs = Number(options.intervalMs) || DEFAULT_INTERVAL_MS;
  const healthUrl = `${baseUrl}/api/health`;
  let running = false;

  async function pulse() {
    if (running) return;
    running = true;

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'brincar-de-desejo-keep-alive/1.0' },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log(`[keep-alive] Render respondeu em ${new Date().toISOString()}`);
    } catch (error) {
      console.error('[keep-alive] Falha no pulso do Render:', error.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(pulse, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}

module.exports = { startRenderPulse };
