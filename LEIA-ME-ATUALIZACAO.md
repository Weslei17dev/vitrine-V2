# Atualização da vitrine V2

## Para atualizar a loja existente

1. No SQL Editor do Supabase, execute o arquivo completo `MIGRACAO-DESCONTOS-E-CUPONS.sql` **antes** de publicar a API. Ele cria as tabelas de descontos e registros de uso dos cupons e adiciona os valores de desconto aos pedidos. Pode ser executado novamente. Se ainda não aplicou a atualização anterior de custos, execute também `MIGRACAO-MELHORIAS-CUSTOS.sql`.
2. Envie os arquivos desta versão ao repositório do site, incluindo a pasta `server`.
3. Faça o deploy da API no Render e do front-end no seu host habitual.
4. Atualize o navegador com `Ctrl + F5`.
5. No administrador, abra Produtos e informe o custo de aquisição de cada item. A análise fica em **Custos e lucro**.

Não é necessário executar `seed`, cargas de demonstração nem recriar o banco. As migrações preservam os dados existentes. A de custos acrescenta `products.cost_price`; a de descontos cria `promotions` e `coupon_redemptions` e registra desconto e cupom em cada novo pedido.

A URL de API presente no arquivo enviado foi preservada em `js/apiConfig.js`. Mantenha suas variáveis do Render, incluindo `DATABASE_URL` com a conexão atual do banco. Nenhum deploy ou alteração no banco real foi executado durante a preparação do pacote. Publique também a pasta `server`: a busca por número precisa da API atualizada.

## Novidades desta entrega

- Ao passar o mouse sobre uma miniatura da galeria, a foto principal muda imediatamente. O clique continua funcionando no celular.
- O menu de categorias agora tem uma coluna de itens menores, imagem menor e nenhum contador de produtos.
- Nova aba **Descontos e cupons** no administrador: tipo automático ou cupom, abrangência em toda a loja, uma categoria ou um produto, percentual ou valor fixo, datas, ativação e limite de usos para cupons. É possível editar e desativar sem apagar o histórico.
- Desconto automático reduz o preço exibido na vitrine; o checkout aceita um código de cupom, permite removê-lo e mostra cada abatimento antes de gerar o PIX. O servidor recalcula o desconto, o frete e o total a cada cotação e na confirmação.
- Regras de cálculo: quando há vários descontos automáticos aplicáveis, vale apenas o maior em cada produto; valor fixo automático é abatido por unidade. O cupom pode ser combinado e aplica percentual ou valor fixo uma vez aos itens elegíveis já descontados. O mínimo final do pedido é R$ 0,01 para gerar PIX. O cupom limitado tem seu uso liberado quando o pedido é cancelado.
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

Os ajustes de fotos/categorias usam os campos existentes. Os descontos exigem a migração acima. Opções de tamanho/cor, hierarquia de subcategorias e novos meios de pagamento não foram acrescentados. A revisão dos vídeos considerou os elementos visíveis; o áudio não pôde ser analisado no ambiente de trabalho.

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

Na preparação desta versão passaram 19 testes unitários, testes de integração da API com PostgreSQL local (PGlite) e verificações no Chromium em desktop e celular. Foram verificados galeria, menu, cupons e descontos, valor do PIX, liberação do cupom cancelado, checkout, filtro de pedidos, filtros administrativos e custos. Isso não substitui a conferência do ambiente publicado após o deploy.

O arquivo `COMO-PUBLICAR.md` continua com as instruções gerais de instalação do projeto. Para atualizar uma loja já funcionando, siga primeiro os passos deste arquivo.
