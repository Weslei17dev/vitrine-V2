# Integração do Melhor Envio

## Publicação

1. Faça backup do banco e execute `MIGRACAO-MELHOR-ENVIO.sql` uma vez no SQL Editor do Supabase. É reexecutável e mantém medidas de produtos antigos vazias. Para banco novo, `server/db/schema.sql` já inclui as tabelas. A API deve ser publicada **depois** da migração.
2. Crie uma aplicação em [Melhor Envio](https://docs.melhorenvio.com.br/) no sandbox, cadastre o callback exato `https://vitrine-v2.onrender.com/api/melhor-envio/oauth/callback`, conceda os escopos `shipping-calculate cart-read cart-write orders-read shipping-checkout shipping-generate shipping-print shipping-tracking`. Ambiente de produção requer outra aplicação e outra autorização.
3. No serviço Node do Render, defina as variáveis em `server/.env.melhor-envio.example`, além das variáveis atuais de banco/Pix/JWT. Gere `ME_TOKEN_KEY` uma vez com `openssl rand -base64 32`, salve no gerenciador de segredos do Render e mantenha estável. Não reutilize a senha da conta Melhor Envio como client secret. `ME_ENVIRONMENT` habilita a autorização OAuth; mantenha `ME_CHECKOUT_ENABLED=false` até a conta estar conectada e a cotação validada. Só então defina `ME_CHECKOUT_ENABLED=true` para ativar o frete real no checkout.
4. Publique a pasta `server` no Render e os arquivos da raiz no GitHub Pages. Não copie `.env` para a pasta pública. Em **Administração → Frete e etiquetas**, salve remetente e endereço de origem, conecte a conta (OAuth), depois preencha peso/dimensões de todos os produtos ativos listados. A conexão retorna à página da loja; abra o painel novamente.
5. Faça um pedido de teste no **sandbox** com CEP válido, escolha o serviço, altere CEP/quantidade e confira recálculo. Só então crie o envio de um pedido pago de teste, confirme o custo mostrado no painel, gere e imprima a etiqueta. Não use produção para este teste.

## Como funciona

Cada item usa peso em kg e altura, largura, comprimento em cm **já embalado**. A API recebe as quantidades por linha e determina os volumes; a resposta de volumes da cotação é preservada para criação do envio. Não são atribuídas medidas a produtos antigos. Serviços que retornam vários volumes para Correios, J&T, Loggi ou o serviço 27 são omitidos por exigirem etiquetas separadas; Azul Cargo é omitida porque não permite a compra por API neste fluxo. Um CEP ou item alterado invalida a cotação; ela expira em cinco minutos e o backend recota antes de gerar o pedido. O total e o frete cobrados usam produtos/preços do banco e as promoções existentes. Frete grátis via cupom ou limiar da loja subsidia o custo de transporte, registrado à parte.

O painel cria o carrinho, compra frete **somente após marcação da confirmação com custo atual**, gera e imprime a etiqueta. Estados incertos após timeout bloqueiam novas compras automáticas. Se a criação ficar incerta, confira o carrinho no Melhor Envio e vincule o ID já criado pelo formulário de reconciliação; o servidor verifica serviço e identificação do pedido. Se a compra ficar incerta, sincronize e confira a carteira do Melhor Envio antes de qualquer intervenção. O botão de sincronização e o botão de atualização nos próprios pedidos do cliente consultam o endpoint oficial de rastreamento. Status do transporte é independente do pedido e pagamento. Envio comercial exige dados fiscais completos; para LATAM Cargo com remetente PJ, preencha também o CNAE.

## Dependências externas

Sem client ID/client secret, chave de criptografia, autorização OAuth de uma conta de sandbox, remetente real, medidas reais e saldo para comprar etiqueta, não é possível validar chamadas reais ou imprimir etiquetas. Credenciais e tokens ficam somente no backend; tokens são cifrados no banco. Mantenha acesso restrito ao banco e faça rotação coordenada da chave e da autorização.
