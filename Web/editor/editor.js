/* Markdown stays authoritative. The reading surface and the native text field share UTF-16 offsets. */
(function () {
  'use strict';
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const normalize = value => value.replace(/\r\n?/g, '\n');
  const element = (name, cls) => Object.assign(document.createElement(name), {className:cls});
  const escape = value => value.replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  function rawOffset(raw, index) {
    if (!raw.includes('\r')) return index;
    let at = 0;
    for (let i = 0; i < index && at < raw.length; i++, at++) {
      if (raw[at] === '\r' && raw[at + 1] === '\n') at++;
    }
    return at;
  }
  function difference(before, after) {
    let from = 0, oldEnd = before.length, newEnd = after.length;
    while (from < oldEnd && from < newEnd && before[from] === after[from]) from++;
    while (oldEnd > from && newEnd > from && before[oldEnd-1] === after[newEnd-1]) {oldEnd--; newEnd--;}
    return {from, oldEnd, inserted:after.slice(from, newEnd)};
  }
  function create(host, options = {}) {
    let text = String(options.text ?? ''), source = !!options.literal, yamlCollapsed = options.settings?.yamlCollapsed !== false;
    let focusMode = false, typewriter = false, selection = {anchor:0, head:0};
    let blocks = [], active = null, activeTable = null, field = null, mirror = null;
    let chooser = null;
    let composing = false, destroyed = false, pendingActions = [], pendingScroll = null;
    let tableWidths = [];
    let foldedHeadings = new Set();
    let hits = [], currentHit = null, beforeSelection = null;
    const undo = [], redo = [], pendingAssets = new Set();
    const viewport = element('div','sima-editor cm-editor'), doc = element('article','sima-document');
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-label',options.literal ? options.path : 'Markdown 编辑器');
    doc.setAttribute('aria-label','文稿正文');
    viewport.append(doc);
    host.replaceChildren(viewport);
    const renderOptions = {path:options.path || ''};
    const events = new AbortController();
    function on(target, name, fn, extra = {}) {target.addEventListener(name, fn, {...extra,signal:events.signal});}
    let refreshPreview, previewURL, previewTimer;
    if (options.literal && /\.svg$/i.test(options.path)) {
      const preview=element('details','sima-svg-preview'), summary=document.createElement('summary');
      const picture=document.createElement('img');
      summary.dataset.menuText='SVG 预览';
      summary.textContent=window.SimaSettings.menuText(summary.dataset.menuText);
      picture.alt=options.path;
      preview.append(summary,picture);
      viewport.prepend(preview);
      preview.open=true;
      function updatePicture() {
        if (!preview.open) return;
        const previous=previewURL;
        previewURL=URL.createObjectURL(new Blob([text],{type:'image/svg+xml;charset=utf-8'}));
        picture.src=previewURL;
        if (previous) URL.revokeObjectURL(previous);
      }
      refreshPreview=()=>{
        clearTimeout(previewTimer);
        previewTimer=setTimeout(updatePicture,180);
      };
      on(preview,'toggle',refreshPreview);
    }
    const detachScrollbar = window.SimaScrollbar.attach(viewport);
    const range = () => [Math.min(selection.anchor,selection.head),Math.max(selection.anchor,selection.head)];
    function pick(a,b=a) {selection={anchor:clamp(a,0,text.length),head:clamp(b,0,text.length)};}
    function eol(raw = text) {return raw.match(/\r\n|\n|\r/)?.[0] || '\n';}
    function write(from, to, inserted, after, record=true) {
      if (text.slice(from,to) === inserted) {if(after)pick(after.anchor,after.head);return;}
      if (record) {
        undo.push({from,old:text.slice(from,to),inserted,before:{...(beforeSelection||selection)},after:{...after}});
        if (undo.length>500) undo.shift();
        redo.length=0;
      }
      beforeSelection=null;
      const shift=inserted.length-(to-from);
      for (const p of pendingAssets) {
        const adjust = n => n < from ? n : n >= to ? n + shift : from + inserted.length;
        p.a=adjust(p.a);p.b=adjust(p.b);
      }
      text=text.slice(0,from)+inserted+text.slice(to);
      pick(after.anchor,after.head);
      hits=[];currentHit=null;
      refreshPreview?.();
      mathView?.schedule(120);
      options.onChange?.();
    }
    function readField() {
      if (!field || !active) return;
      const raw=text.slice(active.start,active.end);
      const a=active.start+rawOffset(raw,field.selectionStart), b=active.start+rawOffset(raw,field.selectionEnd);
      if(field.selectionDirection==='backward') pick(b,a); else pick(a,b);
    }
    function readSelection() {
      if (field && document.activeElement===field && !composing) readField();
      else {
        const dom=window.getSelection();
        if(dom && !dom.isCollapsed && doc.contains(dom.anchorNode) && doc.contains(dom.focusNode)) {
          const a=sourcePoint(dom.anchorNode,dom.anchorOffset), b=sourcePoint(dom.focusNode,dom.focusOffset);
          if(a!=null && b!=null)pick(a,b);
        }
      }
    }
    function placeField(focus) {
      if (!field) return;
      const raw=text.slice(active.start,active.end);
      const [a,b]=range().map(n=>normalize(raw.slice(0,clamp(n-active.start,0,raw.length))).length);
      if (focus) field.focus({preventScroll:true});
      field.setSelectionRange(a,b,selection.head<selection.anchor?'backward':'forward');
    }
    function blockAt(n) {
      return blocks.find(b=>n>=b.start && n<=b.end) || blocks.find(b=>b.start>n) || blocks.at(-1);
    }
    let outlineText, outlineItems=[], parsedBlocks=[];
    const mathView=options.literal ? null : window.SimaMath?.preview(doc,parseBlocks);
    function parseBlocks() {
      if (outlineText===text) return parsedBlocks;
      const parsed=window.SimaRender.parse(text);
      parsedBlocks=parsed;
      outlineText=text;
      outlineItems=parsed.filter(b=>b.level).map(b=>({start:b.start,level:b.level,title:b.title}));
      return parsed;
    }
    function unpack() {
      const parsed=parseBlocks();
      let next=0;
      const list=[];
      function blanks(to) {
        while(next<to) {
          const match=/[^\r\n]*/y;match.lastIndex=next;
          const end=next+match.exec(text)[0].length;
          list.push({start:next,end,type:'blank',source:text.slice(next,end)});
          const linebreak=text.slice(end,end+2).match(/^(?:\r\n|\r|\n)/);
          next=end+(linebreak?.[0].length||0);
          if(!linebreak)break;
        }
      }
      for(const b of parsed) {
        if(b.start<next || b.end<b.start) continue;
        blanks(b.start);
        list.push({...b});
        next=b.end+(text.slice(b.end,b.end+2).match(/^(?:\r\n|\r|\n)/)?.[0].length||0);
      }
      blanks(text.length);
      if (!list.length || (/(?:\r|\n)$/.test(text) && list.at(-1).end<text.length)) {
        list.push({start:text.length,end:text.length,type:'blank',source:''});
      }
      return list;
    }
    function stamp(b) {b.node.dataset.start=b.start;b.node.dataset.end=b.end;}
    function paintInput() {
      if (!field || !mirror) return;
      const raw=text.slice(active.start,active.end);
      const intervals=[];
      if (!source) {
        const syntax=/^(?:#{1,6}(?=\s)|[ \t]*[-+*>](?=\s)|[ \t]*\d+[.)](?=\s))|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^\n)]*\)/gm;
        for(const m of raw.matchAll(syntax)) {
          const token=m[0];
          const cls=token.startsWith('**')||token.startsWith('__')?'strong':token.startsWith('~~')?'strike':token.startsWith('==')?'mark':token.startsWith('`')?'code':token.startsWith('[')?'link':token.startsWith('*')&&token.length>1?'em':'punct';
          intervals.push([m.index,m.index+token.length,'sima-token-'+cls]);
        }
      }
      for(const hit of hits) if(hit.start<active.end && hit.start+hit.length>active.start) {
        intervals.push([Math.max(0,hit.start-active.start),Math.min(raw.length,hit.start+hit.length-active.start),sameHit(hit,currentHit)?'md-search-select':'md-search-hit']);
      }
      const cuts=[...new Set([0,raw.length,...intervals.flatMap(([a,b])=>[a,b])])].sort((a,b)=>a-b);
      let html='';
      for(let i=1;i<cuts.length;i++){
        const a=cuts[i-1],b=cuts[i],cls=intervals.filter(([l,r])=>a>=l&&b<=r).map(v=>v[2]).join(' ');
        const content=escape(normalize(raw.slice(a,b)));
        html+=cls?'<span class="'+cls+'">'+content+'</span>':content;
      }
      mirror.innerHTML=html+'<i class="sima-line-end" aria-hidden="true">\u200b</i>';
      if (!source) {
        const line=/^([ \t]*)([-+*]|\d+[.)]|>)([ \t]+)(?:\[([ xX])\]([ \t]+))?/.exec(raw);
        const paragraphStyle=line?(line[2]==='>'?'quote':line[4]!==undefined?'task':/^\d/.test(line[2])?'ordered':'bullet'):'';
        active.node.dataset.paragraphStyle=paragraphStyle;
        const heading=/^(#{1,6})(?:\s|$)/.exec(raw);
        active.node.dataset.heading=heading?heading[1].length:'';
      }
    }
    function sameHit(a,b) {return !!a && !!b && a.start===b.start && a.length===b.length;}
    function fieldBlock(b, focus) {
      active=b;activeTable=null;
      b.node.classList.add('sima-active-block');
      const pair=element('div','sima-text-pair');
      field=element('textarea',source?'sima-source-input cm-content':'sima-block-input cm-content');
      field.rows=1;field.spellcheck=false;field.setAttribute('aria-label',options.literal?options.path:source?'Markdown 源码':'编辑当前段落');
      // A pre would pick up the theme's code font while the native caret uses the field font.
      mirror=element('div','sima-text-mirror');mirror.setAttribute('aria-hidden','true');
      field.value=normalize(text.slice(b.start,b.end));
      pair.append(mirror,field);b.node.append(pair);paintInput();placeField(focus);
    }
    function onTableChange(b,next,meta={},ordinal) {
      const prior=text.slice(b.start,b.end), d=difference(prior,next);
      const position=b.start+d.from+d.inserted.length;
      write(b.start+d.from,b.start+d.oldEnd,d.inserted,{anchor:position,head:position});
      if(meta.widthsBefore && meta.widthsAfter && undo.length){
        undo.at(-1).widths={ordinal,before:[...meta.widthsBefore],after:[...meta.widthsAfter]};
      }
      shiftBlock(b,next.length-prior.length);
    }
    function shiftBlock(b, delta) {
      if(!delta) return;
      b.end+=delta;stamp(b);
      if(source)return;
      for(const other of blocks.slice(blocks.indexOf(b)+1)) {
        other.start+=delta;other.end+=delta;stamp(other);
      }
    }
    function makeBlock(b) {
      const node=element('div','sima-block');b.node=node;
      node.dataset.kind=b.type;
      if (b.documentTitle) node.dataset.documentTitle = '';
      stamp(b);
      return node;
    }
    function yamlButton(b) {
      const button=element('button','sima-yaml-toggle');button.type='button';
      button.textContent=(yamlCollapsed?'▸':'▾')+'  元数据';
      button.setAttribute('aria-expanded',String(!yamlCollapsed));
      button.addEventListener('click',e=>{e.stopPropagation();action('view.yaml');});
      b.node.append(button);
    }
    function applyFolds(target) {
      const parents = [];
      if (target) {
        for (const b of blocks) {
          while (b.level && parents.length && parents.at(-1).level >= b.level) parents.pop();
          if (b === target) {
            for (const parent of parents) foldedHeadings.delete(parent.anchor);
            break;
          }
          if (b.level) parents.push(b);
        }
      }
      let hiddenBelow = 0;
      for (const b of blocks) {
        if (b.level && b.level <= hiddenBelow) hiddenBelow = 0;
        b.node.hidden = !!hiddenBelow;
        if (!b.level) continue;
        const collapsed = foldedHeadings.has(b.anchor);
        const button = b.node.querySelector('.sima-fold');
        if (button) {
          button.textContent = collapsed ? '▸' : '▾';
          button.setAttribute('aria-expanded', String(!collapsed));
          button.setAttribute('aria-label', (collapsed ? '展开' : '折叠') + '章节 ' + b.anchor);
        }
        if (collapsed && !hiddenBelow) hiddenBelow = b.level;
      }
    }
    function drawBlock(b) {
      if (b.level) {
        const button = element('button','sima-fold');
        button.type = 'button';
        button.onclick = e => {
          e.stopPropagation();
          if (composing) return;
          if (foldedHeadings.has(b.anchor)) foldedHeadings.delete(b.anchor);
          else foldedHeadings.add(b.anchor);
          pick(b.start);
          draw(false);
          blockAt(b.start)?.node.querySelector('.sima-fold')?.focus({preventScroll:true});
          options.onViewChange?.();
        };
        b.node.append(button);
      }
      const raw=text.slice(b.start,b.end);
      if (b.type==='yaml') {yamlButton(b);if(yamlCollapsed)return;}
      if (b.type==='blank')return;
      if(b.type==='table' && window.SimaTables?.parse(raw)) {
        const ordinal=blocks.filter(item=>item.type==='table' && item.start<b.start).length;
        b.table=window.SimaTables.mount(b.node,raw,{
          widths:tableWidths[ordinal],onWidthsChange:widths=>{tableWidths[ordinal]=widths;},
          change:(next,meta)=>onTableChange(b,next,meta,ordinal),
          renderInline:window.SimaRender.inline ? s=>window.SimaRender.inline(s,{...b.context,...renderOptions}):undefined,
          selection:(a,z)=>{activeTable=b;pick(b.start+a,b.start+z);},
          activate:()=>{activeTable=b;if(active && !source && active!==b)finishBlock();},
          openLink:(s,o)=>options.onLink?.(s,o),
          exit:direction=>{const other=blocks[blocks.indexOf(b)+direction];if(other)choose(direction<0?other.end:other.start);},
        });
      } else b.node.insertAdjacentHTML('beforeend',window.SimaRender.renderBlock({...b,source:raw}, renderOptions));
    }
    function finishBlock() {
      // Only replace the text field leaving focus. Other live controls retain their DOM.
      const prev=active;if(!prev)return;
      active=null;field=null;mirror=null;
      const freshly=unpack().filter(b=>b.start>=prev.start && b.end<=prev.end);
      if(!freshly.length)return;
      const index=blocks.indexOf(prev);
      const fragment=document.createDocumentFragment();
      for(const b of freshly){fragment.append(makeBlock(b));drawBlock(b);}
      prev.node.replaceWith(fragment);blocks.splice(index,1,...freshly);mathView?.schedule();applyFolds();options.onOutlineChange?.();
    }
    function draw(edit, focus=false, preferTable=true) {
      options.onOutlineChange?.();
      for(const b of blocks)b.table?.destroy();
      mathView?.schedule();
      active=null;activeTable=null;field=null;mirror=null;doc.replaceChildren();
      viewport.classList.toggle('sima-source',source);
      viewport.classList.toggle('sima-focus-mode',focusMode);
      viewport.classList.toggle('sima-typewriter',typewriter);
      if (source) {
        const b={type:'source',start:0,end:text.length};
        blocks=[b];doc.append(makeBlock(b));fieldBlock(b,focus);return;
      }
      blocks=unpack();
      const desired={...selection};
      const [lo,hi]=range(), start=edit?blockAt(lo):null, end=edit?blockAt(hi):null;
      if(start && end && start!==end) {
        const first=blocks.indexOf(start),last=blocks.indexOf(end);
        blocks.splice(first,last-first+1,{start:start.start,end:end.end,type:'selection'});
      }
      const target=edit?blockAt(lo):null;
      const fragment=document.createDocumentFragment();
      for(const b of blocks) {
        fragment.append(makeBlock(b));
        if(b===target && (b.type!=='table'||!preferTable)) {
          if(b.type==='yaml'){yamlCollapsed=false;yamlButton(b);}
          fieldBlock(b,false);
        } else drawBlock(b);
      }
      doc.append(fragment);
      applyFolds(target);
      if(target?.table && focus) {
        const inside=target.table.focusAt(desired.anchor-target.start,desired.head-target.start);
        if(!inside) {pick(desired.anchor,desired.head);draw(true,focus,false);return;}
      } else if(field)placeField(focus);
      highlightRendered();
    }
    function choose(a,b=a,focus=true,preferTable=true) {
      pick(a,b);
      if(field && active && Math.min(a,b)>=active.start && Math.max(a,b)<=active.end && !activeTable) {
        placeField(focus);return;
      }
      draw(true,focus,preferTable);
    }
    function inputChange() {
      if(!field || !active || composing)return;
      const raw=text.slice(active.start,active.end), before=normalize(raw);
      const d=difference(before,field.value);
      if(d.from===d.oldEnd && !d.inserted){readField();return;}
      const l=rawOffset(raw,d.from),r=rawOffset(raw,d.oldEnd),ins=d.inserted.replace(/\n/g,eol(raw.includes('\n')?raw:text));
      const next=raw.slice(0,l)+ins+raw.slice(r);
      let a=active.start+rawOffset(next,field.selectionStart),b=active.start+rawOffset(next,field.selectionEnd);
      if(field.selectionDirection==='backward')[a,b]=[b,a];
      write(active.start+l,active.start+r,ins,{anchor:a,head:b});
      shiftBlock(active,next.length-raw.length);paintInput();
      if(!source && (d.inserted.includes('\n') || before.slice(d.from,d.oldEnd).includes('\n'))) {
        const parsed=unpack(), focusBlock=parsed.find(v=>selection.head>=v.start&&selection.head<=v.end);
        if(focusBlock && (focusBlock.start!==active.start || focusBlock.end!==active.end || focusBlock.type==='table')) draw(true,true);
      }
      if(typewriter)reveal('center');
    }
    function sourcePoint(node, offset) {
      const el=node?.nodeType===1?node:node?.parentElement;
      const wrapper=el?.closest('.sima-block');
      if(!wrapper || !doc.contains(wrapper))return null;
      const b=blocks.find(x=>x.node===wrapper);
      if(!b)return null;
      if(el.closest('textarea'))return b.start;
      const mapped=mapNodes(b);
      const found=mapped.find(x=>x.node===node);
      if(found)return b.start+found.positions[clamp(offset,0,found.positions.length-1)];
      if(node.nodeType===1){
        const children=node.childNodes;
        for(let i=offset;i<children.length;i++){
          const next=mapped.find(x=>children[i].contains(x.node));
          if(next)return b.start+next.positions[0];
        }
        for(let i=offset-1;i>=0;i--){
          const previous=mapped.findLast(x=>children[i].contains(x.node));
          if(previous)return b.start+previous.positions.at(-1);
        }
      }
      return offset?b.end:b.start;
    }
    // Build source positions only on demand. Markdown punctuation and link targets have no visible glyph.
    function mapNodes(b) {
      const raw=text.slice(b.start,b.end), result=[];
      let cursor=0;
      const walker=document.createTreeWalker(b.node,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const node=walker.currentNode, parent=node.parentElement;
        if(parent.closest('button,textarea,.sima-text-mirror,.sima-table-toolbar,svg,math'))continue;
        const str=node.data;
        // Markdown-it inserts formatting newlines between block elements.
        // Mapping those to source offsets skips the first row or list item.
        if (!str.trim() && parent.matches('.sima-block,ul,ol,li,blockquote,table,thead,tbody,tr') && str.includes('\n')) continue;
        if(!str || str==='\u200b')continue;
        let begin=raw.indexOf(str,cursor), positions=[];
        if(begin>=0) {
          for(let i=0;i<=str.length;i++)positions.push(begin+i);
        } else {
          let at=cursor;
          for(let i=0;i<str.length;i++){const k=raw.indexOf(str[i],at);if(k<0){positions=[];break;}positions.push(k);at=k+1;}
          if(positions.length)positions.push(at);
        }
        if(positions.length){result.push({node,positions});cursor=positions.at(-1);}
        if(parent.tagName==='A' && !node.nextSibling && raw.startsWith('](',cursor)){
          const end=raw.indexOf(')',cursor+2);if(end>=0)cursor=end+1;
        }
      }
      return result;
    }
    function highlightRendered() {
      for(const mark of doc.querySelectorAll('mark[data-editor-hit]'))mark.replaceWith(...mark.childNodes);
      if(!hits.length || source)return;
      for(const b of blocks) {
        if(b===active)continue;
        const local=hits.filter(h=>h.start<b.end && h.start+h.length>b.start);
        if(!local.length)continue;
        for(const {node,positions} of mapNodes(b)){
          const matches=[];
          for(const h of local){
            const a=positions.findIndex(x=>x+b.start>=h.start),z=positions.findIndex(x=>x+b.start>=h.start+h.length);
            const l=Math.max(0,a),r=z===-1?node.length:z;
            if(a!==-1 && l<r) matches.push({l,r,h});
          }
          if(!matches.length)continue;
          const fragment=document.createDocumentFragment();let end=0;
          for(const {l,r,h} of matches.sort((a,b)=>a.l-b.l)){
            if(l<end)continue;
            fragment.append(node.data.slice(end,l));const mark=element('mark',sameHit(h,currentHit)?'md-search-select':'md-search-hit');
            mark.dataset.editorHit='';mark.textContent=node.data.slice(l,r);fragment.append(mark);end=r;
          }
          fragment.append(node.data.slice(end));node.replaceWith(fragment);
        }
      }
    }
    function caretRect(position) {
      if(!field || !mirror || position<active.start || position>active.end)return null;
      const target=normalize(text.slice(active.start,position)).length;
      const walker=document.createTreeWalker(mirror,NodeFilter.SHOW_TEXT);
      let remain=target, rect;
      while(walker.nextNode()) {
        const node=walker.currentNode;
        if(remain<=node.length){
          const r=document.createRange();r.setStart(node,remain);r.collapse(true);rect=r.getBoundingClientRect();break;
        }
        remain-=node.length;
      }
      return rect;
    }
    function viewportAnchor() {
      const top=viewport.getBoundingClientRect().top;
      const block=blocks.find(b=>b.node.getBoundingClientRect().bottom>top) || blocks.at(-1);
      if(!block)return null;
      if(block!==active || !mirror)return {at:block.start,dy:block.node.getBoundingClientRect().top-top};
      let lo=block.start,hi=block.end;
      while(lo<hi){
        const m=Math.floor((lo+hi)/2),r=caretRect(m);
        if(r && r.bottom<=top)lo=m+1;else hi=m;
      }
      const r=caretRect(lo);
      return {at:lo,dy:(r?.top??block.node.getBoundingClientRect().top)-top};
    }
    function restoreAnchor(anchor) {
      if(!anchor)return;
      const rect=caretRect(anchor.at)||blockAt(anchor.at)?.node.getBoundingClientRect();
      if(rect)viewport.scrollTop+=rect.top-viewport.getBoundingClientRect().top-anchor.dy;
    }
    function reveal(align='nearest') {
      const rect=caretRect(selection.head);
      if(!rect?.height){blockAt(selection.head)?.node.scrollIntoView({block:align});return;}
      const view=viewport.getBoundingClientRect();
      if(align==='center')viewport.scrollTop+=rect.top-view.top-(view.height-rect.height)/2;
      else if(rect.top<view.top+12)viewport.scrollTop+=rect.top-view.top-12;
      else if(rect.bottom>view.bottom-12)viewport.scrollTop+=rect.bottom-view.bottom+12;
    }
    function replace(from,to,value,cursor=value.length,end=cursor) {
      const next=value.replace(/\r\n|\r|\n/g,eol());
      const convert=n=>value.slice(0,n).replace(/\r\n|\r|\n/g,eol()).length;
      write(from,to,next,{anchor:from+convert(cursor),head:from+convert(end)});
      draw(true,true);reveal(typewriter?'center':'nearest');
    }
    function history(reverse) {
      beforeSelection=null;
      const src=reverse?redo:undo,dest=reverse?undo:redo,entry=src.pop();
      if(!entry)return false;
      const gone=reverse?entry.old:entry.inserted, ins=reverse?entry.inserted:entry.old;
      write(entry.from,entry.from+gone.length,ins,reverse?entry.after:entry.before,false);
      if(entry.widths)tableWidths[entry.widths.ordinal]=entry.widths[reverse?'after':'before'];
      dest.push(entry);draw(true,true);reveal();return true;
    }
    function focus() {
      if(composing || host.contains(document.activeElement) && document.activeElement.tagName==='TEXTAREA')return;
      readSelection();
      if(activeTable?.table && selection.anchor===selection.head)activeTable.table.focusAt?.(selection.head-activeTable.start);
      else {
        const first=blockAt(selection.head);
        if(first?.type==='yaml' && yamlCollapsed && selection.anchor===selection.head){
          const body=blocks.find(b=>b.start>first.end && b.type!=='blank');
          if(body){choose(body.start);return;}
        }
        choose(selection.anchor,selection.head);
      }
    }
    function locate(start,length=0) {
      const a=clamp(Math.trunc(start)||0,0,text.length),b=clamp(a+(Math.trunc(length)||0),0,text.length);
      if(b>a) {currentHit={start:a,length:b-a};if(!hits.some(h=>sameHit(h,currentHit)))hits=[currentHit];}
      choose(a,b,true,true);
      paintInput();highlightRendered();reveal('center');
    }
    function showSearchResult(ranges,hit) {
      if (composing) { pendingActions.push(()=>showSearchResult(ranges,hit)); return; }
      if (source) {
        if (hit) locate(hit.start,hit.length);
        setHighlights(ranges,hit);
        return;
      }
      if (hit) pick(hit.start,hit.start+hit.length);
      // A search jump is a reading action. Finish any active edit before
      // resolving the hit against rendered text, including long list items.
      if (active || activeTable || doc.querySelector('.editing')) draw(false);
      const target=hit && blockAt(selection.anchor);
      if (target?.type==='yaml' && yamlCollapsed) {
        yamlCollapsed=false;
        target.node.replaceChildren();
        drawBlock(target);
      }
      if (target) { applyFolds(target);options.onOutlineChange?.(); }
      setHighlights(ranges,hit);
      if (target) {
        const mark=target.node.querySelector('mark.md-search-select');
        (mark || target.node).scrollIntoView({block:'center'});
      }
    }
    function outline() {
      if (outlineText!==text) parseBlocks();
      return outlineItems;
    }
    function centeredHeading(items) {
      const center=viewport.getBoundingClientRect().top+viewport.clientHeight/2;
      let lo=0,hi=items.length;
      while(lo<hi) {
        const mid=(lo+hi)>>>1;
        const item=items[mid];
        const rect=item.node ? item.node.getBoundingClientRect() : caretRect(item.start);
        if(rect && rect.top<=center) lo=mid+1; else hi=mid;
      }
      return items[Math.max(0,lo-1)]?.start;
    }
    function outlineLocations() {
      const items=outline();
      if(source) return items;
      const nodes=new Map(blocks.map(b=>[b.start,b.node]));
      return items.flatMap(h=>{
        const block=nodes.get(h.start);
        if (active?.type==='selection' && h.start>=active.start && h.start<=active.end) return [h];
        if (!block) return [];
        const heading=block.querySelector('h1,h2,h3,h4,h5,h6');
        return [{...h,title:heading?.textContent || h.title,node:heading || block,hidden:block.hidden}];
      });
    }
    function goToHeading(start) {
      if(composing) { pendingActions.push(()=>goToHeading(start)); return; }
      if(source) { pick(start);placeField(true);reveal('center');return; }
      pick(start);
      if(active || activeTable || doc.querySelector('.editing')) draw(false);
      const target=blockAt(start);
      if(target) {
        applyFolds(target);
        const heading=target.node.querySelector('h1,h2,h3,h4,h5,h6');
        (heading || target.node).scrollIntoView({block:'center'});
      }
      options.onOutlineChange?.();
    }
    function setHighlights(ranges,current) {
      hits=(Array.isArray(ranges)?ranges:[]).filter(h=>Number.isFinite(h.start)&&h.length>0);
      currentHit=typeof current==='number'?hits[current]:current || hits.find(h=>sameHit(h,currentHit));
      paintInput();highlightRendered();
    }
    function chooseTableSize() {
      if(chooser){chooser.querySelector('input').focus();return;}
      chooser=element('dialog','sima-table-size');
      chooser.setAttribute('aria-label','插入表格');
      const form=element('form','sima-size-form');
      const title=element('h3','');title.textContent='插入表格';form.append(title);
      const inputs=['行数（含表头）','列数'].map(label=>{
        const wrap=element('label',''),input=element('input','');wrap.append(label);
        input.type='number';input.min='1';input.max='100';input.required=true;input.value='3';
        wrap.append(input);form.append(wrap);return input;
      });
      const footer=element('div','sima-size-actions'),cancel=element('button',''),insert=element('button','sima-primary');
      cancel.type='button';cancel.textContent='取消';insert.type='submit';insert.textContent='插入';
      footer.append(cancel,insert);form.append(footer);chooser.append(form);host.append(chooser);
      const close=()=>{chooser.close();chooser.remove();chooser=null;};
      cancel.onclick=()=>{close();focus();};
      chooser.addEventListener('cancel',e=>{e.preventDefault();close();focus();});
      chooser.addEventListener('keydown',e=>e.stopPropagation());
      form.onsubmit=e=>{e.preventDefault();const [rows,columns]=inputs.map(i=>i.valueAsNumber);close();selectedAction('table.insert',{rows,columns});};
      chooser.showModal();inputs[0].select();
    }
    function selectedAction(id,arg) {
      const [from,to]=range(), value=text.slice(from,to);
      if(id==='insertText') {
        const inserted=typeof arg==='object'?String(arg?.text??''):String(arg??'');
        replace(from,to,inserted,clamp(arg?.cursor??inserted.length,0,inserted.length));return true;
      }
      const tokens={math:'$',bold:'**',italic:'*',strike:'~~',highlight:'==',code:'`'};
      if(id.startsWith('format.') && tokens[id.slice(7)]) {
        const t=tokens[id.slice(7)];
        if(value.startsWith(t) && value.endsWith(t) && value.length>=2*t.length) {
          const inner=value.slice(t.length,-t.length);replace(from,to,inner,0,inner.length);
        } else if(text.slice(from-t.length,from)===t && text.slice(to,to+t.length)===t)replace(from-t.length,to+t.length,value,0,value.length);
        else replace(from,to,t+value+t,t.length,t.length+value.length);return true;
      }
      const br=eol();
      if(id==='table.insert') {
        if(!arg){chooseTableSize();return true;}
        const raw=window.SimaTables.create(arg?.rows||3,arg?.columns||3);
        const prefix=from && !text.slice(0,from).endsWith(br+br)?(text.slice(0,from).endsWith(br)?br:br+br):'';
        const suffix=to<text.length && !text.slice(to).startsWith(br+br)?(text.slice(to).startsWith(br)?br:br+br):'';
        replace(from,to,prefix+raw+suffix,prefix.length+2);return true;
      }
      if(id.startsWith('table.'))return activeTable?.table?.action(id,arg) || false;
      if(!id.startsWith('paragraph.'))return false;
      const kind=id.slice(10);
      if(kind==='toc') {replace(from,to,'[TOC]');return true;}
      const wrappers={code:['```','```'],math:['$$','$$'],mermaid:['```mermaid','```']};
      if(wrappers[kind]){
        const [open,close]=wrappers[kind],content=value||(kind==='mermaid'?'flowchart TD\n  A --> B':'');
        const before = kind==='math' && from && !/[\r\n]/.test(text[from-1]) ? br : '';
        const after = kind==='math' && to<text.length && !/[\r\n]/.test(text[to]) ? br : '';
        const pos = before.length+open.length+br.length;
        replace(from,to,before+open+br+content+br+close+after,pos,pos+content.length);return true;
      }
      const prefixes={paragraph:'',quote:'> ',bullet:'- ',ordered:'1. ',task:'- [ ] '};
      const prefix=/^h[1-6]$/.test(kind)?'#'.repeat(+kind[1])+' ':prefixes[kind];
      if(prefix===undefined)return false;
      const start=from===0?0:Math.max(text.lastIndexOf('\n',from-1),text.lastIndexOf('\r',from-1))+1;
      const last=Math.max(from,to-1), tail=text.slice(last).search(/[\r\n]/);
      const end=tail<0?text.length:last+tail;
      const line=text.slice(start,end), converted=line.replace(/^([ \t]*)(?:#{1,6}[ \t]+|>[ \t]*|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/gm,(_,indent)=>indent+prefix);
      const at=clamp(from-start+converted.length-line.length,0,converted.length);
      if(from===to)replace(start,end,converted,at);else replace(start,end,converted,0,converted.length);
      return true;
    }
    function action(id,arg) {
      if(composing){pendingActions.push(()=>action(id,arg));return;}
      readSelection();
      if(id==='edit.undo'||id==='edit.redo')return history(id==='edit.redo');
      if(options.literal && !['edit.selectAll','edit.copy','edit.cut','edit.paste','insertText'].includes(id))return false;
      if(id==='view.source') {
        const reading=viewportAnchor();source=!source;draw(true,true);restoreAnchor(reading);return true;
      }
      if(id==='view.yaml'){
        yamlCollapsed=!yamlCollapsed;
        if(!source) {
          const y=blocks.find(b=>b.type==='yaml');
          if(y) {
            if(y===active && yamlCollapsed){active=null;field=null;mirror=null;}
            if(y!==active){y.node.replaceChildren();drawBlock(y);}
          }
        }
        return true;
      }
      if(id==='view.focus'||id==='view.typewriter'){
        if(id==='view.focus')focusMode=!focusMode;else typewriter=!typewriter;
        viewport.classList.toggle('sima-focus-mode',focusMode);viewport.classList.toggle('sima-typewriter',typewriter);
        if(typewriter)reveal('center');return true;
      }
      if(id==='edit.selectAll'){pick(0,text.length);draw(true,true,false);return true;}
      if(id==='edit.copy'||id==='edit.cut'||id==='edit.paste'){
        focus();return document.execCommand(id.slice(5));
      }
      return selectedAction(id,arg);
    }
    function syncVisible() {
      if(!host.hidden && host.isConnected){
        for(const other of document.querySelectorAll('.sima-document#write'))if(other!==doc)other.removeAttribute('id');
        doc.id='write';
        if(pendingScroll!==null){viewport.scrollTop=pendingScroll;pendingScroll=null;}
      } else doc.removeAttribute('id');
    }
    const visibility=new MutationObserver(syncVisible);visibility.observe(host,{attributes:true,attributeFilter:['hidden']});
    function getState() {
      readSelection();
      return {selection:{...selection},reading:!active && !activeTable,source,yamlCollapsed,focusMode,typewriter,foldedHeadings:[...foldedHeadings],tableWidths:tableWidths.map(w=>w&&[...w]),scrollTop:pendingScroll??viewport.scrollTop};
    }
    function setState(state={}) {
      foldedHeadings = new Set(Array.isArray(state.foldedHeadings) ? state.foldedHeadings : []);
      tableWidths=Array.isArray(state.tableWidths)?state.tableWidths.map(w=>Array.isArray(w)?w.slice():[]):[];
      source=!!options.literal || !!state.source;yamlCollapsed=state.yamlCollapsed??yamlCollapsed;focusMode=!!state.focusMode;typewriter=!!state.typewriter;
      const s=state.selection?.ranges?.[0] || state.selection || {};
      pick(s.anchor??s.from??0,s.head??s.to??s.anchor??0);
      const parsed=source ? [] : unpack();
      const isYaml=parsed.find(b=>b.type==='yaml' && selection.head>=b.start && selection.head<=b.end);
      const foldedTitle = parsed.some(b=>b.start === selection.head && foldedHeadings.has(b.anchor));
      const edit=source || !state.reading && !!(selection.anchor || selection.head) && !(isYaml && yamlCollapsed) && !foldedTitle;
      draw(edit,false);
      pendingScroll=Number(state.scrollTop)||0;syncVisible();
    }
    function setText(next) {
      text=String(next??'');undo.length=redo.length=0;hits=[];currentHit=null;
      pick(selection.anchor,selection.head);draw(false,false);refreshPreview?.();
    }
    function hitPoint(x,y) {
      const r=document.caretRangeFromPoint?.(x,y);
      if(r)return sourcePoint(r.startContainer,r.startOffset);
      const p=document.caretPositionFromPoint?.(x,y);
      return p?sourcePoint(p.offsetNode,p.offset):null;
    }
    // WebKit returns the nearest caret even for a click in the margin or
    // well beyond a line's last glyph. Only actual text should activate it.
    function searchWhitespace(e) {
      if ((!hits.length && !options.isSearchActive?.()) || source || !text.length || e.button !== 0) return false;
      const target=e.target;
      if (target===viewport || target===doc) return true;
      if (!doc.contains(target) || target.closest('textarea,button,a,input,summary,.sima-text-pair,.sima-table-block')) return false;
      const block=target.closest('.sima-block');
      if (!block) return false;
      if (block.dataset.kind==='blank') return true;
      if (target.closest('img,svg,math,pre,hr')) return false;
      const caret=document.caretRangeFromPoint?.(e.clientX,e.clientY);
      const pos=caret ? null : document.caretPositionFromPoint?.(e.clientX,e.clientY);
      const node=caret?.startContainer ?? pos?.offsetNode;
      if (!node) return target===block;
      if (node.nodeType!==Node.TEXT_NODE || !block.contains(node)) return true;
      const offset=caret?.startOffset ?? pos.offset, around=document.createRange();
      around.setStart(node,Math.max(0,offset-1));
      around.setEnd(node,Math.min(node.length,offset+1));
      return !Array.from(around.getClientRects()).some(r=>
        e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom);
    }
    on(viewport,'mousedown',e=>{
      // Let the scrollbar perform its native drag and track clicks.
      if (e.target===viewport) {
        const rect=viewport.getBoundingClientRect();
        if (e.clientX>=rect.left+viewport.clientLeft+viewport.clientWidth ||
            e.clientY>=rect.top+viewport.clientTop+viewport.clientHeight) return;
      }
      if (searchWhitespace(e)) e.preventDefault();
    });
    on(viewport,'beforeinput',e=>{
      if (e.inputType==='historyUndo'||e.inputType==='historyRedo') {
        if(!composing){e.preventDefault();history(e.inputType==='historyRedo');}return;
      }
      if(e.target===field && !composing){readField();beforeSelection={...selection};}
    });
    on(viewport,'compositionstart',e=>{
      if(e.target===field)readField();
      beforeSelection={...selection};composing=true;viewport.classList.add('sima-composing');
    });
    on(viewport,'compositionend',e=>{
      composing=false;viewport.classList.remove('sima-composing');if(e.target===field)inputChange();
      const commands=pendingActions;pendingActions=[];
      queueMicrotask(()=>{if(!destroyed)commands.forEach(f=>f());});
    });
    on(viewport,'input',e=>{if(e.target===field && !e.isComposing)inputChange();});
    on(viewport,'select',e=>{if(e.target===field&&!composing)readField();}, {capture:true});
    on(viewport,'click',e=>{
      const equation=e.target.closest('a[data-math-target]');
      if(equation){
        e.preventDefault();
        let target=document.getElementById(equation.dataset.mathTarget);
        if (!target && active) {
          draw(false);
          mathView?.schedule(0,()=>document.getElementById(equation.dataset.mathTarget)?.scrollIntoView({block:'center'}));
        } else target?.scrollIntoView({block:'center'});
        return;
      }
      const link=e.target.closest('a[href]');
      if(link){e.preventDefault();options.onLink?.(link.dataset.link||link.getAttribute('href'),{wiki:link.hasAttribute('data-wiki'),newTab:e.metaKey||e.ctrlKey});return;}
      if(composing || e.target.closest('textarea,button,details.sima-svg-preview,.sima-table-block,.sima-text-pair') || searchWhitespace(e))return;
      const box=e.target.closest('.sima-block'),b=blocks.find(item=>item.node===box);
      if(!b){if(doc.contains(e.target)||e.target===viewport)choose(text.length);return;}
      if(b.type==='yaml'&&yamlCollapsed){action('view.yaml');return;}
      if(e.target.matches('input[type=checkbox]')){
        const checks=[...box.querySelectorAll('input[type=checkbox]')], raw=text.slice(b.start,b.end);
        const m=[...raw.matchAll(/^[ \t]*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/gm)][checks.indexOf(e.target)];
        if(m){const pos=b.start+m.index+m[0].lastIndexOf('[')+1;write(pos,pos+1,m[1]===' '?'x':' ',{anchor:pos,head:pos});draw(false);}
        return;
      }
      const dom=window.getSelection();
      if(dom && !dom.isCollapsed && doc.contains(dom.anchorNode) && doc.contains(dom.focusNode)){
        const anchor=sourcePoint(dom.anchorNode,dom.anchorOffset), head=sourcePoint(dom.focusNode,dom.focusOffset);
        if(anchor!=null && head!=null){choose(anchor,head,true,false);return;}
      }
      const point=hitPoint(e.clientX,e.clientY);
      choose(point??b.start);
    });
    on(viewport,'focusin',e=>{
      if(e.target===viewport && viewport.matches(':focus-visible') && !field && !composing && !activeTable)focus();
    });
    on(viewport,'keydown',e=>{
      if(composing||e.isComposing||e.keyCode===229||e.defaultPrevented)return;
      const key=e.key, cmd=e.metaKey||e.ctrlKey;
      if(cmd && !e.altKey){
        if(key.toLowerCase()==='z'){
          e.preventDefault();e.stopPropagation();history(e.shiftKey);return;
        }
        if(key.toLowerCase()==='a' && !e.shiftKey && e.target===field){
          e.preventDefault();e.stopPropagation();action('edit.selectAll');return;
        }
      }
      if(e.target!==field)return;
      readField();
      const [lo,hi]=range();
      if(key==='Escape'&&!source){
        e.preventDefault();draw(false);return;
      }
      if(source)return;
      const direction=['ArrowUp','ArrowLeft'].includes(key)?-1:['ArrowDown','ArrowRight'].includes(key)?1:0;
      if(direction) {
        const pos=selection.head,atEdge=direction<0?pos===active.start:pos===active.end;
        const oneLine=!field.value.includes('\n') && field.clientHeight<parseFloat(getComputedStyle(field).lineHeight)*1.8;
        if(atEdge || oneLine && ['ArrowUp','ArrowDown'].includes(key)){
          const idx = blocks.indexOf(active);
          const neighbor = direction < 0 ? blocks.slice(0,idx).reverse().find(b=>!b.node.hidden) : blocks.slice(idx+1).find(b=>!b.node.hidden);
          if(neighbor){
            e.preventDefault();
            const n=direction<0?neighbor.end:neighbor.start;
            if(e.shiftKey)choose(selection.anchor,n,true,false);else choose(n);
            reveal();return;
          }
        }
      }
      if(lo===hi && ((key==='Backspace'&&lo===active.start&&lo>0)||(key==='Delete'&&hi===active.end&&hi<text.length))){
        e.preventDefault();const back=key==='Backspace';
        const count=(back?text.slice(lo-2,lo):text.slice(hi,hi+2))==='\r\n'?2:1;
        replace(back?lo-count:lo,back?hi:hi+count,'');return;
      }
      if(key==='Enter' && !e.shiftKey&&!cmd&&!e.altKey){
        const line=normalize(text.slice(active.start,lo)).split('\n').at(-1);
        const m=/^(\s*)([-*+]|\d+[.)]|>)(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
        if(m && !['code','fence','yaml','math','mermaid'].includes(active.type)){
          e.preventDefault();
          if(!m[5].trim())replace(lo-line.length,hi,'');
          else {
            const marker=/^\d/.test(m[2])?String(parseInt(m[2],10)+1)+m[2].slice(-1):m[2];
            replace(lo,hi,eol()+m[1]+marker+m[3]+(m[4]?'[ ] ':''));
          }
        }
      }
    });
    on(viewport,'paste',async e=>{
      if(composing||e.defaultPrevented)return;
      const files=[...(e.clipboardData?.files || [])].filter(f=>f.type.startsWith('image/'));
      if(!files.length || !options.onAsset)return;
      e.preventDefault();readSelection();
      const [a,b]=range(),p={a,b};pendingAssets.add(p);
      try {
        const links=[];
        for(const file of files){
          const path=await options.onAsset(file);
          if(path)links.push('!['+(file.name||'截图').replace(/[\\\[\]]/g,'\\$&')+']('+String(path).replace(/\(/g,'%28').replace(/\)/g,'%29')+')');
        }
        pendingAssets.delete(p);
        if(!destroyed && links.length)replace(p.a,p.b,links.join(eol()));
      }catch(error){(options.onError||window.alert)(String(error?.message||error));}
      finally{pendingAssets.delete(p);}
    },{capture:true});
    // A drag starting inside an active native textarea cannot extend outside it without a source-level continuation.
    let drag=null;
    on(viewport,'pointerdown',e=>{drag=e.target===field && !source?{x:e.clientX,y:e.clientY,start:field}:null;});
    on(document,'pointerup',e=>{
      const d=drag;drag=null;
      if(!d||d.start!==field||e.target===field||!doc.contains(e.target)||Math.hypot(e.clientX-d.x,e.clientY-d.y)<4)return;
      const end=hitPoint(e.clientX,e.clientY);if(end==null)return;
      const raw=text.slice(active.start,active.end), start=active.start+rawOffset(raw,end<active.start?field.selectionEnd:field.selectionStart);
      choose(start,end,true,false);
    });
    on(doc,'focusout',e=>{if(e.target.matches('.sima-table-cell-input')) mathView?.schedule();});
    draw(false);syncVisible();
    return {getText:()=>text,setText,getState,setState,focus,locate,outlineLocations,centeredHeading,goToHeading,showSearchResult,action,setHighlights,
      refreshImages(){
        for (const img of doc.querySelectorAll('img[data-markdown-src]')) {
          img.src = window.SimaRender.imageURL(img.dataset.markdownSrc,renderOptions.path);
        }
      },
      html:()=>options.literal ? '<pre>'+escape(text)+'</pre>' : window.SimaRender.exportWithDiagrams(text,renderOptions),
      destroy(){destroyed=true;mathView?.destroy();detachScrollbar();clearTimeout(previewTimer);if(previewURL)URL.revokeObjectURL(previewURL);events.abort();visibility.disconnect();for(const b of blocks)b.table?.destroy();host.replaceChildren();}
    };
  }
  window.SimaEditor={create};
})();
