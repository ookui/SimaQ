/* Sima Qian preferences, command registry and local Markdown templates. No framework. */
(function (global) {
  'use strict';
  const scriptBase = typeof document !== 'undefined' ? new URL('.', document.currentScript?.src || location.href).href : '';
  const defaults = {
    menuLanguage: 'system', appearance: 'system', lightTheme: 'Tana Light', darkTheme: 'Neutral Dark',
    typography: {}, bindings: {}, userCSS: '', autoHideYaml: true,
    attachmentFolder: 'attachments', attachmentPath: 'relative',
    mouseScrollSpeed: 1.5, trackpadScrollSpeed: 1,
  };
  const commandRows = [
    ['app.settings','设置…','应用','Cmd+,'], ['app.palette','命令面板…','应用','Cmd+Shift+P'],
    ['file.openFolder','打开资料库…','文件','Cmd+O'],
    ['file.exclusions','工作区排除目录…','文件',''], ['file.journalFolder','日记目录…','文件',''], ['file.images','Markdown 图片目录…','文件',''], ['file.new','新建笔记','文件','Cmd+N'],
    ['template.create','从模板新建…','文件','Cmd+Shift+N'], ['template.insert','插入模板…','文件',''],
    ['file.save','保存','文件','Cmd+S'], ['file.saveAs','另存为…','文件','Cmd+Shift+S'],
    ['file.closeTab','关闭标签','文件','Cmd+W'], ['file.reopenTab','重新打开关闭的标签','文件','Cmd+Shift+T'],
    ['file.wechatDraft','发布到微信公众号…','文件',''],
    ['file.print','打印…','文件','Cmd+P'], ['file.exportHTML','导出 HTML…','文件',''], ['file.exportPDF','导出 PDF…','文件',''],
    ['edit.undo','撤销','编辑','Cmd+Z'], ['edit.redo','重做','编辑','Cmd+Shift+Z'],
    ['edit.cut','剪切','编辑','Cmd+X'], ['edit.copy','复制','编辑','Cmd+C'], ['edit.paste','粘贴','编辑','Cmd+V'], ['edit.selectAll','全选','编辑','Cmd+A'],
    ['edit.find','查找当前文档','编辑','Cmd+F'], ['search.workspace','搜索资料库','编辑','Cmd+Shift+F'], ['edit.link','插入链接…','编辑','Cmd+K'],
    ...[1,2,3,4,5,6].map(n=>['paragraph.h'+n,'标题 '+n,'段落','Cmd+'+n]),
    ['paragraph.paragraph','正文','段落','Cmd+0'], ['paragraph.quote','引用','段落',''],
    ['paragraph.bullet','无序列表','段落',''], ['paragraph.ordered','有序列表','段落',''], ['paragraph.task','任务列表','段落',''],
    ['paragraph.code','代码块','段落','Cmd+Alt+C'], ['paragraph.math','LaTeX 独立公式','段落',''], ['paragraph.mermaid','Mermaid 图表','段落',''], ['paragraph.toc','目录','段落',''],
    ['format.math','LaTeX 行内公式','格式',''], ['format.bold','加粗','格式','Cmd+B'], ['format.italic','斜体','格式','Cmd+I'], ['format.strike','删除线','格式',''], ['format.highlight','高亮','格式',''], ['format.code','行内代码','格式','Cmd+E'],
    ['table.insert','插入表格…','表格','Cmd+Alt+T'], ['table.rowAbove','在上方插入行','表格',''], ['table.rowBelow','在下方插入行','表格',''],
    ['table.columnLeft','在左侧插入列','表格',''], ['table.columnRight','在右侧插入列','表格',''], ['table.deleteRow','删除行','表格',''], ['table.deleteColumn','删除列','表格',''],
    ['table.moveRowUp','上移一行','表格',''], ['table.moveRowDown','下移一行','表格',''], ['table.moveColumnLeft','左移一列','表格',''], ['table.moveColumnRight','右移一列','表格',''],
    ['table.alignLeft','列左对齐','表格',''], ['table.alignCenter','列居中','表格',''], ['table.alignRight','列右对齐','表格',''],
    ['view.source','切换源码模式','视图','Cmd+/'], ['view.outline','显示大纲','视图','Cmd+Shift+O'], ['view.sidebar','显示侧栏','视图','Cmd+\\'],
    ['view.scrollSpeed','滚动速度…','视图',''],
    ['view.focus','专注模式','视图',''], ['view.typewriter','打字机模式','视图',''], ['view.yaml','折叠／展开元数据','视图','Cmd+Alt+Y'],
    ['navigate.backlinks','查看反向链接','导航',''], ['navigate.repair','修复失效链接…','导航',''],
    ['navigate.back','后退','导航','Cmd+['], ['navigate.forward','前进','导航','Cmd+]'],
    ['theme.tana','Tana 浅色主题','主题',''], ['theme.settings','主题设置…','主题',''], ['theme.light','浅色外观','主题',''], ['theme.dark','深色外观','主题',''], ['theme.system','跟随系统','主题',''],
    ['window.minimize','最小化','窗口','Cmd+M'], ['window.zoom','缩放窗口','窗口',''], ['help.guide','使用说明','帮助',''], ['app.quit','退出 SimaQ','应用','Cmd+Q'],
  ];
  const commands = commandRows.map(([id,label,menu,key])=>({id,label,menu,key,enabled:true}));
  const menuLanguage = global.SimaMenuLanguage || require('./menu-language.js');
  const languages = ['en','zh-Hans','zh-Hant'];
  let systemLanguage = 'en';
  function effectiveLanguage() {
    return languages.includes(settings.menuLanguage) ? settings.menuLanguage : systemLanguage;
  }
  function menuText(text) { return menuLanguage.translate(text,effectiveLanguage()); }
  function localizeCommands() {
    commandRows.forEach(([,label,menu],i)=>{
      commands[i].label = menuText(label);
      commands[i].menu = menuText(menu);
      commands[i].group = menu;
    });
  }
  async function refreshMenuLanguage() {
    const native = await rpc('systemMenuLanguage');
    systemLanguage = languages.includes(native) ? native : 'en';
    localizeCommands();
    await publishMenus();
    document.dispatchEvent(new CustomEvent('sima:menu-language'));
  }
  const builtin = [{name:'Neutral Light',appearance:'light',file:'neutral-light.css'}, {name:'Neutral Dark',appearance:'dark',file:'neutral-dark.css'}, {name:'Tana Light',appearance:'light',file:'tana.css'}, {name:'Tana Dark',appearance:'dark',file:'tanadark.css'}];
  let host, settings = JSON.parse(JSON.stringify(defaults)), themes = [...builtin], dialog, lastFocus, recording = null, timer;
  const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : {matches:false,addEventListener(){}};
  const el = (tag, attrs={}, children=[]) => {
    const node=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)) {
      if(k==='text') node.textContent=v;
      else if(k.startsWith('on')) node.addEventListener(k.slice(2),v);
      else if(k==='class') node.className=v;
      else if(k==='checked') node.checked=v;
      else if(k==='value') node.value=v;
      else node.setAttribute(k,v);
    }
    children.forEach(child=>node.append(child)); return node;
  };
  const rpc = async (method,args={}) => host?.rpc ? host.rpc(method,args) : undefined;
  const notify = message => host?.toast?.(String(message));
  const error = value => notify(value?.message || value || '操作失败');
  function binding(id) { return Object.hasOwn(settings.bindings,id) ? settings.bindings[id] : commands.find(c=>c.id===id)?.key || ''; }
  function combo(event) {
    const keyAliases = {Escape:'Escape', ' ':'Space', ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Backspace:'Backspace',Delete:'Delete',Enter:'Enter',Tab:'Tab'};
    if(['Meta','Shift','Alt','Control','Dead','Process','Unidentified'].includes(event.key)) return '';
    // Use physical punctuation when Option changes the produced character on macOS.
    const codes = {Comma:',',Period:'.',Slash:'/',Backslash:'\\',BracketLeft:'[',BracketRight:']',Minus:'-',Equal:'=',Backquote:'`',Semicolon:';',Quote:"'"};
    let key=keyAliases[event.key] || codes[event.code] || (/^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key.toUpperCase());
    return [event.metaKey?'Cmd':'',event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',key].filter(Boolean).join('+');
  }
  function normalize(value) {
    if(!value) return '';
    const parts=String(value).replaceAll('⌘','Cmd+').replaceAll('⇧','Shift+').replaceAll('⌥','Alt+').replaceAll('⌃','Ctrl+').split('+').filter(Boolean);
    const key=parts.pop(); const mods=new Set(parts.map(p=>({Meta:'Cmd',Command:'Cmd',Option:'Alt',Control:'Ctrl'}[p]||p)));
    return ['Cmd','Ctrl','Alt','Shift'].filter(p=>mods.has(p)).concat(key?.length===1?key.toUpperCase():key || []).join('+');
  }
  function conflicts(bindings=settings.bindings) {
    const seen=new Map(), found=[];
    for(const command of commands) { const key=normalize(Object.hasOwn(bindings,command.id)?bindings[command.id]:command.key); if(!key)continue; if(seen.has(key))found.push([seen.get(key),command.id,key]); else seen.set(key,command.id); }
    return found;
  }
  function enabled(id, ctx) {
    if (id === 'file.wechatDraft') return !!ctx.markdown && !!ctx.hasEditor;
    if (id === 'navigate.back') return !!ctx.canBack;
    if (id === 'navigate.forward') return !!ctx.canForward;
    if (id === 'file.reopenTab') return !!ctx.canReopen;
    if (['file.save','file.saveAs','file.exportHTML','file.exportPDF'].includes(id)) return !!ctx.hasEditor;
    if (/^(paragraph|format|table)\./.test(id) || ['template.insert','edit.link','view.source','view.outline','view.focus','view.typewriter','view.yaml'].includes(id)) return !!ctx.markdown;
    if (['file.closeTab','file.print','edit.find','navigate.backlinks'].includes(id)) return !!ctx.path;
    if (['file.new','file.exclusions','file.journalFolder','template.create','navigate.repair'].includes(id)) return !!ctx.root;
    return true;
  }
  let lastMenu = '';
  async function publishMenus() {
    const ctx = host?.context?.() || {};
    for (const command of commands) command.enabled = enabled(command.id, ctx);
    const snapshot = [];
    for (const c of commands) {
      if (c.group === '主题' && c.id !== 'theme.settings') continue;
      snapshot.push({...c,key:binding(c.id)});
      if (c.id === 'theme.settings') {
        for (const [index, theme] of themes.entries()) {
          snapshot.push({
            id:'theme.select.' + theme.name, label:theme.name, group:c.group, menu:c.menu,
            checked:theme.name === document.documentElement.dataset.theme,
            separatorBefore:index === 0, key:theme.name === 'Tana Light' ? binding('theme.tana') : '',
          });
        }
      }
    }
    const stamp = JSON.stringify(snapshot);
    if (stamp === lastMenu) return;
    lastMenu = stamp;
    try { await rpc('menus',{commands:snapshot,language:effectiveLanguage()}); }
    catch (e) { if (lastMenu === stamp) lastMenu = ''; throw e; }
  }
  async function persist() { try { await rpc('setPrefs',{prefs:settings}); await publishMenus(); } catch(e) {error(e);} }
  function changed() { applyTypography(); clearTimeout(timer); timer=setTimeout(persist,180); }
  function style(id) { let node=document.getElementById(id); if(!node){node=el('style',{id});document.head.append(node);} return node; }
  async function reloadThemes() {
    try { const custom=await rpc('themeList'); themes=[...builtin,...(Array.isArray(custom)?custom.filter(t=>!builtin.some(b=>b.name===t.name)):[])]; await applyTheme(); } catch(e) {error(e);}
  }
  let themeVersion=0, currentTheme='';
  async function applyTheme() {
    const version=++themeVersion;
    const dark=settings.appearance==='dark'||(settings.appearance==='system'&&system.matches);
    const name=dark?settings.darkTheme:settings.lightTheme;
    const theme=themes.find(t=>t.name===name)||builtin[dark?1:0];
    let css=theme.css;
    try {if(css===undefined){if(global.webkit?.messageHandlers)css=await rpc('builtinTheme',{file:theme.file});if(css===undefined||css===null){const response=await fetch(scriptBase+'themes/'+theme.file,{cache:'no-store'});if(!response.ok)throw Error('主题文件不可读取');css=await response.text();}}} catch(e){css=dark?':root{color-scheme:dark;--bg:#202124;--text:#ddd;--surface:#292a2d;--sidebar-bg:#252628;--border:#3e4043;--muted:#989ba3;}':'';}
    if(version!==themeVersion)return;
    if(currentTheme!==css) {style('sima-active-theme').textContent=css||'';currentTheme=css;}
    document.documentElement.dataset.appearance=dark?'dark':'light';
    document.documentElement.dataset.theme=theme.name;
    applyTypography();
    document.dispatchEvent(new CustomEvent('sima:preferences',{detail:settings}));
    await publishMenus();
  }
  const cssNames={fontFamily:'--body-font',fontSize:'--font-size',lineHeight:'--line-height',contentWidth:'--content-width',bodyColor:'--body-color',bodyWeight:'--body-weight',paragraphBefore:'--paragraph-before',paragraphAfter:'--paragraph-after',sidebarFontSize:'--sidebar-font-size',sidebarFont:'--sidebar-font',tableFont:'--table-font',tableFontSize:'--table-font-size',tableColor:'--table-color',tableBackground:'--table-background',tableBorder:'--table-border',tablePadding:'--table-padding',tableHeaderFont:'--table-header-font',tableHeaderSize:'--table-header-size',tableHeaderColor:'--table-header-color',tableHeaderBackground:'--table-header-background',tableHeaderWeight:'--table-header-weight',yamlKey:'--yaml-key',yamlValue:'--yaml-value',yamlComment:'--yaml-comment',linkColor:'--link',selectionColor:'--selection',focusColor:'--focus',searchHit:'--search-hit',searchCurrent:'--search-current',searchRow:'--search-row',countColor:'--count-color',tabFontSize:'--tab-font-size'};
  function applyTypography() {
    const declarations=[];
    for(const [key,value] of Object.entries(settings.typography||{})) {
      const variable=cssNames[key] || (/^h[1-6](Font|Size|Weight|Color|Before|After)$/.test(key)?'--'+key.replace(/([A-Z])/g,'-$1').toLowerCase():null);
      if(variable&&value!==''&&value!==null) declarations.push(variable+':'+String(value).replace(/[;}]/g,'')+';');
    }
    style('sima-user-preferences').textContent=':root{'+declarations.join('')+'}\n'+(settings.userCSS||'');
    document.documentElement.dataset.yamlDefault=settings.autoHideYaml?'collapsed':'expanded';
    // Keep user preferences after the active theme in cascade order.
    document.head.append(document.getElementById('sima-user-preferences'));
    document.dispatchEvent(new CustomEvent('sima:preferences',{detail:settings}));
  }
  async function execute(id,arg) {
    if(id==='app.settings')return open();
    if(id==='file.images')return open('images');
    if(id==='file.exclusions')return open('workspace');
    if(id==='theme.settings')return open('appearance');
    if(id==='theme.tana' || id.startsWith('theme.select.')) {
      const name = id === 'theme.tana' ? 'Tana Light' : id.slice('theme.select.'.length);
      const theme = themes.find(item => item.name === name);
      if (!theme) return;
      const current = settings.appearance === 'system' ? (system.matches ? 'dark' : 'light') : settings.appearance;
      const appearance = theme.appearance || current;
      if (appearance !== current || id === 'theme.tana') settings.appearance = appearance;
      settings[appearance === 'dark' ? 'darkTheme' : 'lightTheme'] = name;
      await applyTheme();
      if (dialog?.querySelector('[data-section="appearance"].active')) appearanceUIRefresh(dialog.querySelector('.sq-settings-main'));
      return persist();
    }
    if(id==='app.palette')return palette();
    if(id==='view.scrollSpeed') { const panel=modal(menuText('滚动速度'));scrollUI(panel);return; }
    if(id==='template.create'||id==='template.insert')return template(id.split('.')[1]);
    if(id.startsWith('theme.')) {settings.appearance=id.slice(6);await applyTheme();return persist();}
    try{return await host?.run?.(id,arg);}catch(e){error(e);throw e;}
  }
  function handleKey(event) {
    if(event.isComposing||event.keyCode===229)return false;
    if(dialog)return false;
    const key=combo(event); const command=commands.find(c=>c.enabled!==false&&binding(c.id)&&normalize(binding(c.id))===normalize(key));
    if(!command)return false;
    // Native edit shortcuts retain the active text input's platform undo and clipboard.
    if(/^(INPUT|TEXTAREA)$/.test(event.target?.tagName)&&['edit.undo','edit.redo','edit.cut','edit.copy','edit.paste','edit.selectAll'].includes(command.id))return false;
    event.preventDefault();execute(command.id).catch?.(()=>{});return true;
  }
  function close() {
    if(!dialog)return;dialog.remove();dialog=null;recording=null;global.SimaShell?.overlay?.(false);lastFocus?.focus?.();
  }
  function modal(title,wide=false) {
    document.dispatchEvent(new Event('sima:modal-opening'));
    close();lastFocus=document.activeElement;global.SimaShell?.overlay?.(true);
    const panel=el('section',{class:'sq-dialog'+(wide?' sq-wide':''),role:'dialog','aria-modal':'true','aria-label':title,tabindex:'-1'});
    const backdrop=el('div',{class:'sq-backdrop',onmousedown:e=>{if(e.target===backdrop)close();}},[panel]);
    panel.append(el('header',{class:'sq-dialog-header'},[el('h2',{text:title}),el('button',{class:'sq-icon-button',text:'×','aria-label':menuText('关闭'),onclick:close})]));
    backdrop.addEventListener('keydown',e=>{
      if(e.isComposing||e.keyCode===229)return;
      if(recording){e.preventDefault();e.stopPropagation();if(e.key==='Escape'){recording=null;return;}const key=combo(e);if(key)recording(key);return;}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
      if(e.key==='Tab'){const focus=[...panel.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);const first=focus[0],last=focus.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    });
    document.body.append(backdrop);dialog=backdrop;panel.focus();return panel;
  }
  function row(label,control,hint) { return el('label',{class:'sq-setting-row'},[el('span',{},[el('span',{text:label}),...(hint?[el('small',{text:hint})]:[])]),control]); }
  function textField(key,placeholder='') {const input=el('input',{type:'text',value:settings.typography[key]||'',placeholder,oninput:()=>{settings.typography[key]=input.value;changed();}});return input;}
  function select(value,options,onchange){const input=el('select',{},options.map(([v,l])=>el('option',{value:v,text:l})));input.value=value;input.onchange=()=>onchange(input.value);return input;}
  function button(text,onclick,primary=false){return el('button',{text,onclick,class:primary?'sq-primary':''});}
  function section(title,fields){return el('section',{class:'sq-section'},[el('h3',{text:title}),...fields]);}
  function open(initial='general') {
    const panel=modal(menuText('设置'),true), layout=el('div',{class:'sq-settings-layout'}), nav=el('nav',{class:'sq-settings-nav','aria-label':menuText('设置分类')}), main=el('div',{class:'sq-settings-main'});
    const tabs=[['general','常规'],['appearance','外观'],['editor','编辑与阅读'],['images','图片目录'],['workspace','工作区'],['shortcuts','快捷键'],['templates','模板'],['help','主题说明']];
    const render=id=>{main.replaceChildren();nav.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.section===id));if(id==='general')generalUI(main);if(id==='appearance')appearanceUI(main);if(id==='editor')editorUI(main);if(id==='images')imagesUI(main);if(id==='workspace')workspaceUI(main).catch(error);if(id==='shortcuts')shortcutsUI(main);if(id==='templates')templatesUI(main);if(id==='help')helpUI(main);};
    tabs.forEach(([id,label])=>nav.append(el('button',{'data-section':id,text:menuText(label),onclick:()=>render(id)})));
    layout.append(nav,main);panel.append(layout);render(tabs.some(t=>t[0]===initial)?initial:'appearance');
  }
  function generalUI(main) {
    const control = select(settings.menuLanguage,[
      ['system',menuText('跟随系统')],['en','English'],['zh-Hans','简体中文'],['zh-Hant','繁體中文']
    ],async value=>{
      const previous = settings.menuLanguage;
      settings.menuLanguage = value;
      try { await rpc('setPrefs',{prefs:settings}); }
      catch(e) { settings.menuLanguage=previous;control.value=previous;error(e);return; }
      await refreshMenuLanguage();
      if (main.isConnected) { open('general');dialog.querySelector('[data-language-picker]').focus(); }
    });
    control.dataset.languagePicker = '';
    main.append(section(menuText('常规'),[row(menuText('菜单语言'),control)]));
    scrollUI(main);
  }
  function scrollUI(main) {
    const choices = [.5,.75,1,1.25,1.5,2,3].map(n=>[String(n), n+'×']);
    const fields = [['mouseScrollSpeed','鼠标滚轮'],['trackpadScrollSpeed','触控板']].map(([key,title])=>{
      const control = select(String(settings[key]), choices, async value=>{
        const previous=settings[key];settings[key]=Number(value);
        try { await rpc('setPrefs',{prefs:settings}); }
        catch(e) { settings[key]=previous;control.value=String(previous);error(e); }
      });
      control.dataset.scrollSpeed=key;
      return row(menuText(title),control);
    });
    main.append(section(menuText('滚动速度'),[
      ...fields, el('p',{class:'sq-hint',text:menuText('立即生效并保存。1× 为系统速度；适用于侧栏、正文与预览。')})
    ]));
  }
  function appearanceUI(main) {
    main.append(section('外观与 CSS 主题',[
      row('外观',select(settings.appearance,[['system','跟随系统'],['light','浅色'],['dark','深色']],async value=>{settings.appearance=value;await applyTheme();persist();})),
      ...[['lightTheme','系统浅色主题'],['darkTheme','系统深色主题']].map(([key,label])=>row(label,select(settings[key],themes.map(t=>[t.name,t.name]),async value=>{settings[key]=value;await applyTheme();persist();}))),
      el('div',{class:'sq-actions'},[button('导入 CSS…',async()=>{try{const result=await rpc('themeImport');await reloadThemes();if(result?.name){settings[settings.appearance==='dark'||settings.appearance==='system'&&system.matches?'darkTheme':'lightTheme']=result.name;await applyTheme();persist();}appearanceUIRefresh(main);}catch(e){error(e);}}),button('打开主题目录',()=>rpc('themeFolder').catch(error)),button('重新载入',async()=>{await reloadThemes();appearanceUIRefresh(main);})]),
      el('p',{class:'sq-hint',text:'主题文件修改后自动更新。浅色与深色可分别选择；用户样式最后应用。'}),
    ]));
    main.append(section('字号与阅读区域',[
      row('正文字体',textField('fontFamily','系统字体')),row('正文字号',textField('fontSize','15px')),row('正文颜色',textField('bodyColor','跟随主题')),row('正文字重',textField('bodyWeight','400')),
      row('正文宽度',textField('contentWidth','900px')),row('行距',textField('lineHeight','1.75')),row('段前间距',textField('paragraphBefore','.72em')),row('段后间距',textField('paragraphAfter','.72em')),
      row('侧栏字体',textField('sidebarFont','系统字体')),row('侧栏字号',textField('sidebarFontSize','13px')),row('标签字号',textField('tabFontSize','12px')),
    ]));
    for(let n=1;n<=6;n++) main.append(section('标题 H'+n,[...['Font','Size','Weight','Color','Before','After'].map((suffix,i)=>row(['字体','字号','字重','颜色','上间距','下间距'][i],textField('h'+n+suffix,'跟随主题')))]));
    main.append(section('表格',[
      ...[['tableFont','表体字体'],['tableFontSize','表体字号'],['tableColor','表体颜色'],['tableBackground','表体底色'],['tableHeaderFont','表头字体'],['tableHeaderSize','表头字号'],['tableHeaderColor','表头颜色'],['tableHeaderBackground','表头底色'],['tableHeaderWeight','表头字重'],['tableBorder','边线颜色'],['tablePadding','单元格内边距']].map(([key,label])=>row(label,textField(key,'跟随主题'))),
    ]));
    main.append(section('元数据、链接与搜索',[
      ...[['yamlKey','YAML 键'],['yamlValue','YAML 值'],['yamlComment','YAML 注释'],['linkColor','链接'],['selectionColor','文本选区'],['focusColor','焦点边框'],['searchHit','普通搜索命中'],['searchCurrent','当前搜索命中'],['searchRow','选中结果行'],['countColor','命中计数']].map(([key,label])=>row(label,textField(key,'跟随主题'))),
    ]));
    const css=el('textarea',{class:'sq-css-editor',spellcheck:'false',value:settings.userCSS,placeholder:':root { --table-font-size: 13px; }',oninput:()=>{settings.userCSS=css.value;changed();}});
    main.append(section('用户 CSS 覆盖',[css,el('div',{class:'sq-actions'},[button('恢复默认外观',async()=>{settings.appearance=defaults.appearance;settings.lightTheme=defaults.lightTheme;settings.darkTheme=defaults.darkTheme;settings.typography={};settings.userCSS='';await applyTheme();persist();appearanceUIRefresh(main);})])]));
  }
  function appearanceUIRefresh(main){main.replaceChildren();appearanceUI(main);}
  function editorUI(main){
    const collapse=el('input',{type:'checkbox',checked:settings.autoHideYaml,onchange:()=>{settings.autoHideYaml=collapse.checked;changed();}});
    main.append(section('编辑与阅读',[row('默认折叠 YAML 元数据',collapse)]));
    main.append(section('写作视图',[el('div',{class:'sq-actions'},['view.source','view.outline','view.focus','view.typewriter','view.yaml'].map(id=>button(commands.find(c=>c.id===id).label,()=>{close();execute(id);}))) ]));
  }
  function imageFolder(note) {
    const parts = note.split('/');
    const filename = parts.pop().replace(/\.[^.]+$/, '');
    const folder = (settings.attachmentFolder || 'attachments').replaceAll('${filename}', () => filename);
    return (settings.attachmentPath === 'root' ? '../'.repeat(parts.length) : '') + folder;
  }
  function imagesUI(main) {
    const field = el('input',{type:'text',value:settings.attachmentFolder,'aria-label':'图片子目录'});
    const base = select(settings.attachmentPath === 'root' ? 'root' : 'relative',
      [['relative','Markdown 文件所在目录'],['root','当前工作区根目录']], () => {});
    const status = el('p',{class:'sq-hint',role:'status'});
    async function save() {
      const raw = field.value.trim();
      const parts = raw.split('/').filter(p => p && p !== '.');
      if (!raw || raw.startsWith('/') || parts.includes('..') || raw.includes('\\')) {
        status.textContent = '请填写相对子目录，如 images。使用 . 表示基准目录本身。'; return;
      }
      const folder = parts.join('/') || '.';
      const prefs = {...settings, attachmentFolder:folder, attachmentPath:base.value};
      try {
        await rpc('setPrefs',{prefs});
        Object.assign(settings,{attachmentFolder:folder,attachmentPath:base.value});
        host.refreshImages(); status.textContent='已保存，已打开笔记的图片已刷新。';
      } catch(e){error(e);}
    }
    main.append(section('Markdown 图片目录',[
      row('基准目录',base),row('图片子目录',field,'例如 images 或 ${filename}.assets，${filename} 代表当前笔记名。'),
      el('p',{class:'sq-hint',text:'粘贴图片时保存到此目录。预览和导出先按 Markdown 中的链接读取，找不到时再到图片目录查找。'}),
      button('保存图片设置',save,true),status
    ]));
  }
  async function workspaceUI(main) {
    const root = host.context().root;
    const list = el('div',{class:'sq-excluded'});
    const add = button('添加子目录…',() => change('addExcludedFolder'));
    main.append(section('排除目录',[el('p',{class:'sq-hint',text:root || '请先打开一个工作区。'}),list,add]));
    add.disabled = !root;
    if (!root) return;
    function draw(paths) {
      list.replaceChildren(...paths.map(path => row(path,button('移除',() => change('removeExcludedFolder',path)))));
      if (!paths.length) list.append(el('p',{class:'sq-hint',text:'当前工作区没有排除目录。'}));
    }
    async function change(method,path) {
      try {draw(await rpc(method,{root,path}));await host.refreshExclusions();}catch(e){error(e);}
    }
    draw(await rpc('excludedFolders'));
  }
  function shortcutsUI(main) {
    const query=el('input',{type:'search',placeholder:'搜索命令名称、ID 或菜单','aria-label':'搜索快捷键'}),status=el('p',{class:'sq-shortcut-status','aria-live':'polite'}),list=el('div',{class:'sq-shortcut-list'});
    const render=()=>{list.replaceChildren();const q=query.value.toLowerCase();commands.filter(c=>(c.label+' '+c.id+' '+c.menu).toLowerCase().includes(q)).forEach(c=>{
      const keyButton=button(binding(c.id)||'录制快捷键',()=>{status.textContent='请按新的快捷键；Esc 取消。';keyButton.textContent='正在录制…';recording=key=>{recording=null;if(!/(Cmd|Ctrl|Alt)\+/.test(key)&&!/^F\d+$/.test(key)){status.textContent='请选择含 ⌘、⌃ 或 ⌥ 的组合，或功能键。';render();return;}const previous=settings.bindings[c.id];settings.bindings[c.id]=normalize(key);const conflict=conflicts();if(conflict.length){if(previous===undefined)delete settings.bindings[c.id];else settings.bindings[c.id]=previous;const other=conflict.find(a=>a.includes(c.id));status.textContent='与“'+commands.find(x=>x.id===(other?.[0]===c.id?other[1]:other?.[0]))?.label+'”冲突。请先清除该命令的绑定。';}else{status.textContent='已保存 '+c.label+'：'+key;persist();}render();};});
      list.append(el('div',{class:'sq-shortcut-row'},[el('span',{},[el('span',{text:c.label}),el('small',{text:c.menu+' · '+c.id})]),keyButton,el('button',{class:'sq-icon-button',text:'×','aria-label':'清除 '+c.label+' 的快捷键',onclick:()=>{settings.bindings[c.id]='';persist();render();}})]));
    });};
    query.oninput=render;
    main.append(section('快捷键',[query,el('div',{class:'sq-actions'},[
      button('恢复默认',()=>{settings.bindings={};persist();status.textContent='已恢复默认快捷键。';render();}),
      button('导入 JSON…',async()=>{try{let result=await rpc('chooseJSON');if(!result)return;if(typeof result==='string')result=JSON.parse(result);if(result.json)result=typeof result.json==='string'?JSON.parse(result.json):result.json;const source=result.bindings||result;if(!source||typeof source!=='object'||Array.isArray(source))throw Error('快捷键文件格式不正确。');const imported={};for(const [id,value] of Object.entries(source)){if(!commands.some(c=>c.id===id))continue;if(typeof value!=='string')throw Error('快捷键应为字符串。');imported[id]=normalize(value);}const conflict=conflicts(imported);if(conflict.length)throw Error('导入文件存在冲突：'+conflict[0][2]);settings.bindings=imported;await persist();status.textContent='已导入快捷键。';render();}catch(e){status.textContent=e.message;}}),
      button('导出 JSON…',()=>rpc('saveJSON',{json:{version:1,bindings:Object.fromEntries(commands.map(c=>[c.id,binding(c.id)]))}}).catch(error)),
    ]),status,list]));render();
  }
  function templatesUI(main){main.append(section('本地 Markdown 模板',[el('p',{class:'sq-hint',text:'模板目录内的 .md 文件可在 Finder 或其他编辑器中修改。支持 {{date}}、{{date:YYYY-MM-DD}}、{{title}}、{{cursor}} 及自定义变量。'}),el('div',{class:'sq-actions'},[button('打开模板目录',()=>rpc('templateFolder').catch(error)),button('从模板新建…',()=>template('create')),button('在光标处插入…',()=>template('insert'))])]));}
  function helpUI(main){main.append(section('CSS 约定',[el('p',{text:'正文根节点为 #write；编辑区保留原文及选区。应用界面使用 #sidebar、#tabBar、.hit-row 及 .sq-* 设置组件。正文与表格的字号彼此独立。'}),el('p',{text:'稳定变量：--bg、--surface、--sidebar-bg、--text、--muted、--border、--accent、--link、--selection、--search-hit、--search-current、--search-row、--font-size、--table-font-size、--sidebar-font-size。完整清单与主题映射见 themes/README.md。'}),el('p',{text:'Tana 两套原始文件保存在 themes/originals。适配版保留正文与搜索配色，使用明确的元数据折叠状态，展开后不会因鼠标离开而隐藏。'}),el('p',{text:'CSS 可修改应用窗口内界面。macOS 原生菜单、系统文件对话框和窗口控制由系统绘制，字体和颜色随系统外观。HTML 报告保留作者样式。'})]));}
  function palette() {
    const panel=modal(menuText('命令面板')),input=el('input',{class:'sq-palette-search',type:'search',placeholder:menuText('输入命令名称…'),'aria-label':menuText('搜索命令')}),list=el('div',{class:'sq-palette-list',role:'listbox','aria-label':menuText('命令')});let selected=0,filtered=[];
    const draw=()=>{const q=input.value.toLowerCase();filtered=commands.filter(c=>c.enabled!==false&&(c.label+' '+c.id+' '+c.menu).toLowerCase().includes(q));selected=Math.min(selected,Math.max(0,filtered.length-1));list.replaceChildren();filtered.forEach((c,i)=>list.append(el('button',{id:'sq-command-'+i,role:'option','aria-selected':i===selected,class:i===selected?'selected':'',onclick:()=>{close();execute(c.id);}},[el('span',{},[el('span',{text:c.label}),el('small',{text:c.menu})]),el('kbd',{text:binding(c.id)})])));if(!filtered.length)list.append(el('p',{class:'sq-hint',text:menuText('没有匹配的命令。')}));input.setAttribute('aria-activedescendant','sq-command-'+selected);};
    input.oninput=()=>{selected=0;draw();};input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:-1)+filtered.length)%Math.max(1,filtered.length);draw();list.querySelector('.selected')?.scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&filtered[selected]){e.preventDefault();const id=filtered[selected].id;close();execute(id);}});
    panel.append(input,list);draw();input.focus();
  }
  function expandTemplate(text,values={},now=new Date()) {
    const local={YYYY:String(now.getFullYear()),MM:String(now.getMonth()+1).padStart(2,'0'),DD:String(now.getDate()).padStart(2,'0'),HH:String(now.getHours()).padStart(2,'0'),mm:String(now.getMinutes()).padStart(2,'0')};
    let cursor=null,output='';const regex=/\{\{\s*([^{}]+?)\s*\}\}/g;let match,last=0;
    while((match=regex.exec(text))){output+=text.slice(last,match.index);const key=match[1].trim();if(key==='cursor'){if(cursor===null)cursor=output.length;}else if(key==='date'||key.startsWith('date:')){output+=(key.slice(5)||'YYYY-MM-DD').replace(/YYYY|MM|DD|HH|mm/g,t=>local[t]);}else output+=values[key]??match[0];last=regex.lastIndex;}output+=text.slice(last);return {text:output,cursor:cursor===null?output.length:cursor};
  }
  async function template(mode='create') {
    let items;try{items=await rpc('templateList');}catch(e){error(e);return;}
    if(!Array.isArray(items))items=[];
    const panel=modal(mode==='insert'?'插入模板':'从模板新建',true), body=el('div',{class:'sq-template-body'}), controls=el('div',{class:'sq-template-controls'}), preview=el('pre',{class:'sq-template-preview',tabindex:'0'}),status=el('p',{class:'sq-shortcut-status','aria-live':'polite'});
    if(!items.length){body.append(el('p',{text:'模板目录中没有 Markdown 文件。请添加 .md 文件后重新打开。'}),button('打开模板目录',()=>rpc('templateFolder').catch(error)));panel.append(body);return;}
    const picker=select(items[0].name,items.map(t=>[t.name,t.name]),()=>drawVariables());const title=el('input',{type:'text',value:'未命名笔记'}),ctx=host?.context?.()||{},base=ctx.path?.includes('/')?ctx.path.slice(0,ctx.path.lastIndexOf('/')):'';
    const directory=el('input',{type:'text',value:base,placeholder:'资料库根目录','aria-label':'目标目录'}),filename=el('input',{type:'text',value:'未命名笔记.md'}),variables=el('div',{});let custom={},active=items[0];
    const values=()=>({title:title.value,...Object.fromEntries(Object.entries(custom).map(([k,input])=>[k,input.value]))});
    const draw=()=>{preview.textContent=expandTemplate(active.text,values()).text;};
    const drawVariables=()=>{active=items.find(t=>t.name===picker.value)||items[0];custom={};variables.replaceChildren();[...new Set([...active.text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m=>m[1].trim()))].filter(k=>!['title','cursor','date'].includes(k)&&!k.startsWith('date:')).forEach(k=>{custom[k]=el('input',{type:'text',placeholder:k,oninput:draw});variables.append(row(k,custom[k]));});draw();};
    title.oninput=()=>{filename.value=(title.value||'未命名笔记').replace(/[\/:]/g,'-')+'.md';draw();};controls.append(row('模板文件',picker),row('标题',title));if(mode!=='insert')controls.append(row('目标目录',directory),row('文件名',filename,'已有同名文件时可在此修改名称。'));controls.append(variables);
    body.append(controls,el('div',{class:'sq-template-preview-wrap'},[el('h3',{text:'内容预览'}),preview]));panel.append(body,status,el('footer',{class:'sq-dialog-footer'},[button('取消',close),button(mode==='insert'?'插入':'新建',async()=>{const result=expandTemplate(active.text,values());try{if(mode==='insert')await host.run('template.insert',result);else{const name=filename.value.trim();if(!name||/[\/:]/.test(name))throw Error('请填写不含路径分隔符的文件名。');const target=directory.value.trim().replace(/\/$/,'');await host.run('template.create',{path:(target?target+'/':'')+name.replace(/(?:\.md)?$/i,'.md'),...result});}close();}catch(e){status.textContent=e.message||String(e);}},true)]));drawVariables();title.focus();title.select();
  }
  async function init(options) {
    host=options;
    try{const saved=await rpc('getPrefs');if(saved&&typeof saved==='object')Object.assign(settings,saved,{typography:{...saved.typography},bindings:{...saved.bindings}});}catch(e){error(e);}
    if (!['system',...languages].includes(settings.menuLanguage)) settings.menuLanguage='system';
    for(const key of ['mouseScrollSpeed','trackpadScrollSpeed']) {
      if(![.5,.75,1,1.25,1.5,2,3].includes(settings[key]))settings[key]=defaults[key];
    }
    await refreshMenuLanguage();await reloadThemes();system.addEventListener('change',()=>{if(settings.appearance==='system')applyTheme();});

    return api;
  }
  const api={init,effectiveLanguage,menuText,refreshMenuLanguage,imageFolder,open,palette,template,commands,binding,handleKey,settings,execute,close,reloadThemes,refreshCommands:publishMenus,expandTemplate,normalizeBinding:normalize,bindingConflicts:conflicts};
  global.SimaSettings=api;
})(typeof window!=='undefined'?window:globalThis);
