/* =====================================================================
 * Agro Bras Hortifruti — Configuração do Supabase
 * ---------------------------------------------------------------------
 * PREENCHA AQUI com os dados do seu projeto Supabase.
 * Painel: Project Settings → API
 *   • SUPABASE_URL      = "Project URL"
 *   • SUPABASE_ANON_KEY = "anon public" (Project API keys)
 * ===================================================================== */

const SUPABASE_URL      = 'https://rjrfodbxcssavdzimxlr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RUvCTWXBMuaP54kXLqVbCQ_8Mv7wOWo';

/* PIN único de 4 dígitos (trava de tela compartilhada). Troque à vontade.
 * Não é segurança real — a anon key já é pública. É só uma trava de balcão. */
const APP_PIN = '1020';

/* =====================================================================
 * Inicialização do cliente (não precisa mexer abaixo)
 * ===================================================================== */

const AGB = {
  config: { SUPABASE_URL, SUPABASE_ANON_KEY, APP_PIN },
  client: null,
  /** true quando URL/KEY foram preenchidas (não são mais os placeholders). */
  get configurado() {
    return (
      SUPABASE_URL && SUPABASE_ANON_KEY &&
      !SUPABASE_URL.startsWith('COLE_AQUI') &&
      !SUPABASE_ANON_KEY.startsWith('COLE_AQUI')
    );
  }
};

(function initSupabase() {
  if (!AGB.configurado) {
    console.warn('[Agro Bras] Supabase ainda não configurado. Preencha SUPABASE_URL e SUPABASE_ANON_KEY em js/supabase.js.');
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.error('[Agro Bras] Biblioteca @supabase/supabase-js não carregou (CDN).');
    return;
  }
  AGB.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
  console.info('[Agro Bras] Cliente Supabase pronto.');
})();

window.AGB = AGB;
