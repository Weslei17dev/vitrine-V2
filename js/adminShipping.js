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
    }catch(err){status.textContent=err.message;}
  }
  function init(){
    document.getElementById('me-connect')?.addEventListener('click',async()=>{try{const {url}=await DataService.MelhorEnvio.start();location.assign(url);}catch(err){Utils.showToast(err.message,'error');}});
    document.getElementById('me-sender')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;try{await DataService.MelhorEnvio.sender(Object.fromEntries(new FormData(form)));Utils.showToast('Remetente salvo.','success');load();}catch(err){Utils.showToast(err.message,'error');}});
    document.getElementById('me-missing-products')?.addEventListener('click',async event=>{const button=event.target.closest('[data-me-edit]');if(!button)return;document.querySelector('[data-admin-tab="produtos"]')?.click();document.querySelector(`[data-action="edit-product"][data-id="${button.dataset.meEdit}"]`)?.click();});
  }
  global.AdminShippingModule={load};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
