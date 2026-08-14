# Melhorias aplicadas — versão 2.0

## Bloqueadores corrigidos

- A API não aceita mais preço, nome ou total enviados pelo navegador.
- Produtos são consultados e bloqueados no PostgreSQL durante o pedido.
- Estoque é validado, reduzido atomicamente e restaurado uma vez ao cancelar.
- O pedido guarda uma cópia do endereço, telefone, cidade, UF e CEP.
- O PIX só é gerado após validar chave, beneficiário, cidade e valor.
- Pedidos repetidos são impedidos por `Idempotency-Key`.
- Mudanças de status seguem transições permitidas.
- O botão “paguei” só funciona para pedidos aguardando pagamento.

## Autenticação e API

- JWT com algoritmo, emissor, público e expiração de duas horas.
- Usuário e versão da sessão são conferidos no banco em toda rota protegida.
- Alterar a senha revoga tokens anteriores.
- Senhas exigem 10 a 128 caracteres, letras e números.
- bcrypt atualizado e configurado com custo 12.
- Limites separados para API, login, pedidos e avaliações.
- CORS obrigatório em produção e mensagens internas ocultadas.
- Cabeçalhos HSTS, CSP da API, proteção de iframe, MIME e permissões.
- `x-powered-by` removido, JSON limitado e PostgreSQL com timeouts/TLS verificável.
- Encerramento gracioso do pool do banco no Render.

## Banco e dados

- Migração compatível com tabelas existentes usando `ADD COLUMN IF NOT EXISTS`.
- Índice de e-mail sem diferença entre maiúsculas e minúsculas.
- Índices para produtos, pedidos, avaliações e idempotência.
- `site_content` vazio recebe os campos padrão sem apagar personalizações existentes.
- A rota pública de conteúdo não retorna a configuração PIX.
- Produtos excluídos no painel são desativados em vez de apagados.
- Avaliação exige compra confirmada e permite uma avaliação por cliente/produto.
- Script de duplicados possui simulação padrão e exige `--apply` para excluir.

## Front-end

- Carrinho funciona para visitante; o login é solicitado na finalização.
- Sessão migrou de `localStorage` para `sessionStorage`.
- Sessão é validada na API ao recarregar a página.
- Imagens são validadas, redimensionadas e convertidas para WEBP antes do envio.
- URLs, cores, ícones e dados recuperados são sanitizados antes da renderização.
- Requisições repetidas de produtos e conteúdo foram eliminadas.
- Polling passou de 3 para 15 segundos e pausa com a página oculta.
- Tela de atualização de cadastro, alteração de senha e exclusão de conta.
- Confirmação de maioridade, foco preso nos modais e melhorias de ARIA.
- CSP no HTML e integridade SRI nos recursos do CDN.
- Promessas inexistentes de cartão, frete grátis e cupom foram removidas.
- Informações iniciais de privacidade, troca e compra segura foram incluídas.

## Operação

- `.env.example`, `.gitignore` e `render.yaml` adicionados.
- README e guia de publicação reescritos para Render + PostgreSQL.
- Script de seed redefine a senha administrativa e revoga sessões antigas.
- Testes automatizados cobrem validações, cálculo seguro do pedido, estoque lógico, PIX e recuperação do conteúdo.

## Ações que ainda dependem do responsável pela implantação

1. Fazer backup do banco.
2. Publicar a nova API.
3. Configurar as variáveis do Render.
4. Executar `npm run migrate` e `npm run seed`.
5. Configurar o PIX no painel.
6. Revisar e aplicar a limpeza de duplicados.
7. Substituir telefone, e-mail e políticas pelos dados definitivos da empresa.
8. Fazer um pedido real de valor baixo antes da divulgação.
