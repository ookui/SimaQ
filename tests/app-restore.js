const saved=(await rpc('bootstrap')).session;
const shown=[...document.querySelectorAll('.tab')].map(t=>t.title);
if(!saved.tabs.length || !saved.tabs.every(t=>shown.includes(t.path)))throw Error('Previous tabs missing on restart');
const active=document.querySelector('.tab[aria-selected="true"]')?.title;
if(active!==saved.active)throw Error('Wrong active tab: '+active);
return {restarted:true,active,shown};
