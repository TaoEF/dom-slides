// Display labels only: commands stay in the existing editor action handlers.
export function shortcutLabels(platform = '') {
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
  const mod = mac ? '⌘' : 'Ctrl', shift = mac ? '⇧' : 'Shift', alt = mac ? '⌥' : 'Alt';
  const chord = (key, shifted = false) => `${mod} + ${shifted ? shift + ' + ' : ''}${key}`;
  return { mac, mod, shift, alt, group:chord('G'), ungroup:chord('G',true), 'select-all':chord('A'), undo:chord('Z'), redo:chord('Z',true),
    'element-duplicate':chord('D'), 'object-copy':chord('C'), 'object-paste':chord('V'), save:chord('S'), 'zoom-in':chord('+'), 'zoom-out':chord('−'), 'zoom-reset':chord('0'), 'zoom-fit':chord('1'),
    bold:chord('B'), source:chord('Enter'), extend:chord('方向键',true) };
}
