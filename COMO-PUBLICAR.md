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

## 6. Configure o PIX

1. Entre como administrador.
2. Abra **Personalizar → Recebimento via PIX**.
3. Preencha chave, nome do beneficiário e cidade.
4. Salve.
5. Faça um pedido de teste de valor baixo.
6. Antes de pagar, confira no banco o beneficiário e o valor.

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
- [ ] Endereço aparece no detalhe administrativo do pedido.
- [ ] Links, telefone, e-mail e políticas foram ajustados para os dados reais da loja.
- [ ] O site não anuncia cartão, frete grátis ou cupons sem que essas funções tenham sido implementadas.

## 8. Ordem segura de atualização futura

Para próximas versões:

1. backup do banco;
2. publicar código;
3. executar `npm run migrate`;
4. executar testes;
5. validar `/api/health`;
6. realizar um pedido completo de teste.
