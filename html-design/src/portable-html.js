// Build a portable copy only for explicit HTML downloads. Saved work files keep
// their normal relative resources so the local authoring workflow stays small.
export async function portableHTML(html, { baseURL, liveImages = [] }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cache = new Map();
  let total = 0;
  const absolute = (value, base = baseURL) => new URL(value, base).href;
  const resource = async (value, base = baseURL) => {
    if (/^(?:data:|#)/i.test(value)) return value;
    const url = absolute(value, base);
    if (!cache.has(url)) cache.set(url, (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`资源读取失败：${new URL(url).pathname}`);
      const blob = await response.blob();
      total += blob.size;
      if (total > 64 * 1024 * 1024) throw new Error('HTML 资源超过 64 MB，请减少图片后重试');
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('资源编码失败'));
        reader.readAsDataURL(blob);
      });
    })());
    return cache.get(url);
  };
  const css = async (value, base = baseURL) => {
    if (/@import\b/i.test(value)) throw new Error('CSS @import 暂不能打包为单文件 HTML');
    const urls = [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
    let output = value;
    for (const match of urls) {
      const ref = (match[1] ?? match[2] ?? match[3]).trim();
      if (!ref || /^(?:data:|#)/i.test(ref)) continue;
      output = output.replace(match[0], `url("${await resource(ref, base)}")`);
    }
    return output;
  };
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
    const url = absolute(link.getAttribute('href'));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`样式表读取失败：${new URL(url).pathname}`);
    const style = doc.createElement('style');
    style.textContent = await css(await response.text(), url);
    link.replaceWith(style);
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = await css(style.textContent);
  for (const node of doc.querySelectorAll('[style]')) node.setAttribute('style', await css(node.getAttribute('style')));
  const images = [...doc.querySelectorAll('img')];
  for (const [index, image] of images.entries()) {
    const src = liveImages[index]?.currentSrc || image.getAttribute('src');
    if (!src) continue;
    image.setAttribute('src', await resource(src));
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.closest('picture')?.querySelectorAll('source').forEach(source => source.remove());
  }
  for (const image of doc.querySelectorAll('svg image')) {
    const href = image.getAttribute('href') || image.getAttribute('xlink:href');
    if (href && !href.startsWith('#')) {
      const data = await resource(href);
      image.setAttribute('href', data);
      image.removeAttribute('xlink:href');
    }
  }
  for (const script of doc.querySelectorAll('script[src]')) {
    const url = absolute(script.getAttribute('src'));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`脚本读取失败：${new URL(url).pathname}`);
    script.removeAttribute('src');
    script.removeAttribute('integrity');
    script.removeAttribute('crossorigin');
    script.textContent = (await response.text()).replace(/<\/script/gi, '<\\/script');
  }
  if (doc.querySelector('video[src],video source[src],audio[src],audio source[src],iframe[src],object[data],embed[src]'))
    throw new Error('此页面含暂不能打包的媒体或嵌入资源');
  for (const link of doc.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (href && !/^(?:#|data:|javascript:|mailto:|tel:)/i.test(href)) link.setAttribute('href', absolute(href));
  }
  doc.querySelectorAll('base').forEach(base => base.remove());
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
