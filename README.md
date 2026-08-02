# Brincar de Desejo — Loja Virtual com Login e Painel Administrativo

Sistema completo de loja virtual (sexshop) com **front-end estático** (HTML,
CSS e JavaScript puro, sem frameworks) e uma **API própria em Node.js +
PostgreSQL** por trás — catálogo público (sem necessidade de login para
navegar), carrinho, checkout com QR Code PIX real, área do cliente com
status em tempo real, avaliações de produtos e painel administrativo
completo com personalização visual do site.

👉 **Quer publicar isso no ar (GitHub Pages + Neon)?** Veja o guia completo
passo a passo em [`COMO-PUBLICAR.md`](./COMO-PUBLICAR.md).

## Arquitetura

```
brincar-de-desejo/
├── index.html, css/, js/, img/     ← front-end (publique no GitHub Pages)
└── server/                          ← API + banco (publique no Render, por ex.)
    ├── db/schema.sql                ← estrutura das tabelas
    ├── db/migrate.js                ← cria as tabelas (1 comando)
    ├── db/seed.js                   ← popula admin + dados iniciais (1 comando)
    └── src/                         ← rotas da API (Express)
```

O front-end nunca acessa o banco diretamente — ele conversa só com a API
(`js/dataService.js`, via `fetch`), e a API é quem fala com o Postgres. Isso
é o que torna possível hospedar o site inteiro de graça no GitHub Pages.

## Rodando localmente (para desenvolvimento)

**1. Banco + API:**
```bash
cd server
cp .env.example .env     # edite o .env com sua DATABASE_URL (Neon ou Postgres local)
npm install
npm run setup             # cria as tabelas e os dados iniciais (1 comando só)
npm run dev                # sobe a API em http://localhost:3000
```

**2. Front-end:** edite `js/apiConfig.js` apontando para `http://localhost:3000`,
depois sirva a pasta raiz com qualquer servidor estático:
```bash
python3 -m http.server 8080
# ou: npx serve .
```
Acesse `http://localhost:8080`.

## Configurando sua chave Pix (recebimento real)

O checkout gera um código Pix "Copia e Cola" **real** (padrão do Banco
Central), com QR Code e botão de copiar — o valor de cada pedido cai
direto na sua conta. Diferente de antes, isso **não fica mais em um arquivo
de código**: configure pelo próprio painel admin, aba **Personalizar →
Recebimento via Pix** (chave, nome do beneficiário e cidade).

Depois de preencher, faça um pedido de teste de valor baixo (ex: R$ 1,00) e
pague de verdade pelo app do seu banco antes de divulgar a loja.

**Importante:** a confirmação de pagamento continua **manual** — o site não
tem como saber sozinho que o Pix caiu na conta (isso exigiria integrar um
gateway de pagamento com webhook). Por isso o cliente clica em "Já realizei
o pagamento" e você confirma no painel administrativo (aba Pedidos) depois
de checar o extrato.

## Login de teste

As credenciais de admin agora são definidas no `server/.env` (`ADMIN_EMAIL`
/ `ADMIN_PASSWORD`) e criadas pelo `npm run seed`. Os valores de exemplo em
`.env.example` são:

| Perfil        | E-mail                     | Senha |
|---------------|-----------------------------|-------|
| Administrador | administrador@gmail.com     | 123   |
| Cliente       | crie uma conta na tela de cadastro |

⚠️ Troque `ADMIN_PASSWORD` antes de publicar de verdade — veja o checklist
de segurança em `COMO-PUBLICAR.md`.

## Estrutura do front-end

```
├── index.html              # Marcação de todas as telas e modais (SPA)
├── css/
│   └── style.css           # Todo o design system (tokens, componentes, responsivo)
├── img/                     # Artes da marca (logo, banners, quem somos)
└── js/
    ├── apiConfig.js         # URL da sua API — único ajuste necessário no front-end
    ├── dataService.js      # Camada única de acesso a dados (fala com a API via fetch)
    ├── utils.js             # Helpers: formatação, toasts, modais, som, máscaras
    ├── auth.js               # Login, cadastro e sessão
    ├── products.js          # Catálogo, filtro por categoria, busca, destaques
    ├── productDetail.js    # Página de detalhe: galeria, avaliações, relacionados
    ├── siteContent.js       # Aplica banners/textos/tema personalizados na loja
    ├── cart.js                # Carrinho: adicionar/alterar/remover/limpar (local)
    ├── orders.js             # Checkout, QR Code PIX, detalhe/timeline do pedido
    ├── customerArea.js    # Histórico de pedidos do cliente (tempo real)
    ├── adminPanel.js       # Dashboard, clientes, pedidos, produtos, personalização
    └── app.js                 # Estado global + roteador entre telas + boot
```

