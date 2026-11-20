const checks=[];
function check(value,message){if(!value)throw Error(message);checks.push(message);}
const host=document.createElement('div');
host.style.cssText='position:fixed;inset:0;z-index:10000;background:white;overflow:hidden';
document.body.append(host);
let editor;
try {
  for(const image of ['![图片](image.png)','![图片](image.jpg){width=180}{align=center}','![[image.svg]]','[![图片](image.png)](page.md)']) {
    for(const ending of ['', '\n', '\n\n', '\r\n']) {
      const newline=ending==='\r\n'?'\r\n':'\n';
      const source='# 标题'+newline+newline+image+ending;
      editor=SimaEditor.create(host,{text:source,path:'test.md',isSearchActive:()=>true});
      check(editor.getText()===source,'Opening preserves image-ending document');
      const img=host.querySelector('.sima-sized-image img');
      check(img,'Image remains rendered');
      img.click();
      const entry=host.querySelector('.sima-end-entry');
      const rect=entry.getBoundingClientRect();
      entry.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:rect.left+8,clientY:rect.top+8}));
      entry.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:rect.left+8,clientY:rect.top+8}));
      const input=host.querySelector('textarea.sima-block-input');
      check(input && document.activeElement===input && input.value==='', 'Click below final image focuses empty paragraph even in search');
      check(host.querySelector('.sima-sized-image img') && !host.querySelector('.sima-image-caption'), 'Starting paragraph retains rendered image and closes its source editor');
      input.value='图片下面的文字';input.setSelectionRange(input.value.length,input.value.length);
      input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:input.value}));
      const expected='# 标题'+newline+newline+image+newline+newline+'图片下面的文字';
      check(editor.getText()===expected,'Text is a separate paragraph after the image with original newline style');
      editor.action('edit.undo');
      check(!editor.getText().includes('图片下面的文字') && editor.getText().includes(image),'Undo removes text without altering image');
      editor.action('edit.redo');
      check(editor.getText()===expected,'Redo restores text below image');
      editor.destroy();editor=null;
    }
  }
  return {checks};
} finally {editor?.destroy();host.remove();}
