# Atualização da vitrine V2

## Para atualizar a loja existente

1. No SQL Editor do Neon, execute `MIGRACAO-MELHORIAS-CUSTOS.sql`, que está na raiz deste pacote.
2. Envie os arquivos desta versão ao repositório do site, incluindo a pasta `server`.
3. Faça o deploy da API no Render e do front-end no seu host habitual.
4. Atualize o navegador com `Ctrl + F5`.
5. No administrador, abra Produtos e informe o custo de aquisição de cada item. A análise fica em **Custos e lucro**.

Para esta atualização, não é necessário executar `seed`, cargas de demonstração nem recriar o banco. A migração acrescenta somente `products.cost_price`. Ela pode ser executada mais de uma vez e não muda os preços, as contas ou os pedidos já existentes.

A URL de API presente no arquivo enviado foi preservada em `js/apiConfig.js`. As variáveis do Render e a conexão com o Neon continuam as suas atuais. Nenhum deploy ou alteração no seu banco real foi executado durante a preparação do pacote.

## Melhorias incluídas

- Cadastro com nome, telefone, e-mail e senha, sem pedir endereço.
- Senha sem quantidade mínima ou máxima de caracteres na regra do formulário/API. O limite geral de tamanho das requisições continua existindo. Senhas longas são armazenadas sem truncamento; contas antigas continuam funcionando.
- Endereço editável no perfil e no checkout; a confirmação salva os dados e gera o pedido.
- Filtros de pedidos por data, cliente, status, produto e valor preservados.
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

O arquivo `COMO-PUBLICAR.md` continua com as instruções gerais de instalação do projeto. Para atualizar uma loja já funcionando, siga primeiro os passos deste arquivo.
