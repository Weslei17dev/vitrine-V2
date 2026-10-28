(function(global){
  'use strict';
  async function load(){
    const status=document.getElementById('me-status');
    if(!status)return;
    try{
      const info=await DataService.MelhorEnvio.status();
      status.textContent=`Ambiente: ${info.environment}. ${info.connected?'Conta autorizada.':'Conta ainda não autorizada.'}`;
      const form=document.getElementById('me-sender');
      Object.entries(info.sender||{}).forEach(([key,value])=>{if(form.elements[key])form.elements[key].value=value||'';});
      document.getElementById('me-missing-products').innerHTML=info.missingProducts.length?info.missingProducts.map(p=>`<p>• ${Utils.escapeHtml(p.name)} — <button class="btn btn--outline btn--sm" type="button" data-me-edit="${Utils.escapeHtml(p.id)}">Editar produto</button></p>`).join(''):'Todos os produtos ativos possuem medidas.';
      const products=await DataService.Products.getAll();
      const select=document.querySelector('#me-test-quote select[name="productId"]');
      if(select)select.innerHTML='<option value="">Selecione um produto</option>'+products.map(p=>`<option value="${Utils.escapeHtml(p.id)}">${Utils.escapeHtml(p.name)}</option>`).join('');
    }catch(err){status.textContent=err.message;}
  }
  function init(){
    document.getElementById('me-connect')?.addEventListener('click',async()=>{try{const {url}=await DataService.MelhorEnvio.start();location.assign(url);}catch(err){Utils.showToast(err.message,'error');}});
    document.getElementById('me-sender')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;try{await DataService.MelhorEnvio.sender(Object.fromEntries(new FormData(form)));Utils.showToast('Remetente salvo.','success');load();}catch(err){Utils.showToast(err.message,'error');}});
    document.getElementById('me-test-quote')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,result=document.getElementById('me-test-result');const data=new FormData(form);result.textContent='Consultando o Melhor Envio…';try{
      const quote=await DataService.MelhorEnvio.diagnosticQuote({zip:data.get('zip'),items:[{productId:data.get('productId'),qty:Number(data.get('qty'))}]});
      result.innerHTML=`<ul>${quote.options.map(o=>`<li>${Utils.escapeHtml(o.company)} — ${Utils.escapeHtml(o.service)}: ${Utils.formatCurrency(o.price)}${o.days?` • ${o.days} dias`:''} • ${o.volumes} volume(s)</li>`).join('')}</ul>`;
    }catch(err){result.textContent=err.message||'Não foi possível consultar o frete.';}});
    document.getElementById('me-missing-products')?.addEventListener('click',async event=>{const button=event.target.closest('[data-me-edit]');if(!button)return;document.querySelector('[data-admin-tab="produtos"]')?.click();document.querySelector(`[data-action="edit-product"][data-id="${button.dataset.meEdit}"]`)?.click();});
  }
  global.AdminShippingModule={load};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
