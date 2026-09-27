# Brincar de Desejo — loja virtual segura

Loja virtual com front-end estático em HTML/CSS/JavaScript, API Node.js/Express no Render e banco PostgreSQL. Inclui catálogo, blog educativo, carrinho de visitante, frete configurável, checkout PIX, área do cliente, avaliações moderadas, painel administrativo e relatórios gerenciais.

## Relatórios administrativos

A aba **Relatórios** possui quatro visões: geral, produtos, clientes e pedidos. Todas compartilham filtros por período, cliente, produto, categoria, status e granularidade da linha do tempo.

- faturamento reconhecido, pedidos, ticket, unidades e compradores, com comparação ao período anterior;
- linhas do tempo de receita, unidades, compradores e pedidos;
- rankings de categorias, produtos, clientes e regiões;
- recorrência, novos compradores e segmentos de relacionamento;
- status, faixas de valor, dias da semana e mapa de calor por horário;
- saúde do estoque e alertas de reposição;
- leituras automáticas baseadas nos dados filtrados;
- exportação CSV da visão ativa e impressão preparada para salvar em PDF.

O faturamento considera apenas pedidos nos status `Pago`, `Em Produção`, `Enviado` e `Finalizado`. Quando há filtro de produto ou categoria, a receita é atribuída somente aos itens correspondentes, sem contabilizar o restante do pedido.

## Melhorias de segurança desta versão

- preço e total recalculados exclusivamente pela API;
- validação de produto ativo, quantidade e estoque dentro de transação;
- baixa de estoque na criação e devolução ao cancelar o pedido;
- reserva com prazo: pedidos PIX não pagos expiram e devolvem o estoque automaticamente;
- cotação de subtotal, frete e total feita pela API antes da confirmação;
- limite de pedidos simultâneos aguardando pagamento por cliente;
- endereço, telefone e CEP copiados para o pedido no momento da compra;
- chave, beneficiário e cidade PIX obrigatórios antes de aceitar pedidos;
- chave de idempotência contra pedidos duplicados;
- transições de status controladas;
- JWT de curta duração, usuário revalidado no PostgreSQL e revogação por `token_version`;
- sessão do navegador em `sessionStorage`, sem credenciais de teste na página;
- senha sem regras de tamanho no cadastro, scrypt para novas senhas, compatibilidade com bcrypt existente e limite de tentativas;
- CORS fechado em produção, limites de requisição e cabeçalhos de segurança;
- validação e limite de tamanho em textos, imagens e requisições;
- conteúdo público não expõe a chave PIX;
- avaliações somente após compra confirmada, uma por cliente/produto e com moderação antes da publicação;
- nomes de clientes não são publicados nas avaliações;
- exclusão de conta apaga avaliações e anonimiza pedidos concluídos;
- trilha de auditoria para alterações administrativas importantes;
- relatórios protegidos por acesso administrativo e agregados no servidor;
- produtos removidos são desativados, preservando o histórico;
- imagens otimizadas no navegador antes de serem salvas;
- migração compatível com o banco existente e script seguro para detectar e desativar duplicados exatos;
- testes unitários com `node:test`.

## Estrutura

```text
index.html, css/, js/, img/  front-end estático, blog e documentos legais
server/
  db/schema.sql              schema e alterações compatíveis
  db/migrate.js              aplica o schema
  db/seed.js                 cria/atualiza o administrador e repara o conteúdo
  db/cleanup-duplicates.js   detecta e desativa produtos repetidos
  src/                       API Express
  test/                      testes automatizados
```

## Desenvolvimento local

```bash
cd server
cp .env.example .env
# preencha DATABASE_URL, JWT_SECRET, ALLOWED_ORIGINS e dados do administrador
npm ci
npm run setup
npm test
npm run dev
```

Em outro terminal, na raiz do projeto:

```bash
python3 -m http.server 8080
```

