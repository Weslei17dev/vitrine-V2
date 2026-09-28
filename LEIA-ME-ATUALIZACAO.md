# Atualização da vitrine V2

## Para atualizar a loja existente

1. Os novos ajustes de produto, categorias, carrinho e filtro por número de pedido não exigem migração. Se você ainda não aplicou a atualização anterior de custos, execute `MIGRACAO-MELHORIAS-CUSTOS.sql` no SQL Editor do seu banco (Supabase ou Neon).
2. Envie os arquivos desta versão ao repositório do site, incluindo a pasta `server`.
3. Faça o deploy da API no Render e do front-end no seu host habitual.
4. Atualize o navegador com `Ctrl + F5`.
5. No administrador, abra Produtos e informe o custo de aquisição de cada item. A análise fica em **Custos e lucro**.

Não é necessário executar `seed`, cargas de demonstração nem recriar o banco. A migração anterior de custos acrescenta somente `products.cost_price`. Ela pode ser executada mais de uma vez e não muda os preços, as contas ou os pedidos já existentes.

A URL de API presente no arquivo enviado foi preservada em `js/apiConfig.js`. Mantenha suas variáveis do Render, incluindo `DATABASE_URL` com a conexão atual do banco. Nenhum deploy ou alteração no banco real foi executado durante a preparação do pacote. Publique também a pasta `server`: a busca por número precisa da API atualizada.

## Novidades desta entrega

- Correção do menu de categorias: passa o mouse para abrir no computador; no celular, toque em “Categorias”. O menu também mantém o acesso por clique e exibe categorias com produtos mesmo quando a lista de categorias configuradas não estiver completa.
- Controle “− / +” e campo de quantidade atualizam o subtotal antes da compra. “Adicionar ao carrinho” acrescenta as unidades selecionadas e “Comprar agora” soma as unidades ao carrinho antes do checkout. O limite respeita o estoque disponível e o máximo de 99 unidades por item.
- Clique na imagem principal para abrir a galeria; na janela, clique na foto ou em “Ampliar 2×” para aproximar. No computador, mova o mouse para examinar os detalhes; as setas trocam de foto.
- Versão dos arquivos CSS e JavaScript na página para que a publicação carregue o conjunto atualizado. O HTML solicita revalidação ao host que suporta `_headers`.
- Página de produto com foto inteira, miniaturas, ampliação e navegação entre fotos; no celular também é possível deslizar a foto principal.
- Preço, estoque, seletor de quantidade, subtotal, “Comprar agora” e “Adicionar ao carrinho” reunidos em um bloco de compra.
- Descrição completa, informações adicionais, avaliações e relacionados em seções acessíveis por atalhos.
- Link compartilhável do produto, que abre o detalhe mesmo após atualizar a página.
- Busca no cabeçalho, menu visual de categorias, ordenação por preço, avaliação ou nome e filtro de produtos disponíveis.
- Visitantes podem montar o carrinho e mantê-lo ao recarregar a página. Entrar ou cadastrar-se durante a finalização recupera os itens e abre o checkout. “Comprar agora” acrescenta a quantidade selecionada ao carrinho e leva à revisão de todos os itens antes de confirmar.
- No administrador, número do pedido clicável para abrir detalhes e novo filtro por número completo ou parcial, aceitando `000123`, `#000123` ou `123`. Pressione Enter ou clique em “Aplicar filtros”. A busca é feita no servidor antes da paginação, pode ser combinada com os demais filtros e é removida pelo botão “Limpar”.
- Acesso “Ver loja” no painel e “Administrador” na loja preservados.

Os ajustes utilizam os campos já existentes. Opções de tamanho/cor, hierarquia de subcategorias e novos meios de pagamento não foram acrescentados. A revisão dos vídeos considerou os elementos visíveis; o áudio não pôde ser analisado no ambiente de trabalho.

## Melhorias incluídas

- Cadastro com nome, telefone, e-mail e senha, sem pedir endereço.
- Senha sem quantidade mínima ou máxima de caracteres na regra do formulário/API. O limite geral de tamanho das requisições continua existindo. Senhas longas são armazenadas sem truncamento; contas antigas continuam funcionando.
- Endereço editável no perfil e no checkout; a confirmação salva os dados e gera o pedido.
- Filtros de pedidos por número, data, cliente, status, produto e valor.
- Filtros de produtos por nome/descrição, categoria, status, preço e estoque.
- Filtros de clientes por nome/e-mail/telefone, cidade, UF, total gasto e data de cadastro.
- Filtros de avaliações por texto/produto, publicação, nota e data.
- Paginação dos resultados filtrados com “Carregar mais”.
- Formulário de produto com preço original, promocional opcional, custo e margem automática.
- Página de custos com período, categoria e produto; receita, custo vendido, lucro bruto, margem e valor de aquisição do estoque.
- Colunas alinhadas no quadro de pedidos recentes.
- Banners com setas, indicadores, teclado e gesto de deslizar no celular.
- Categorias menores, com fotos circulares e seleção no cabeçalho; abrem o catálogo filtrado.
- Avaliações compactas, três inicialmente e “Ver mais” em grupos de três.
- Carrosséis de fotos nos cards, destaques, relacionados e página de produto. As fotos adicionais dos cards são carregadas quando necessárias.

## Preço promocional e cálculo

Com promoção, o cliente paga o valor promocional e vê o original riscado. Sem promoção, paga o preço original. O preço promocional precisa ser positivo e menor que o original.

`Lucratividade (%) = ((preço cobrado - custo) / preço cobrado) × 100`

É margem bruta sobre a venda, não percentual de acréscimo sobre o custo. Não inclui frete, impostos ou despesas operacionais. Um custo zero explicitamente informado é aceito; campo vazio significa custo desconhecido.

O custo é registrado no item de cada novo pedido no momento de sua criação. Mudanças posteriores no produto não alteram esse custo histórico. Pedidos antigos sem custo registrado são identificados como “sem custo histórico” e não entram no lucro apurado. O relatório mostra a cobertura para evitar tratar custos desconhecidos como zero. Preencha os custos antes das próximas vendas para ampliar a cobertura.

## Verificação

Os testes unitários da API podem ser executados com `npm ci` e `npm test` dentro de `server`. O pacote inclui os testes das novas regras de senha, filtros e custo do pedido.

Na preparação desta versão passaram 19 testes unitários, testes de integração da API com PostgreSQL local (PGlite) e verificações no Chromium em desktop e celular. Foram verificados galeria, avaliações, persistência do carrinho de visitante, link direto, cadastro, checkout, filtro de pedidos, filtros administrativos e custos. Isso não substitui a conferência do ambiente publicado após o deploy.

O arquivo `COMO-PUBLICAR.md` continua com as instruções gerais de instalação do projeto. Para atualizar uma loja já funcionando, siga primeiro os passos deste arquivo.
