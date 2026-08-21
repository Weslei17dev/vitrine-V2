/* Página institucional separada da vitrine principal. */
(function (global) {
  'use strict';

  let pendingTarget = null;

  const DOCUMENTS = [
    {
      id: 'legal-privacy',
      title: 'Política de Privacidade',
      body: `
        <p>Esta política explica quais dados são utilizados para operar a loja e quais controles estão disponíveis ao cliente.</p>
        <h3>Dados utilizados</h3>
        <ul><li>nome, e-mail e senha protegida para autenticação;</li><li>telefone, endereço, cidade, estado e CEP para entrega e atendimento;</li><li>itens, valores e histórico de status para processar e acompanhar pedidos.</li></ul>
        <p>O site não solicita CPF no cadastro. Dados de pagamento bancário não são coletados: o pagamento ocorre no aplicativo da instituição financeira por meio de PIX.</p>
        <h3>Avaliações públicas</h3>
        <p>Avaliações são exibidas como “Cliente verificado”, sem nome completo, e somente depois de moderação. A data pública é limitada ao mês e ao ano.</p>
        <h3>Segurança e direitos</h3>
        <p>Senhas são armazenadas em formato protegido e sessões podem ser encerradas após alteração de senha. O cliente pode consultar e corrigir seus dados na própria conta e usar o e-mail do rodapé para solicitar suporte sobre privacidade.</p>`
    },
    {
      id: 'legal-terms',
      title: 'Termos de Uso',
      body: `
        <p>Ao criar uma conta, o cliente confirma a veracidade dos dados de cadastro e entrega.</p>
        <h3>Conta e pedidos</h3>
        <p>O cliente é responsável por manter sua senha em sigilo. Preços, estoque e frete são confirmados pelo servidor antes da criação do pedido. Pedidos aguardando pagamento podem expirar no prazo informado e ter o estoque liberado automaticamente.</p>
        <h3>Conteúdo e uso responsável</h3>
        <p>Descrições e artigos têm finalidade comercial ou educativa e não substituem orientação profissional. Cada produto deve ser usado conforme as instruções do fabricante e dentro dos limites e do consentimento de todas as pessoas envolvidas.</p>`
    },
    {
      id: 'legal-exchanges',
      title: 'Trocas e Devoluções',
      body: `
        <p>Para solicitar análise, entre em contato pelo e-mail do rodapé e informe o número do pedido, o motivo e, quando aplicável, imagens da embalagem recebida.</p>
        <h3>Condições de higiene e segurança</h3>
        <p>Produtos de uso íntimo podem ter restrições de troca após a abertura do lacre por razões de saúde e higiene, exceto em caso de defeito, divergência ou obrigação prevista em lei. Não envie nenhum item antes de receber orientação da equipe.</p>
        <h3>Prazos</h3>
        <p>Solicitações são avaliadas conforme a data de entrega, o tipo de ocorrência, a integridade do produto e as regras aplicáveis ao comércio eletrônico.</p>`
    },
    {
      id: 'legal-security',
      title: 'Compra e pagamento via PIX',
      body: `
        <p>O site gera um QR Code e um código Pix copia e cola com o valor final do pedido. Antes de confirmar no banco, confira o nome do beneficiário, o valor e a descrição exibidos pelo aplicativo financeiro.</p>
        <p>A opção “Já realizei o pagamento” apenas informa a equipe; ela não comprova o recebimento. O status muda para pago somente após conferência administrativa. Nunca faça uma transferência para uma chave enviada fora dos canais oficiais sem validar os dados.</p>`
    }
  ];

  function render() {
    const root = document.getElementById('legal-content');
    if (!root) return;
    root.innerHTML = DOCUMENTS.map((document) => `
      <section id="${document.id}" class="legal-document">
        <h2>${Utils.escapeHtml(document.title)}</h2>
        ${document.body}
      </section>`).join('');

    if (pendingTarget) {
      const target = pendingTarget;
      pendingTarget = null;
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
    }
  }

  function open(target) {
    const sourceView = global.App.getCurrentView();
    const backButton = document.getElementById('legal-back-button');
    if (backButton) {
      const returnToForm = sourceView === 'register' || sourceView === 'login';
      backButton.dataset.nav = returnToForm ? sourceView : 'store';
      backButton.innerHTML = returnToForm
        ? '<i class="fa-solid fa-arrow-left"></i> Voltar ao formulário'
        : '<i class="fa-solid fa-arrow-left"></i> Voltar para a loja';
    }
    pendingTarget = target || 'legal-privacy';
    global.App.navigate('legal');
    render();
  }

  function init() {
    document.querySelectorAll('[data-action="open-legal"]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        open(link.dataset.legalTarget);
      });
    });
    render();
  }

  global.LegalModule = { init, render, open };
})(window);
