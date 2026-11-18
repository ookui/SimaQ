const checks=[];
function check(value,message){if(!value)throw Error(message);checks.push(message);}
const previous=JSON.parse(JSON.stringify(await rpc('getPrefs')));
try {
  check(SimaSettings.commands.some(c=>c.id==='view.scrollSpeed' && c.group==='视图'),'Scrolling speed is available in the View menu');
  await SimaSettings.execute('view.scrollSpeed');
  const wheel=document.querySelector('[data-scroll-speed="mouseScrollSpeed"]');
  const pad=document.querySelector('[data-scroll-speed="trackpadScrollSpeed"]');
  check(wheel && pad,'Mouse and trackpad have independent speed controls');
  wheel.value='2';await wheel.onchange();
  pad.value='0.75';await pad.onchange();
  let saved=await rpc('getPrefs');
  check(saved.mouseScrollSpeed===2 && saved.trackpadScrollSpeed===0.75,'Speed changes are persisted immediately');
  SimaSettings.close();
  await SimaSettings.execute('view.scrollSpeed');
  check(document.querySelector('[data-scroll-speed="mouseScrollSpeed"]').value==='2','Reopened speed dialog retains selection');
  const control=document.querySelector('[data-scroll-speed="mouseScrollSpeed"]');
  control.value='1';await control.onchange();
  check((await rpc('getPrefs')).mouseScrollSpeed===1,'System speed can be restored');
  SimaSettings.close();
  SimaSettings.open('general');
  check(document.querySelector('[data-scroll-speed="trackpadScrollSpeed"]').value==='0.75','General settings expose the same saved controls');
  return {checks};
} finally {
  SimaSettings.close();
  await rpc('setPrefs',{prefs:previous});
  SimaSettings.settings.mouseScrollSpeed=previous.mouseScrollSpeed ?? 1.5;
  SimaSettings.settings.trackpadScrollSpeed=previous.trackpadScrollSpeed ?? 1;
}
