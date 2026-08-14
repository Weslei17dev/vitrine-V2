'use strict';

const SITE_CONTENT_DEFAULTS = {
  theme: {
    bg: '#150A10', surface: '#211019', primary: '#FF3D82', primaryDark: '#C81760',
    accent: '#FF3B4E', accentDark: '#C4172A', text: '#F5EBEF', textMuted: '#B49AA8', dark: '#0B0509'
  },
  pix: { chave: '', nomeBeneficiario: '', cidadeBeneficiario: '' },
  hero: {
    eyebrow: 'Bem-vindo(a) à Brincar de Desejo',
    title: 'Desejo, prazer e sedução\nem um só lugar.',
    subtitle: 'Produtos selecionados com cuidado, entrega discreta e atendimento sem julgamentos. Monte seu carrinho à vontade — o login é solicitado somente para finalizar o pedido.',
    ctaText: 'Ver produtos'
  },
  carousel: [
    { image: 'img/promo-dessensibilizante.jpg', alt: 'Produtos selecionados para uma experiência mais confortável' },
    { image: 'img/promo-bdsm.jpg', alt: 'Acessórios para explorar novos desejos' },
    { image: 'img/promo-acessorios.jpg', alt: 'Acessórios para momentos especiais' }
  ],
  flashSale: {
    tag: 'Seleção Especial', title: 'Descubra os favoritos da loja',
    description: 'Produtos selecionados para tornar seus momentos ainda mais especiais.'
  },
  about: {
    image: 'img/quem-somos.jpg', eyebrow: 'Quem somos',
    title: 'Prazer, autoconhecimento e liberdade — sem tabus.',
    paragraph1: 'A Brincar de Desejo nasceu para tornar o universo da sexualidade mais leve, acessível e livre de julgamentos. Selecionamos cada produto com cuidado, pensando em conforto, qualidade e segurança.',
    paragraph2: 'Da escolha à entrega, prezamos pela sua privacidade: embalagens sem identificação, atendimento humano e discrição do primeiro clique até a porta de casa.',
    bullets: ['Produtos selecionados com cuidado', 'Atendimento humano e sem julgamentos', 'Compromisso com a sua privacidade']
  },
  spotlight: {
    image: 'img/promo-dessensibilizante.jpg', eyebrow: 'Destaque da semana',
    title: 'Conforto e cuidado em primeiro lugar',
    text: 'Conheça nossa seleção de produtos pensados para proporcionar experiências mais confortáveis e especiais.',
    buttonText: 'Ver produtos relacionados'
  },
  faq: [
    { q: 'Minha compra é realmente discreta?', a: 'Sim. Todo pedido é preparado para envio em embalagem externa neutra, sem identificação do conteúdo.' },
    { q: 'Preciso criar conta para ver os produtos?', a: 'Não. Você pode navegar e montar seu carrinho livremente. A conta é solicitada somente ao finalizar o pedido.' },
    { q: 'Quais formas de pagamento vocês aceitam?', a: 'O pagamento disponível no site é PIX. A confirmação é realizada pela equipe após a conferência do recebimento.' },
    { q: 'Como acompanho meu pedido?', a: 'Depois de entrar na sua conta, acesse Meus Pedidos para consultar o status informado pela equipe.' },
    { q: 'Como solicito troca ou devolução?', a: 'Entre em contato com o atendimento, informe o número do pedido e aguarde as orientações aplicáveis ao produto.' },
    { q: 'Como meus dados são utilizados?', a: 'Os dados são utilizados para manter sua conta, processar o pedido, realizar a entrega e prestar atendimento.' }
  ],
  footer: {
    about: 'Loja online de produtos para adultos com atendimento humano, pagamento via PIX e envio discreto.',
    phone: '(11) 4810-6810', email: 'sac@brincardedesejo.com.br',
    hours1: 'Seg. a Sex. das 8h às 18h', hours2: 'Sábados das 8h às 12h'
  }
};

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base)) return override === undefined ? base : override;
  const result = { ...base };
  if (!isPlainObject(override)) return result;
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return result;
}

module.exports = { SITE_CONTENT_DEFAULTS, deepMerge };
