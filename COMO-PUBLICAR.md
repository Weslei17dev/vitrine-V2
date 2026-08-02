# Como publicar a Brincar de Desejo (passo a passo)

Este guia assume que você nunca fez isso antes. Siga na ordem — cada parte depende da anterior.

## Visão geral: as 3 peças

```
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│   GitHub Pages       │ ───▶ │   API (Render)        │ ───▶ │   Neon           │
│   (index.html,       │      │   server/ (Node.js)   │      │   (PostgreSQL)   │
│   css/, js/, img/)   │      │                        │      │                  │
└─────────────────────┘      └──────────────────────┘      └─────────────────┘
     seu site                  processa e valida            guarda os dados
                                nunca expõe senhas
```

- **GitHub Pages** só serve os arquivos do site (HTML/CSS/JS). É de graça e é onde as pessoas acessam a loja.
- **API (pasta `server/`)** é um servidor Node.js que fica no meio, conversando com o banco. Vamos publicar ela no **Render** (também tem plano de graça).
- **Neon** é o banco PostgreSQL de verdade, onde ficam os produtos, pedidos, clientes etc.

Você vai mexer em 3 lugares: Neon → Render → GitHub. Bora.

---

## Parte 1 — Criar o banco no Neon

1. Crie uma conta em [neon.tech](https://neon.tech) (dá pra entrar com GitHub).
2. Clique em **"Create a project"**. Dê o nome que quiser (ex: `brincar-de-desejo`). Região: escolha uma perto do Brasil (ex: `us-east` já é a mais próxima disponível no plano free).
3. Quando o projeto for criado, vá em **Dashboard → Connection Details**.
4. Copie a **Connection string**. Ela se parece com isso:
   ```
   postgresql://neondb_owner:SENHA@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
5. Guarde essa string em algum lugar seguro por enquanto — você vai usá-la no Passo 2.

Pronto, o banco existe. As tabelas ainda não — isso é automático no próximo passo.

---

## Parte 2 — Publicar a API no Render

1. Suba a pasta `server/` (o projeto inteiro, na verdade) pro **GitHub**:
   - Crie um repositório novo (pode ser privado).
   - Suba todos os arquivos do zip pra esse repositório (`index.html`, `css/`, `js/`, `img/`, `server/`, etc. — tudo junto, num repo só).
2. Crie uma conta em [render.com](https://render.com) (dá pra entrar com GitHub).
3. Clique em **"New +" → "Web Service"**.
4. Conecte o repositório que você acabou de subir.
5. Configure assim:
   - **Root Directory**: `server`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
6. Antes de clicar em criar, adicione as variáveis de ambiente (seção **"Environment Variables"**) — são os mesmos nomes do arquivo `server/.env.example`:

   | Nome | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do Neon (Parte 1) |
   | `JWT_SECRET` | qualquer frase longa e aleatória (ex: gere uma em [1password.com/password-generator](https://1password.com/password-generator/)) |
   | `ALLOWED_ORIGINS` | `https://SEU-USUARIO.github.io` (o endereço do seu GitHub Pages — veja Parte 3) |
   | `ADMIN_EMAIL` | o e-mail que você quer usar pra entrar como admin |
   | `ADMIN_PASSWORD` | uma senha forte — **troque isso, não deixe `123`** |
   | `ADMIN_NAME` | seu nome ou o nome da loja |

7. Clique em **"Create Web Service"**. O Render vai instalar tudo e subir a API. Isso leva alguns minutos.
8. Quando terminar, você vai ver uma URL tipo `https://brincar-de-desejo-api.onrender.com`. **Guarde essa URL.**

### Criar as tabelas e os dados iniciais (o "um comando" que você pediu)

Depois que o serviço estiver no ar, no painel do Render:

1. Vá na aba **"Shell"** do seu Web Service (fica no menu lateral).
2. Rode este comando único:
   ```bash
   npm run setup
   ```
   Isso cria todas as tabelas (`npm run migrate`) e já popula com a conta de admin, os textos padrão do site e alguns produtos de exemplo (`npm run seed`) — tudo de uma vez.
3. Você vai ver mensagens como `✅ Banco de dados pronto!` e `✅ Conta de administrador criada`.

Pronto — o banco está criado e populado. Não precisa rodar de novo (mas se rodar, não duplica nada).

> **Sem aba "Shell" no seu plano?** Alternativa: rode localmente. Copie `server/.env.example` para `server/.env`, preencha `DATABASE_URL` com a connection string do Neon, e rode `npm install && npm run setup` no seu computador — ele conecta direto no Neon e cria tudo, mesmo sem a API estar rodando.

---

## Parte 3 — Publicar o site no GitHub Pages

1. No mesmo repositório do GitHub (ou em outro, se preferir separar frontend de backend):
2. Edite o arquivo **`js/apiConfig.js`** e troque a URL pela URL da sua API do Render (Parte 2, passo 8):
   ```js
   window.API_BASE_URL = 'https://brincar-de-desejo-api.onrender.com';
   ```
   (sem barra "/" no final)
3. Suba essa alteração pro GitHub (`git add`, `git commit`, `git push`).
4. No GitHub, vá em **Settings → Pages**.
5. Em "Source", selecione a branch `main` (ou `master`) e a pasta `/ (root)`.
6. Salve. Em alguns minutos seu site estará em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.
7. **Volte no Render** e confira se a variável `ALLOWED_ORIGINS` está exatamente com esse endereço (sem a barra final, sem o caminho do repositório — só `https://seu-usuario.github.io`). Se mudar, o serviço reinicia sozinho.

---

## Parte 4 — Testar tudo

Acesse seu link do GitHub Pages e confira, nessa ordem:

1. A loja carrega os produtos (prova que o front-end está falando com a API e com o Neon).
2. Crie uma conta de cliente de teste, adicione um produto ao carrinho e finalize um pedido — confira se aparece um QR Code Pix.
3. Entre como admin (o e-mail/senha que você configurou no Passo 2.6) e veja se o pedido aparece no painel.
4. Na aba **Personalizar**, configure sua **chave Pix real** (seção "Recebimento via Pix") — é ali, não precisa mexer em nenhum arquivo.
5. Faça um pedido de valor baixo (R$ 1,00, por exemplo) e pague de verdade pelo seu banco, só pra confirmar que o dinheiro cai certinho antes de divulgar a loja.

---

## Checklist de segurança antes de divulgar

- [ ] Troquei a senha de admin (não deixei `123`)
- [ ] Configurei um `JWT_SECRET` forte e aleatório (não deixei o texto de exemplo)
- [ ] Configurei minha chave Pix real na aba Personalizar
- [ ] `ALLOWED_ORIGINS` no Render está com o endereço certo do meu GitHub Pages
- [ ] O arquivo `server/.env` (se usei localmente) **não foi** enviado pro GitHub — ele já está no `.gitignore`, mas vale conferir

---

## Perguntas frequentes

**"O Render de graça desliga a API sozinha?"**
Sim — no plano free, se ninguém acessar por 15 minutos, ela "dorme" e demora uns 30-50 segundos pra acordar na próxima visita. Pra loja pequena começando, tudo bem; quando crescer, dá pra migrar pro plano pago (a partir de uns US$ 7/mês) que fica sempre ligado.

**"Posso trocar o Render por outro serviço?"**
Sim, o código roda em qualquer lugar que rode Node.js: Railway, Fly.io, um VPS qualquer. Só muda a forma de configurar as variáveis de ambiente — o `npm run setup` funciona igual em qualquer um.

**"Perdi a senha de admin, e agora?"**
Rode de novo `npm run seed` com `ADMIN_EMAIL` diferente (cria uma segunda conta admin), ou entre direto no Neon (aba "SQL Editor" no painel do Neon) e rode:
```sql
DELETE FROM users WHERE email = 'administrador@gmail.com';
```
depois rode `npm run seed` de novo.

**"Como faço backup dos dados?"**
O Neon já guarda histórico automático (aba "Branches" / "Restore" no painel dele). Pra um backup manual, no SQL Editor do Neon dá pra exportar as tabelas quando quiser.

**"Preciso editar código pra trocar produtos, banners, textos?"**
Não — tudo isso é pelo painel admin (aba "Produtos" e aba "Personalizar"). Só mexe em código mesmo pra configurar a URL da API (`js/apiConfig.js`, uma vez só) e as variáveis de ambiente do Render.