Cada módulo se comunica **somente** através de namespaces globais bem
definidos (`window.DataService`, `window.Utils`, `window.App`,
`window.CartModule`, etc.) — nenhum módulo faz `fetch` direto além de
`dataService.js`.

## Estrutura da API (`server/`)

```
server/
├── .env.example          # Modelo de variáveis de ambiente
├── package.json           # npm run migrate / seed / setup / dev / start
├── db/
│   ├── schema.sql         # Estrutura das tabelas (users, products, orders, reviews, site_content)
│   ├── migrate.js         # Roda o schema.sql — cria as tabelas
│   └── seed.js             # Cria o admin + conteúdo padrão + produtos de exemplo
└── src/
    ├── index.js             # Ponto de entrada (Express)
    ├── db.js                 # Pool de conexão com o Postgres
    ├── auth-middleware.js  # Exige login (requireAuth) / exige admin (requireAdmin)
    ├── utils/pixPayload.js # Gera o código Pix real (mesma lógica do BR Code/EMV)
    └── routes/
        ├── auth.js           # Login e cadastro (JWT)
        ├── products.js      # CRUD de produtos (leitura pública, escrita admin)
        ├── orders.js         # Criação e gestão de pedidos
        ├── customers.js     # Lista de clientes (admin)
        ├── siteContent.js  # Conteúdo personalizável (banners, tema, FAQ, Pix)
        └── reviews.js        # Avaliações de produtos
```

Autenticação via **JWT**: o token é gerado no login/cadastro, guardado no
`localStorage` do navegador e enviado em todo pedido autenticado no header
`Authorization: Bearer <token>`. Senhas nunca ficam em texto puro — são
sempre armazenadas com hash (`bcrypt`).

## Funcionalidades implementadas

- Catálogo público: visitante navega, busca e filtra produtos sem precisar logar
- Login obrigatório apenas para adicionar ao carrinho e finalizar o pedido
- Login com dois perfis (administrador + clientes cadastrados), sessão via JWT
- Cadastro de cliente (nome, CPF opcional, telefone, e-mail, senha, endereço, cidade, estado, CEP)
- Carrinho com quantidade, remoção, subtotal, total e limpar
- Checkout com revisão de dados + geração de pedido + QR Code PIX real + "Já realizei o pagamento"
- Área do cliente com histórico, resumo e status atualizado automaticamente (polling)
- Painel administrativo: dashboard, clientes, pedidos (com alteração de status) e produtos (CRUD completo, com foto e galeria)
- **Aba "Personalizar"**: defina o tema de cores, sua chave Pix, e edite banner principal,
  carrossel de banners, oferta relâmpago, quem somos, destaque de produto, FAQ e rodapé —
  tudo sem mexer em código, com upload de imagem e mudanças aparecendo na loja assim que
  ela for exibida de novo
- **Página de detalhe do produto**: clique em qualquer produto (grade, destaques ou
  relacionados) para abrir uma página com galeria de fotos, descrição completa,
  informações adicionais, avaliações/comentários dos clientes (com nota em estrelas) e
  produtos relacionados no final
- Notificação de novo pedido (toast + destaque visual + som) no painel admin
- Estrutura de loja completa: barra de contato, faixa de benefícios, banner principal,
  selos de confiança, oferta relâmpago com contador regressivo e rodapé institucional
- Layout responsivo (sidebar administrativa, menus e grades adaptáveis a celular)

## Próximos passos possíveis

- **Confirmação de pagamento automática**: hoje é manual (ver seção Pix acima). Para
  automatizar, integre um gateway de pagamento (Mercado Pago, Efí, Asaas etc.) nas rotas
  de `server/src/routes/orders.js` e chame o endpoint de status quando o webhook confirmar.
- **E-mail/WhatsApp de notificação**: pontos de extensão nas rotas de pedidos em
  `server/src/routes/orders.js`.
- **Nota fiscal automática**: acionar a emissão quando o status mudar para `"Pago"`.
- **Controle de estoque automático**: decrementar `stock` em `POST /api/orders` e bloquear
  a compra quando chegar a zero.
