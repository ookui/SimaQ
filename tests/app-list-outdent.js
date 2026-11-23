// Exercise both rendered DOM selection and the native textarea in WKWebView.
const host = document.createElement('div');
document.body.append(host);
const title = '加密货币投资：从初级到专家计划表';
const items = [
  '- 整个路径可分为 5 个阶段，每阶段有清晰目标、实践内容和推荐工具或平台：',
  '- 阶段一：基础实践（初阶）',
  '- 🎯目标：',
  '- 掌握最基本的操作，建立风险意识。',
  '- ✅ 实践内容：',
  '- 创建安全钱包',
  '  - 学习使用冷热钱包（推荐：MetaMask、Trust Wallet、Ledger、Trezor）',
  '  - 熟悉助记词、私钥与公钥的区别及保存方式',
  '- 进行小额交易',
  '  - 在 Coinbase、Binance、OKX、Bitget 等交易所开户并完成 KYC（实名认证）',
  '  - 买入少量 BTC、ETH，尝试现货买卖、限价单与市价单',
  '- 了解链上浏览器',
  '  - 使用 Etherscan、BSCScan 查看交易记录、合约地址',
];
const source = [title, ...items].join('\n');
const expected = title + items.map((line, i) => {
  if (!line.startsWith('  ')) return '\n\n' + line.slice(2);
  const separator = items[i - 1].startsWith('  ') ? '\n' : '\n\n';
  return separator + line.trimStart();
}).join('');
const editor = SimaEditor.create(host, {text:source});
const checks = [];
function check(value, label) {
  if (!value) throw Error(label);
  checks.push(label);
}
function shiftTab(target) {
  const key = new KeyboardEvent('keydown', {key:'Tab', shiftKey:true, bubbles:true, cancelable:true});
  target.dispatchEvent(key);
  return key.defaultPrevented;
}
try {
  const li = host.querySelectorAll('li');
  const first = li[0].firstChild, last = li[li.length - 1].lastChild;
  window.getSelection().setBaseAndExtent(last, last.length, first, 0);
  check(shiftTab(document.body), '阅读视图反向选中列表后，键盘焦点留在页面也可处理 Shift+Tab');
  const after = editor.getState().selection;
  check(editor.getText() === expected && after.anchor === expected.length &&
    after.head === expected.indexOf('整个路径'), '原例八个顶级项成为正文，五个子项升一级，并保留反向选区');
  editor.action('edit.undo');
  const before = editor.getState().selection;
  check(editor.getText() === source && before.anchor === source.length && before.head === source.indexOf('整个路径'),
    '一次撤销恢复全文和原选区');
  editor.action('edit.redo');
  check(editor.getText() === expected, '一次重做恢复退级结果');
  host.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  check(host.querySelectorAll('li').length === 5 && !host.querySelector('li li') &&
    host.querySelectorAll('p').length === 9, '退出编辑后标题和八个正文段落各自独立，五个子项均显示为顶级列表');

  const mixed = '标题\r\n\r\n10. [x] 父项\r\n    + 子项\n      1) 三级\r\n- 未选中';
  const changed = '标题\r\n\r\n父项\r\n\r\n+ 子项\n  1) 三级\r\n- 未选中';
  editor.setText(mixed);
  editor.action('view.source');
  const field = host.querySelector('textarea');
  field.setSelectionRange(field.value.indexOf('父项'), field.value.indexOf('- 未选中'));
  check(shiftTab(field) && editor.getText() === changed, '源码选区支持任务、有序和无序项，保留换行符并排除选区终点所在的下一行');
  editor.action('edit.undo');
  check(editor.getText() === mixed, '混合换行一次撤销逐字还原');

  const fenced = '```md\n- 代码示例\n```';
  editor.setText(fenced);
  editor.locate(0, fenced.length);
  check(!shiftTab(host.querySelector('textarea')) && editor.getText() === fenced, '代码围栏中的列表样式文字保持原样');
  return {checks};
} finally {
  editor.destroy();
  host.remove();
}