Configure `js/apiConfig.js` com `http://localhost:3000` durante o desenvolvimento.

## Atualizando uma instalação existente

1. Faça um backup do PostgreSQL.
2. Publique o novo código da API.
3. Configure todas as variáveis de `server/.env.example` no Render.
4. Execute `npm ci` e `npm run migrate`.
   A migração deixa de reter CPFs antigos, anonimiza os nomes públicos de avaliações e atribui prazo às reservas PIX antigas; pedidos vencidos poderão ser cancelados automaticamente. Por isso, confirme o backup antes de executá-la.
5. Execute `npm run seed`. Isso redefine a senha do administrador para `ADMIN_PASSWORD`, revoga sessões antigas e repara o `site_content` vazio.
6. Verifique os produtos repetidos sem alterar dados:

   ```bash
   npm run cleanup:duplicates
   ```

7. Depois de revisar a lista, desative apenas as duplicatas exatas:

   ```bash
   npm run cleanup:duplicates -- --apply
   ```

8. Entre no painel, abra **Personalizar** e configure os banners, o frete, o PIX e os dados legais do rodapé.
9. Abra **Relatórios**, aplique um filtro de período e confira se os totais batem com os pedidos reconhecidos.
10. Faça um pedido de teste de valor baixo e confira a expiração da reserva.

O script de duplicados não altera o banco sem a opção `--apply`.

## Variáveis obrigatórias no Render

| Variável | Uso |
|---|---|
| `NODE_ENV=production` | ativa validações estritas e HSTS |
| `DATABASE_URL` | conexão PostgreSQL |
| `PG_SSL_REJECT_UNAUTHORIZED` | mantenha `true`; use `false` somente se seu provedor exigir |
| `JWT_SECRET` | segredo aleatório com pelo menos 32 caracteres |
| `ALLOWED_ORIGINS` | origens exatas do front-end, separadas por vírgula |
| `ADMIN_EMAIL` | conta administrativa inicial |
| `ADMIN_PASSWORD` | senha forte com letras e números |
| `ADMIN_NAME` | nome exibido para o administrador |
| `ORDER_PAYMENT_TTL_MINUTES` | minutos de reserva do estoque para PIX; padrão `30` |
| `MAX_OPEN_ORDERS_PER_USER` | limite de pedidos abertos por cliente; padrão `3` |

Não envie `.env` ao GitHub.

## Publicação

O guia detalhado está em `COMO-PUBLICAR.md`. Em resumo:

- Render: diretório raiz `server`, build `npm ci`, start `npm start`;
- PostgreSQL: execute `npm run migrate` e `npm run seed` após configurar as variáveis;
- front-end: publique a raiz do projeto e ajuste `js/apiConfig.js` com a URL HTTPS da API.

## PIX e estoque

O QR Code é um PIX estático válido, mas a confirmação do recebimento é manual. O cliente informa o pagamento e o administrador confere o extrato antes de mudar o status para `Pago`.

O estoque é reservado quando o pedido é criado. Ao cancelar ou expirar um pedido aguardando pagamento, a API devolve as quantidades ao estoque uma única vez. O frete atual é uma tarifa fixa configurável no painel, com limite opcional para gratuidade e prazo estimado.

## Limites conhecidos

- não existe pagamento por cartão, integração com transportadora/Correios ou cupom;
- não existe webhook bancário para confirmação automática;
- recuperação de senha, confirmação de e-mail e MFA dependem de um provedor de e-mail/autenticação e não estão ativados nesta versão;
- o limitador de requisições usa memória do processo, adequado para uma instância do Render; múltiplas instâncias devem usar um armazenamento compartilhado, como Redis;
- imagens são comprimidas e limitadas, mas lojas com muitas fotos devem migrá-las para um serviço de objetos e manter somente as URLs no PostgreSQL;
- os textos legais incluídos são uma base operacional e devem ser revisados por profissional qualificado com os dados e regras reais da loja.
