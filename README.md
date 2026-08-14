# Brincar de Desejo — loja virtual segura

Loja virtual com front-end estático em HTML/CSS/JavaScript, API Node.js/Express no Render e banco PostgreSQL. Inclui catálogo, carrinho de visitante, checkout PIX, área do cliente, avaliações de compradores e painel administrativo.

## Melhorias de segurança desta versão

- preço e total recalculados exclusivamente pela API;
- validação de produto ativo, quantidade e estoque dentro de transação;
- baixa de estoque na criação e devolução ao cancelar o pedido;
- endereço, telefone e CEP copiados para o pedido no momento da compra;
- chave, beneficiário e cidade PIX obrigatórios antes de aceitar pedidos;
- chave de idempotência contra pedidos duplicados;
- transições de status controladas;
- JWT de curta duração, usuário revalidado no PostgreSQL e revogação por `token_version`;
- sessão do navegador em `sessionStorage`, sem credenciais de teste na página;
- senha mínima de 10 caracteres, bcrypt com custo 12 e limite de tentativas;
- CORS fechado em produção, limites de requisição e cabeçalhos de segurança;
- validação e limite de tamanho em textos, imagens e requisições;
- conteúdo público não expõe a chave PIX;
- avaliações somente após compra confirmada, uma por cliente/produto;
- produtos removidos são desativados, preservando o histórico;
- imagens otimizadas no navegador antes de serem salvas;
- migração compatível com o banco existente e script seguro para detectar duplicados;
- testes unitários com `node:test`.

## Estrutura

```text
index.html, css/, js/, img/  front-end estático
server/
  db/schema.sql              schema e alterações compatíveis
  db/migrate.js              aplica o schema
  db/seed.js                 cria/atualiza o administrador e repara o conteúdo
  db/cleanup-duplicates.js   detecta e remove produtos repetidos
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
5. Execute `npm run seed`. Isso redefine a senha do administrador para `ADMIN_PASSWORD`, revoga sessões antigas e repara o `site_content` vazio.
6. Verifique os produtos repetidos sem alterar dados:

   ```bash
   npm run cleanup:duplicates
   ```

7. Depois de revisar a lista, remova apenas as duplicatas exatas:

   ```bash
   npm run cleanup:duplicates -- --apply
   ```

8. Entre no painel, abra **Personalizar**, configure o PIX e faça um pedido de teste de valor baixo.

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

Não envie `.env` ao GitHub.

## Publicação

O guia detalhado está em `COMO-PUBLICAR.md`. Em resumo:

- Render: diretório raiz `server`, build `npm ci`, start `npm start`;
- PostgreSQL: execute `npm run migrate` e `npm run seed` após configurar as variáveis;
- front-end: publique a raiz do projeto e ajuste `js/apiConfig.js` com a URL HTTPS da API.

## PIX e estoque

O QR Code é um PIX estático válido, mas a confirmação do recebimento é manual. O cliente informa o pagamento e o administrador confere o extrato antes de mudar o status para `Pago`.

O estoque é reservado quando o pedido é criado. Ao cancelar um pedido antes do envio, a API devolve as quantidades ao estoque uma única vez.

## Limites conhecidos

- não existe pagamento por cartão, cálculo automático de frete ou cupom;
- não existe webhook bancário para confirmação automática;
- o limitador de requisições usa memória do processo, adequado para uma instância do Render; múltiplas instâncias devem usar um armazenamento compartilhado, como Redis;
- imagens são comprimidas e limitadas, mas lojas com muitas fotos devem migrá-las para um serviço de objetos e manter somente as URLs no PostgreSQL;
- políticas institucionais incluídas são um texto operacional inicial e devem ser revisadas com os dados e regras reais da loja.
