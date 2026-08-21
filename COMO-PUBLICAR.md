# Publicação segura — Render + PostgreSQL

## 1. Faça backup antes de atualizar

Se o sistema já está publicado, gere um backup ou snapshot no provedor PostgreSQL antes da migração. Os comandos desta versão preservam tabelas e registros existentes, mas o backup continua obrigatório.

## 2. Crie o PostgreSQL

Use Render PostgreSQL, Neon ou outro PostgreSQL compatível. Copie a URL completa de conexão TLS para `DATABASE_URL`.

## 3. Configure a API no Render

Crie um **Web Service** apontando para o repositório:

| Campo | Valor |
|---|---|
| Root Directory | `server` |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Configure estas variáveis:

```text
NODE_ENV=production
DATABASE_URL=postgresql://...
PG_SSL_REJECT_UNAUTHORIZED=true
JWT_SECRET=SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
JWT_ISSUER=brincar-de-desejo-api
JWT_AUDIENCE=brincar-de-desejo-web
JWT_EXPIRES_IN=2h
ALLOWED_ORIGINS=https://SEU-USUARIO.github.io
ADMIN_EMAIL=seu-admin@dominio.com.br
ADMIN_PASSWORD=UMA_SENHA_FORTE_COM_LETRAS_E_NUMEROS
ADMIN_NAME=Administrador
ORDER_PAYMENT_TTL_MINUTES=30
MAX_OPEN_ORDERS_PER_USER=3
```

Em `ALLOWED_ORIGINS`, informe somente a origem, sem caminho e sem barra final. Para vários front-ends:

```text
https://usuario.github.io,https://www.seudominio.com.br
```

O serviço não inicia em produção se `JWT_SECRET` for fraco ou `ALLOWED_ORIGINS` estiver vazio.

## 4. Migre e prepare o banco

No Shell do Render ou em um computador com as mesmas variáveis:

```bash
npm run migrate
npm run seed
npm test
```

Nesta versão, a migração limpa CPFs legados que não são mais usados pelo cadastro, substitui nomes antigos das avaliações por identificações genéricas e atribui prazo às reservas PIX antigas. Pedidos vencidos poderão ser cancelados automaticamente e ter o estoque liberado. Confirme o backup antes de continuar.

A migração também cria índices de apoio aos relatórios administrativos. Ela não recria nem apaga pedidos; os indicadores passam a ser calculados diretamente sobre o histórico existente.

`npm run seed` também:

- redefine a senha do administrador para o valor seguro de `ADMIN_PASSWORD`;
- revoga tokens administrativos antigos;
- restaura campos ausentes quando `site_content` estiver vazio;
- não duplica os produtos de demonstração se já houver produtos.

Para conferir duplicatas:

```bash
npm run cleanup:duplicates
```

O comando acima é somente leitura. Depois do backup e da revisão:

```bash
npm run cleanup:duplicates -- --apply
```

## 5. Configure o front-end

Em `js/apiConfig.js`:

```js
window.API_BASE_URL = 'https://SUA-API.onrender.com';
```

A política de segurança do `index.html` permite APIs em subdomínios `*.onrender.com`. Se usar outro domínio de API, adicione a origem HTTPS ao `connect-src` da meta CSP.

Publique `index.html`, `css/`, `js/` e `img/` no GitHub Pages ou em outro host estático HTTPS. Não publique a pasta `server` junto do front-end se o repositório público não precisar dela; nunca publique `.env`.

## 6. Configure a loja e o PIX

1. Entre como administrador.
2. Abra **Personalizar**.
3. Revise o texto individual de cada banner e as imagens do carrossel.
4. Configure a tarifa de frete, o limite opcional para frete grátis e o prazo estimado.
5. Preencha chave PIX, nome do beneficiário e cidade.
6. Complete razão social, documento, endereço, telefone e e-mail do rodapé.
7. Salve e faça um pedido de teste de valor baixo.
8. Antes de pagar, confira o beneficiário, o frete, o total e o prazo da reserva.
9. Abra **Relatórios**, selecione o mês atual e confira os totais de pedidos pagos, pendentes e cancelados.

Sem uma configuração PIX válida, a API recusa novos pedidos em vez de gerar um QR Code incorreto.

## 7. Checklist antes de divulgar

- [ ] Backup do PostgreSQL realizado.
- [ ] Migração e seed executados sem erro.
- [ ] Testes passaram com `npm test`.
- [ ] Senha administrativa não é a antiga senha de teste.
- [ ] `JWT_SECRET` possui 32 caracteres ou mais.
- [ ] `ALLOWED_ORIGINS` contém apenas os sites autorizados.
- [ ] PIX testado com valor baixo.
- [ ] Produtos duplicados revisados.
- [ ] Estoque conferido.
- [ ] Frete, limite de gratuidade e prazo estimado conferidos.
- [ ] Expiração de pedido PIX devolve o estoque corretamente.
- [ ] Avaliação de teste permanece oculta até a aprovação no painel.
- [ ] Endereço aparece no detalhe administrativo do pedido.
- [ ] Relatórios do mês conferidos com a lista de pedidos pagos.
- [ ] Exportação CSV e impressão/PDF da visão ativa testadas.
- [ ] Links, telefone, e-mail e políticas foram ajustados para os dados reais da loja.
- [ ] O site não anuncia cartão, frete grátis ou cupons sem que essas funções tenham sido implementadas.

Recuperação de senha, confirmação de e-mail e MFA exigem um serviço externo de e-mail/autenticação. Essas funções não devem ser anunciadas até que esse provedor seja configurado.

## 8. Ordem segura de atualização futura

Para próximas versões:

1. backup do banco;
2. publicar código;
3. executar `npm run migrate`;
4. executar testes;
5. validar `/api/health`;
6. realizar um pedido completo de teste.
