# Melhorias aplicadas — versão 3.1

## Relatórios gerenciais

- Nova área **Relatórios** no painel, com visões Geral, Produtos, Clientes e Pedidos.
- Filtros por datas, períodos rápidos, cliente, produto, categoria, status e agrupamento por dia, semana ou mês.
- Comparação automática com o período anterior de mesma duração.
- Gráficos de linha/área, colunas, barras, rosca e mapa de calor, todos responsivos e com descrição acessível.
- Rankings de produtos, categorias, clientes e cidades, além de segmentos de clientes e saúde do estoque.
- Faturamento reconhecido separado de pedidos pendentes e cancelados.
- Filtro por produto/categoria atribui receita somente aos itens correspondentes.
- Leituras automáticas de tendência, concentração, recorrência, cancelamento e reposição.
- Exportação CSV protegida contra fórmulas e layout de impressão para salvar a visão ativa em PDF.
- Endpoints analíticos exclusivos de administrador, sem enviar a base completa ao navegador.
- Índices PostgreSQL para data/status/cliente e pesquisa dos itens JSON dos pedidos.
- Testes de período, granularidade, comparação e validação dos filtros.

## Bloqueadores corrigidos

- A API não aceita mais preço, nome ou total enviados pelo navegador.
- Produtos são consultados e bloqueados no PostgreSQL durante o pedido.
- Estoque é validado, reduzido atomicamente e restaurado uma vez ao cancelar.
- O pedido guarda uma cópia do endereço, telefone, cidade, UF e CEP.
- O PIX só é gerado após validar chave, beneficiário, cidade e valor.
- Pedidos repetidos são impedidos por `Idempotency-Key`.
- Mudanças de status seguem transições permitidas.
- O botão “paguei” só funciona para pedidos aguardando pagamento.
- Pedidos PIX expiram automaticamente, liberam o estoque uma vez e informam o motivo do cancelamento.
- Subtotal, frete e total são cotados pela API; o navegador não define valores.
- O cliente pode cancelar uma reserva ainda aguardando pagamento.
- Há limite configurável de pedidos abertos por cliente.

## Autenticação e API

- JWT com algoritmo, emissor, público e expiração de duas horas.
- Usuário e versão da sessão são conferidos no banco em toda rota protegida.
- Alterar a senha revoga tokens anteriores.
- Senhas exigem 10 a 128 caracteres, letras e números.
- bcrypt atualizado e configurado com custo 12.
- Limites separados para API, login, pedidos e avaliações.
- CORS obrigatório em produção e mensagens internas ocultadas.
- Cabeçalhos HSTS, CSP da API, proteção de iframe, MIME e permissões.
- CSP no host estático, bloqueio de enquadramento e fallback no navegador contra clickjacking.
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
- Avaliações novas ficam pendentes, usam identificação pública genérica e exigem aprovação do administrador.
- Exclusão de conta remove avaliações, anonimiza pedidos finalizados/cancelados e bloqueia a operação se houver pedido ativo.
- Log administrativo registra mudanças de produtos, pedidos, avaliações e personalização.
- Script de duplicados possui simulação padrão e exige `--apply` para desativar.

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
- Cadastro deixou de coletar CPF e registra a confirmação de maioridade.
- CSP no HTML, integridade SRI nos recursos do CDN e estados de foco visíveis.
- Promessas inexistentes de cartão, frete grátis e cupom foram removidas.
- Páginas dedicadas de privacidade, termos, trocas e pagamento PIX foram incluídas.
- A página inicial segue a nova ordem visual: banner, seleção, catálogo, como funciona, destaque, FAQ e rodapé.
- Banner e carrossel foram integrados; cada slide possui selo, título, frase e botão próprios.
- Paleta atualizada para vermelho, caramelo, branco e fundo escuro.
- Catálogo ganhou navegação por categorias, busca ampliada, preço comparativo, desconto real, avaliação real e indicação de PIX.
- Blog educativo e assistente flutuante de atalhos foram adicionados.
- O painel ganhou paginação, resumo calculado no banco, moderação de avaliações, auditoria, frete e texto individual por banner.

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
7. Configurar frete e substituir razão social, documento, endereço, telefone, e-mail e políticas pelos dados definitivos.
8. Revisar os textos legais com profissional qualificado.
9. Fazer um pedido real de valor baixo antes da divulgação.
10. Contratar e integrar um provedor caso sejam desejadas recuperação de senha, verificação de e-mail e MFA.
