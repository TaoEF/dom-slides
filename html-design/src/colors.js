export const recommendedColors = [
  ['#102849', '#1c437b', '#2c65bd', '#357ff0', '#5798f4', '#7bb1f7', '#a8cffb', '#cfe3fb', '#eaf3fc'],
  ['#291b46', '#503185', '#7848ce', '#9255ee', '#ad80f2', '#c09df4', '#d2b7f7', '#e2d2f9', '#f0e8fb'],
  ['#482135', '#814060', '#ba5787', '#e46a9f', '#ee88b3', '#f4a4c6', '#f7bfd7', '#f9d9e6', '#fcecf2'],
  ['#502a16', '#914321', '#c75c28', '#ec7734', '#f28d55', '#f4a77c', '#f7bc9c', '#f9d2bc', '#fbe8da'],
  ['#51320e', '#98621b', '#cc9228', '#f0b638', '#f5ca55', '#f8d675', '#f9e29d', '#fbebc3', '#fdf5df'],
  ['#153721', '#2d693a', '#43974c', '#59b85d', '#76c97d', '#91d4a0', '#afe1bc', '#ccebd5', '#e4f4e9'],
  ['#202124', '#505660', '#7b8492', '#949ba6', '#adb3ba', '#c4c8cd', '#d8dadd', '#e9eaec', '#ffffff'],
];

export function hexColor(value) {
  if (!value || value === 'none' || value === 'transparent') return null;
  const input = String(value).trim();
  const short = /^#([0-9a-f]{3})$/i.exec(input);
  if (short) return '#' + [...short[1]].map(c => c + c).join('').toUpperCase();
  const full = /^#([0-9a-f]{6})$/i.exec(input);
  if (full) return '#' + full[1].toUpperCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(input);
  if (!rgb || (rgb[4] != null && Number(rgb[4]) !== 1)) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some(n => n > 255)) return null;
  return '#' + channels.map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function documentColors(boards) {
  const colors = new Set();
  const add = value => { const hex = hexColor(value); if (hex) colors.add(hex); };
  for (const board of boards) {
    for (const node of [board, ...board.querySelectorAll('*')]) {
      if (!(node instanceof Element) || node.matches('script,style,defs,linearGradient,stop')) continue;
      const style = getComputedStyle(node);
      if (node !== board && (style.display === 'none' || style.visibility === 'hidden')) continue;
      if (node.matches('svg[data-shape]')) {
        add(node.dataset.shapeFill);
        add(node.dataset.shapeStroke);
        continue;
      }
      if (node.childElementCount === 0 && node.textContent?.trim()) add(style.color);
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') add(style.backgroundColor);
      for (const side of ['Top', 'Right', 'Bottom', 'Left'])
        if (parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none') add(style[`border${side}Color`]);
      if (node instanceof SVGElement && !node.closest('svg[data-shape]')) {
        add(style.fill);
        add(style.stroke);
      }
    }
  }
  return [...colors];
}

export function hsvToHex(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); };
  return '#' + [f(5), f(3), f(1)].map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
