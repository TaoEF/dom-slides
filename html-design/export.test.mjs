import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { createPreviewServer } from './server.mjs';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import { browserOptions } from './export.mjs';
import { groupEditableSlideXml } from './pptx.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

let server, origin, xmlBrowser;
before(async () => {
  server = await createPreviewServer({ port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await xmlBrowser?.close(); await new Promise(resolve => server.close(resolve)); });

const fixture = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>Snapshot test</title>
<style>body{margin:40px}[data-stage]{padding:80px;transform:scale(.5)}[data-artboard]{display:flex;flex-direction:column;box-sizing:border-box;width:600px;height:300px;background:#a23c2a;color:white;padding:30px;margin:40px}h1{font:40px Arial;margin:0}.second{width:800px;height:400px;background:#d9e7ec;color:#111}</style></head><body>
<header data-editor-ui>EDITOR MUST NOT BE EXPORTED</header><main data-stage>
<section data-artboard="p1" data-title="Unsaved title"><h1 data-el="p1-title" style="translate:20px 10px">LATEST UNSAVED <span style="font-weight:bold;color:#ffcc00">EDIT</span></h1></section>
<section data-artboard="p2" data-title="Second" class="second"><h1 data-el="p2-title">SECOND PAGE</h1><img data-el="p2-image" src="/demos/assets/bricks.jpg" style="width:80px;height:60px;object-fit:cover"></section>
</main><script>document.querySelector('[data-stage]').remove();</script></body></html>`;

async function request(format, html = fixture, headers = {}) {
  return fetch(`${origin}/__html-design/export/${format}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify({ html, baseUrl: `${origin}/demos/toy-history.html`, title: 'Latest DOM snapshot', filename: '玩具简史' }),
  });
}

test('PDF exports every submitted board at its own dimensions, with scripts disabled', async () => {
  const response = await request('pdf');
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('x-html-design-pages'), '2');
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8/);
  const bytes = await response.arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getTitle(), 'Latest DOM snapshot');
  for (const [i, expected] of [[0, [450, 225]], [1, [600, 300]]]) {
    const { width, height } = pdf.getPage(i).getSize();
    assert.ok(Math.abs(width - expected[0]) < 1 && Math.abs(height - expected[1]) < 1);
  }
});

test('PPTX contains editable text runs and separate source images, not flattened slides', async () => {
  const response = await request('pptx');
  assert.equal(response.status, 200, await response.clone().text());
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  assert.equal(slides.length, 2);
  const first = await zip.file('ppt/slides/slide1.xml').async('string');
  const second = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(first, /<a:t>LATEST UNSAVED/);
  assert.match(first, /<a:t>EDIT<\/a:t>/);
  assert.match(first, /FFCC00/);
  assert.match(first, /b="1"/);
  assert.equal((first.match(/<p:pic>/g) || []).length, 0);
  assert.equal((second.match(/<p:pic>/g) || []).length, 1);
  assert.match(second, /SECOND PAGE/);
  assert.match(second, /p2-image/);
  assert.match(second, /<a:srcRect l="[1-9]\d*"/, 'cover images retain their crop instead of stretching');
  const xml = await zip.file('ppt/presentation.xml').async('string');
  assert.match(xml, /cx="5715000" cy="2857500"/);
  assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'), /可编辑元素/);
});

test('PPTX paragraphs reflow at the textbox width while authored breaks and rich styles survive', async () => {
  const paragraph = '中文段落可以随文本框宽度重新换行。English words keep their spaces across soft wraps.';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    [data-artboard]{width:600px;height:900px} [data-el]{width:120px;font:20px/28px Arial;margin:0}
    </style></head><body><main data-stage><section data-artboard="reflow">
    <p data-el="soft">${paragraph}</p>
    <p data-el="rich">Before <span style="font-weight:bold;color:#ffcc00;font-size:26px">bold words</span> after.</p>
    <p data-el="br">First<br><span style="font-weight:bold">Second</span><br><br>Fourth</p>
    <div data-el="blocks"><div>One <span style="color:#ff0000">red</span></div><div>Two</div><p>Three</p></div>
    <p data-el="normal">  Source\n indentation <span>  and </span> spaces  </p>
    <p data-el="pre-line" style="white-space:pre-line">First\n   Second\n\nFourth</p>
    <p data-el="pre-wrap" style="white-space:pre-wrap">  First\n  Second  line</p>
    <p data-el="invisible">Visible<span style="display:none">HIDDEN</span><span style="visibility:hidden">HIDDEN</span> text</p>
    <p data-el="case" style="text-transform:uppercase">small <span>words</span></p>
    <p data-el="spans">one<span> </span><b>two </b><span> three</span>&nbsp;four</p>
    <p data-el="trailing">First<br></p>
    <div data-el="flex" style="display:flex;width:500px;gap:10px"><span>Price:</span><span>$20</span></div>
    <div data-el="grid" style="display:grid;width:500px;grid-template-columns:1fr 1fr;gap:10px"><span>Grid</span><span>items</span></div>
    <div data-el="column" style="display:flex;flex-direction:column"><span>Top</span><span>Bottom</span></div>
    </section></main></body></html>`;
  const response = await request('pptx', html);
  assert.equal(response.status, 200, await response.clone().text());
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const textboxes = [...xml.matchAll(/<p:sp>.*?<\/p:sp>/gs)].map(match => match[0]).filter(s => s.includes('<p:txBody>'));
  assert.equal(textboxes.length, 14, 'each original text element remains one editable textbox');
  const box = name => {
    const shape = textboxes.find(s => s.includes(`name="${name}"`));
    assert.ok(shape, `textbox ${name} exists`);
    assert.match(shape, /<a:bodyPr[^>]*wrap="square"/);
    assert.doesNotMatch(shape, /<a:(?:normAutofit|spAutoFit)/, 'resizing keeps the authored font size');
    return shape;
  };
  const paragraphs = name => [...box(name).matchAll(/<a:p>.*?<\/a:p>/gs)].map(match =>
    [...match[0].matchAll(/<a:t>(.*?)<\/a:t>/gs)].map(text => text[1]).join(''));
  assert.deepEqual(paragraphs('soft'), [paragraph], 'soft wraps must not become hard paragraph breaks');
  assert.deepEqual(paragraphs('rich'), ['Before bold words after.']);
  assert.match(box('rich'), /b="1"/);
  assert.match(box('rich'), /FFCC00/);
  assert.match(box('rich'), /sz="1950"/);
  assert.deepEqual(paragraphs('br'), ['First', 'Second', '', 'Fourth']);
  assert.deepEqual(paragraphs('blocks'), ['One red', 'Two', 'Three']);
  assert.deepEqual(paragraphs('normal'), ['Source indentation and spaces']);
  assert.deepEqual(paragraphs('pre-line'), ['First', 'Second', '', 'Fourth']);
  assert.deepEqual(paragraphs('pre-wrap'), ['  First', '  Second  line']);
  assert.deepEqual(paragraphs('invisible'), ['Visible text']);
  assert.deepEqual(paragraphs('case'), ['SMALL WORDS']);
  assert.deepEqual(paragraphs('spans'), ['one two three\u00a0four']);
  assert.deepEqual(paragraphs('trailing'), ['First', '']);
  assert.deepEqual(paragraphs('flex'), ['Price: $20'], 'blockified row items are not separate paragraphs');
  assert.deepEqual(paragraphs('grid'), ['Grid items']);
  assert.deepEqual(paragraphs('column'), ['Top', 'Bottom']);
});

async function xmlPage(run) {
  xmlBrowser ||= await chromium.launch(browserOptions());
  const page = await xmlBrowser.newPage();
  try { return await run(page); } finally { await page.close(); }
}
async function inspectSlide(xml) {
  return xmlPage(page => page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw Error('invalid XML');
    const ns = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    const drawable = node => ['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'].includes(node.localName);
    const leaves = [], groups = [];
    const visit = node => {
      const props = [...node.children].find(n => ['nvSpPr', 'nvPicPr', 'nvGrpSpPr', 'nvGraphicFramePr', 'nvCxnSpPr'].includes(n.localName));
      const nv = props?.getElementsByTagNameNS(ns, 'cNvPr')[0];
      const info = { kind: node.localName, id: nv?.getAttribute('id'), name: nv?.getAttribute('name') };
      if (node.localName === 'grpSp') {
        info.children = [...node.children].filter(drawable).map(visit);
        info.schema = [...node.children].slice(0, 2).map(n => n.localName);
        const xfrm = [...node.children].find(n => n.localName === 'grpSpPr').children[0];
        info.transform = Object.fromEntries([...xfrm.children].map(n => [n.localName, Object.fromEntries([...n.attributes].map(a => [a.name, a.value]))]));
        groups.push(info);
      } else {
        info.xml = new XMLSerializer().serializeToString(node);
        info.text = [...node.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't')].map(n => n.textContent).join('');
        leaves.push(info);
      }
      return info;
    };
    const tree = doc.getElementsByTagNameNS(ns, 'spTree')[0];
    const top = [...tree.children].filter(drawable).map(visit);
    return { top, leaves, groups, ids: [...doc.getElementsByTagNameNS(ns, 'cNvPr')].map(n => n.getAttribute('id')),
      references: [...doc.getElementsByTagName('*')].flatMap(n => [...n.attributes].filter(a => a.namespaceURI === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships').map(a => a.value)) };
  }, xml));
}

// Synthetic fixtures only: no user attachment content is stored in the repository.
const shapesOf = xml => [...xml.matchAll(/<p:sp>.*?<\/p:sp>/gs)].map(match => match[0]);
const namedShape = (xml, name) => {
  const shape = shapesOf(xml).find(s => s.includes(`name="${name}"`));
  assert.ok(shape, `shape ${name} exists`);
  return shape;
};
async function slideXml(html) {
  const response = await request('pptx', html);
  assert.equal(response.status, 200, await response.clone().text());
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  return { xml: await zip.file('ppt/slides/slide1.xml').async('string'), zip };
}

test('PPTX skips shapes fully outside a clipped scene and keeps an intrinsic badge on one line', async () => {
  const html = `<!doctype html><html><head><style>
    [data-artboard]{position:relative;width:600px;height:300px;background:#181b25}
    .scene{position:absolute;left:40px;top:60px;width:180px;height:130px;overflow:hidden;border-radius:20px}
    .axis{position:absolute;left:250px;top:30px;width:100px;height:35px;overflow-x:clip;overflow-y:visible}
    .badge{display:inline-block;margin:80px 0 0 280px;padding:11px 17px;border-radius:40px;background:#9fe1cf;font:700 13px Arial}
    </style></head><body><main data-stage><section data-artboard="p1">
    <div class="scene"><svg data-el="hidden-circle" data-shape="ellipse" data-shape-fill="#f56d55" data-shape-stroke="#f56d55" data-shape-width="0" style="position:absolute;left:210px;top:-30px;width:50px;height:50px" viewBox="0 0 50 50"><circle cx="25" cy="25" r="25" fill="#f56d55"/></svg><svg data-el="visible-circle" data-shape="ellipse" data-shape-fill="#f56d55" data-shape-stroke="#f56d55" data-shape-width="0" style="position:absolute;left:20px;top:20px;width:50px;height:50px" viewBox="0 0 50 50"><circle cx="25" cy="25" r="25" fill="#f56d55"/></svg></div>
    <div class="axis"><span data-el="below-axis" style="position:absolute;left:10px;top:55px;display:block;width:80px;height:20px">Visible</span></div>
    <span data-el="pill" class="badge">Fully editable</span>
    </section></main></body></html>`;
  const { xml } = await slideXml(html);
  assert.doesNotMatch(xml, /name="hidden-circle"/);
  assert.match(xml, /name="visible-circle"/);
  assert.match(xml, /name="below-axis"/);
  const badge = shapesOf(xml).find(shape => shape.includes('name="pill"') && shape.includes('<p:txBody>'));
  assert.ok(badge, 'badge text stays editable');
  assert.match(badge, /<a:bodyPr[^>]*wrap="none"/);
  assert.match(badge, /<a:normAutofit/);
});

test('PPTX keeps a single-line CJK heading native without wrapping other text boxes', async () => {
  const { xml } = await slideXml(`<!doctype html><html><head><meta charset="utf-8"><style>
    [data-artboard]{width:960px;height:540px;display:flex;flex-direction:column;align-items:flex-start}
    h2,p{margin:0;font:700 52px/1.16 "PingFang SC",sans-serif}
    .narrow{width:156px}
    </style></head><body><main data-stage><section data-artboard="p1">
    <h2 data-el="chapter">第一章项目概况</h2>
    <h2 data-el="wrapped" class="narrow">第二章建设方案</h2>
    <h2 data-el="hard-break">第三章<br>执行计划</h2>
    <p data-el="paragraph">现有项目基线</p>
    </section></main></body></html>`);
  const chapter = namedShape(xml, 'chapter');
  assert.match(chapter, /<a:bodyPr[^>]*wrap="none"/);
  assert.match(chapter, /<a:t>第一章项目概况<\/a:t>/);
  for (const id of ['wrapped', 'hard-break', 'paragraph']) {
    assert.match(namedShape(xml, id), /<a:bodyPr[^>]*wrap="square"/);
  }
});

test('PPTX uniform rounded cards use one native fill/stroke shape each, with editable reflowing children', async () => {
  const html = `<!doctype html><html><head><style>
    [data-artboard]{width:960px;height:540px;position:relative}
    .card{position:absolute;top:100px;width:240px;height:180px;box-sizing:border-box;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:18px}
    h1,p{margin:0;font:20px/28px Arial} h1{font-size:32px}
    </style></head><body><main data-stage><section data-artboard="p1">
    <h1 data-el="title">Synthetic cards</h1>
    ${[0, 1, 2].map(i => `<div data-el="card${i}" class="card" style="left:${40 + i * 280}px"><p data-el="card${i}-title">Card ${i + 1}</p><p data-el="card${i}-body">An editable paragraph with enough text to wrap at the authored width.</p></div>`).join('')}
    </section></main></body></html>`;
  const { xml } = await slideXml(html);
  assert.equal(shapesOf(xml).length, 10, 'three containers plus seven textboxes, formerly 22 fragments');
  assert.doesNotMatch(xml, /-border"|<p:pic>/);
  const structure = await inspectSlide(xml);
  assert.deepEqual(structure.top.map(n => n.kind), ['sp', 'grpSp', 'grpSp', 'grpSp']);
  assert.equal(structure.groups.length, 3);
  for (const group of structure.groups) {
    assert.deepEqual(group.children.map(n => n.kind), ['sp', 'sp', 'sp']);
    assert.equal(group.children.filter(n => /<p:txBody>/.test(n.xml)).length, 2);
    assert.deepEqual(group.schema, ['nvGrpSpPr', 'grpSpPr']);
    assert.deepEqual(group.transform.off, group.transform.chOff);
    assert.deepEqual(group.transform.ext, group.transform.chExt);
  }
  assert.equal(new Set(structure.ids).size, structure.ids.length);
  for (let i = 0; i < 3; i++) {
    const shape = namedShape(xml, `card${i}`);
    assert.match(shape, /<a:solidFill><a:srgbClr val="FFF7ED"/);
    assert.match(shape, /<a:ln w="9525"[^>]*>.*?<a:srgbClr val="FED7AA"/s);
    assert.match(shape, /<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 6425"/);
    assert.match(shape, new RegExp(`<a:off x="${Math.round((40 + i * 280 + .5) * 9525)}" y="957263"`));
    assert.match(shape, /<a:ext cx="2276475" cy="1704975"/);
    assert.doesNotMatch(shape, /<p:txBody>/);
    for (const suffix of ['title', 'body']) assert.match(namedShape(xml, `card${i}-${suffix}`), /<a:bodyPr[^>]*wrap="square"/);
    const body = namedShape(xml, `card${i}-body`);
    assert.equal((body.match(/<a:p>/g) || []).length, 1, 'soft wraps remain a single native paragraph');
  }
});

test('PPTX container mapping preserves transparent, absent and differing borders without false unification', async () => {
  const definitions = [
    ['transparent-fill', 'background:transparent;border:2px solid rgba(20,40,60,.5);border-radius:10px'],
    ['no-border', 'background:#abcdef;border:0;border-radius:0'],
    ['transparent-border', 'background:#abcdef;border:4px solid transparent;border-radius:8px'],
    ['invisible', 'background:transparent;border:4px solid transparent'],
    ['different-color', 'background:#abcdef;border:2px solid red;border-left-color:blue'],
    ['different-width', 'background:#abcdef;border:2px solid red;border-left-width:4px'],
    ['different-style', 'background:#abcdef;border:2px solid red;border-left-style:dashed'],
    ['different-corners', 'background:#abcdef;border:2px solid red;border-radius:12px 4px'],
    ['pill', 'background:#abcdef;border:2px solid red;border-radius:999px'],
    ['small-radius', 'background:#abcdef;border:1px solid red;border-radius:2px'],
    ['alpha', 'background:rgba(171,205,239,.5);border:2px solid rgba(20,40,60,.5);border-radius:10px;opacity:.5'],
    ['ellipse', 'background:#abcdef;border:2px solid red;border-radius:50%'],
    ['elliptic-corners', 'background:#abcdef;border:2px solid red;border-radius:20%'],
    ['transformed', 'background:#abcdef;border:2px solid red;transform:scale(.8)'],
    ['tiny-radius', 'background:#abcdef;border:4px solid red;border-radius:1px'],
  ];
  const html = `<!doctype html><html><head><style>[data-artboard]{width:800px;height:600px;position:relative}.box{position:absolute;width:100px;height:60px;box-sizing:border-box}</style></head><body><main data-stage><section data-artboard="p1">${definitions.map(([id, style], i) => `<div class="box" data-el="${id}" style="left:${20 + i % 5 * 140}px;top:${20 + Math.floor(i / 5) * 150}px;${style}"></div>`).join('')}</section></main></body></html>`;
  const { xml, zip } = await slideXml(html);
  const transparent = namedShape(xml, 'transparent-fill');
  assert.match(transparent, /<a:ln w="19050"[^>]*>.*?<a:srgbClr val="14283C"><a:alpha val="50000"/s);
  assert.doesNotMatch(xml, /name="transparent-fill-border"|name="transparent-border-border"|name="no-border-border"|name="invisible(?:-border)?"/);
  assert.match(namedShape(xml, 'no-border'), /<a:prstGeom prst="rect"/);
  assert.match(namedShape(xml, 'transparent-border'), /<a:off x="2857500" y="190500"/);
  for (const id of ['different-color', 'different-width', 'different-style', 'different-corners', 'elliptic-corners', 'tiny-radius']) {
    assert.equal(shapesOf(xml).filter(s => s.includes(`name="${id}-border"`)).length, 4, `${id} keeps its side-specific fallback`);
    assert.match(namedShape(xml, id), /<a:ln[^>]*>.*?<a:alpha val="0"/s, 'fallback fill must not add a uniform stroke');
  }
  assert.equal(shapesOf(xml).filter(s => s.includes('name="transformed-border"')).length, 0, 'positive uniform scale now retains one native fill/stroke');
  assert.match(namedShape(xml, 'transformed'), /<a:ln w="15240"/);
  assert.match(namedShape(xml, 'pill'), /<a:prstGeom prst="roundRect"/);
  assert.match(namedShape(xml, 'pill'), /fmla="val 50000"/);
  assert.match(namedShape(xml, 'small-radius'), /<a:prstGeom prst="roundRect"/);
  assert.equal((namedShape(xml, 'alpha').match(/<a:alpha val="25000"/g) || []).length, 2, 'fill and stroke combine CSS alpha with element opacity');
  assert.match(namedShape(xml, 'ellipse'), /<a:prstGeom prst="ellipse"/);
  assert.match(namedShape(xml, 'different-corners'), /<a:prstGeom prst="rect"/, 'unsupported corners do not masquerade as precise rounding');
  assert.match(namedShape(xml, 'elliptic-corners'), /<a:prstGeom prst="rect"/);
  assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'), /different-corners/);
});

test('PPTX semantic groups preserve nested ownership, image/link references and skip layout/empty/single wrappers', async () => {
  const html = `<!doctype html><html><head><style>[data-artboard]{width:800px;height:600px;position:relative}p{margin:0;font:20px/28px Arial}.repeat{padding:5px}.outer{position:absolute;left:40px;top:60px;width:300px;background:#abcdef;border:1px solid red}.inner{position:relative;background:#fedcba;padding:10px}img{width:80px;height:60px;object-fit:cover}</style></head><body><main data-stage><section data-artboard="p1">
    <div class="layout"><p data-el="title">Standalone title</p>
    <div data-el="outer" class="outer repeat"><div class="layout"><div data-el="inner" class="inner repeat">
      <div class="repeat" style="background:#123456"><p data-el="nested-text">Nested text</p></div>
      <img data-el="image" src="/demos/assets/bricks.jpg">
      <a href="https://example.com/target"><p data-el="link">Editable hyperlink</p></a>
      <p data-el="overflow" style="position:absolute;left:-80px;top:-30px;width:100px">Overflow</p>
    </div></div><p data-el="sibling">Outer sibling</p></div>
    <div data-el="cousin" class="repeat" style="position:absolute;left:450px;top:80px"><div class="repeat" style="background:#654321"><p data-el="cousin-text">Cousin</p></div><p data-el="cousin-second">Second child</p></div>
    <div data-el="single"><p data-el="only-child">Single child</p></div><div data-el="empty"></div>
    <div class="layout"><p data-el="layout-first">First ungrouped</p><p data-el="layout-second">Second ungrouped</p></div>
    </div></section></main></body></html>`;
  const { xml, zip } = await slideXml(html), structure = await inspectSlide(xml);
  assert.deepEqual(structure.groups.map(g => g.name).sort(), ['cousin', 'inner', 'outer']);
  const outer = structure.groups.find(g => g.name === 'outer');
  assert.deepEqual(outer.children.map(n => n.name), ['outer', 'inner', 'sibling']);
  const inner = structure.groups.find(g => g.name === 'inner');
  assert.ok(inner.children.some(n => n.kind === 'pic' && n.name === 'image'));
  assert.ok(inner.children.some(n => n.name === 'repeat' && n.xml.includes('123456')));
  assert.ok(structure.groups.find(g => g.name === 'cousin').children.some(n => n.name === 'repeat' && n.xml.includes('654321')), 'duplicate classes are owned by their source DOM node');
  assert.ok(Number(inner.transform.off.x) < 40 * 9525, 'group includes overflowing child geometry');
  for (const group of structure.groups) {
    assert.deepEqual(group.transform.off, group.transform.chOff);
    assert.deepEqual(group.transform.ext, group.transform.chExt);
  }
  assert.equal(new Set(structure.ids).size, structure.ids.length);
  assert.ok(structure.top.some(n => n.name === 'only-child'));
  assert.ok(structure.top.some(n => n.name === 'layout-first'));
  assert.ok(structure.top.some(n => n.name === 'layout-second'));
  assert.match(namedShape(xml, 'link'), /<a:hlinkClick[^>]*r:id=/);
  const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string');
  for (const reference of structure.references) assert.match(rels, new RegExp(`Id="${reference}"`));
  assert.match(rels, /Target="https:\/\/example.com\/target"/);
  assert.ok(Object.keys(zip.files).some(name => name.startsWith('ppt/media/') && !zip.files[name].dir));
});

test('PPTX grouping wraps original XML leaves without changing geometry, formatting, crop, links or order', async () => {
  const pptx = new PptxGenJS(), slide = pptx.addSlide();
  slide.addShape(pptx.ShapeType.roundRect, { x: 1, y: 1, w: 3, h: 2, rectRadius: .1, fill: { color: 'ABCDEF' }, line: { color: '123456', width: .75 } });
  slide.addText('Native child', { x: .8, y: .9, w: 2, h: .4, bold: true, wrap: true, hyperlink: { url: 'https://example.com' } });
  slide.addImage({ data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hywAAAAASUVORK5CYII=', x: 2, y: 1, w: 1, h: 1 });
  slide.addText('Outside', { x: 5, y: 1, w: 2, h: 1 });
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
  const original = await zip.file('ppt/slides/slide1.xml').async('string');
  const plan = { xml: original, owners: [['outer'], ['outer', 'inner'], ['outer', 'inner'], []], groups: [{ id: 'outer', name: 'Container' }, { id: 'inner', name: 'Nested' }] };
  const grouped = await xmlPage(page => page.evaluate(groupEditableSlideXml, plan));
  const before = await inspectSlide(original), after = await inspectSlide(grouped);
  assert.deepEqual(after.leaves, before.leaves, 'all leaf XML, including transforms and relationship IDs, survives exactly');
  assert.equal(after.groups.length, 2);
  assert.equal(new Set(after.ids).size, after.ids.length);
  assert.deepEqual(after.top.map(n => n.kind), ['grpSp', 'sp']);
  for (const group of after.groups) {
    assert.deepEqual(group.schema, ['nvGrpSpPr', 'grpSpPr']);
    assert.deepEqual(group.transform.off, group.transform.chOff);
    assert.deepEqual(group.transform.ext, group.transform.chExt);
  }
  await assert.rejects(xmlPage(page => page.evaluate(groupEditableSlideXml, { ...plan, owners: [] })), /对象对应关系/);
  await assert.rejects(xmlPage(page => page.evaluate(groupEditableSlideXml, { ...plan, owners: [['outer'], [], ['outer'], []] })), /组合顺序不连续/);
});

test('invalid export requests and cross-origin writes are rejected without touching files', async () => {
  assert.equal((await request('pdf', fixture, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('exe')).status, 404);
  assert.equal((await request('pdf', '<html>empty</html>')).status, 400);
  assert.equal((await fetch(`${origin}/node_modules/playwright/package.json`)).status, 403);
  assert.equal((await fetch(`${origin}/demos/recovered/tab-v5-snapshot.json`)).status, 403);
  assert.deepEqual(await (await fetch(`${origin}/__html-design/health`)).json(), { exports: ['pdf', 'pptx'] });
});

test('PPTX reports incompatible page ratios rather than stretching slides', async () => {
  const response = await request('pptx', fixture.replace('width:800px;height:400px', 'width:800px;height:600px'));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /相同比例/);
});

test('PPTX native rotation uses true local dimensions, accumulated scale/angle and DOM centers while semantic groups stay identity', async () => {
  const html = `<!doctype html><html><head><style>
  body{margin:0}[data-artboard]{width:900px;height:600px;position:relative;background:#fff}p{margin:0;font:20px/28px Arial}
  [data-el=card]{position:absolute;left:230px;top:180px;width:300px;height:200px;box-sizing:border-box;padding:20px;border:2px solid #a0b0c0;border-radius:16px;background:#edf7ff;rotate:25deg;scale:1.25;transform-origin:20px 40px}
  [data-el=title]{width:200px;height:60px;box-sizing:border-box;padding:8px;border:1px solid #204060;border-radius:4px;background:#b7e4cc;transform:rotate(10deg) scale(1.2);rotate:5deg;transform-origin:12px 22px}
  [data-el=photo]{position:absolute;left:190px;top:100px;width:80px;height:60px;object-fit:cover;rotate:-15deg}
  [data-el=inner]{position:absolute;left:20px;top:110px;width:100px;height:50px;background:#f8d6aa;rotate:-30deg;scale:.8;transform-origin:0 0}
  [data-el=nested]{width:80px;height:30px;padding:0;font-size:14px}
  </style></head><body><main data-stage><section data-artboard="rotation"><div data-el="card"><p data-el="title">Editable title</p><a href="https://example.com/rotation"><img data-el="photo" src="/demos/assets/bricks.jpg"></a><div data-el="inner"><p data-el="nested">Nested</p></div></div></section></main></body></html>`;
  const actualCenters = await xmlPage(async page => {
    await page.setContent(`<base href="${origin}/">` + html);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); });
    await mkdir('.export-test/issue19-test', { recursive: true });
    await page.locator('[data-artboard]').screenshot({ path: '.export-test/issue19-test/export-browser.png' });
    return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-el]')].map(el => { const r = el.getBoundingClientRect(); return [el.dataset.el, { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }]; })));
  });
  const { xml, zip } = await slideXml(html);
  const native = await xmlPage(page => page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml'), p = 'http://schemas.openxmlformats.org/presentationml/2006/main', a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    return [...doc.getElementsByTagNameNS(p, 'sp'), ...doc.getElementsByTagNameNS(p, 'pic')].map(node => {
      const xfrm = [...node.children].find(n => n.localName === 'spPr').getElementsByTagNameNS(a, 'xfrm')[0];
      const off = xfrm.getElementsByTagNameNS(a, 'off')[0], ext = xfrm.getElementsByTagNameNS(a, 'ext')[0];
      const w = Number(ext.getAttribute('cx')) / 9525, h = Number(ext.getAttribute('cy')) / 9525;
      const body = node.getElementsByTagNameNS(a, 'bodyPr')[0];
      return { name: node.getElementsByTagNameNS(p, 'cNvPr')[0].getAttribute('name'), text: !!body, kind: node.localName,
        angle: Number(xfrm.getAttribute('rot') || 0) / 60000, w, h, cx: Number(off.getAttribute('x')) / 9525 + w / 2, cy: Number(off.getAttribute('y')) / 9525 + h / 2,
        margin: body ? Number(body.getAttribute('lIns')) / 9525 : null };
    });
  }, xml));
  const expected = [ ['card', false, 25, 372.5, 247.5], ['title', false, 40, 298.5, 88.5], ['title', true, 40, 300, 90], ['photo', false, 10, 100, 75], ['inner', false, 355, 100, 50], ['nested', true, 355, 80, 30] ];
  for (const [name, text, angle, w, h] of expected) {
    const item = native.find(n => n.name === name && n.text === text); assert.ok(item, `${name}/${text}`);
    assert.ok(Math.abs(item.angle - angle) < .001, JSON.stringify(item));
    assert.ok(Math.abs(item.w - w) < .002 && Math.abs(item.h - h) < .002, JSON.stringify(item));
    assert.ok(Math.abs(item.cx - actualCenters[name].x) < .02 && Math.abs(item.cy - actualCenters[name].y) < .02, JSON.stringify({ item, actual: actualCenters[name] }));
  }
  assert.ok(Math.abs(native.find(n => n.name === 'title' && n.text).margin - 13.5) < .002, 'text margin includes scaled CSS padding and border');
  assert.match(namedShape(xml, 'title'), /<a:ln w="14288"/);
  assert.match(xml, /sz="2250"/); assert.match(xml, /<a:srcRect/);
  const structure = await inspectSlide(xml); assert.deepEqual(structure.groups.map(g=>g.name).sort(),['card','inner','title']); assert.deepEqual(structure.groups.find(g=>g.name==='title').children.map(n=>n.name),['title','title']); assert.equal(new Set(structure.ids).size, structure.ids.length);
  for (const group of structure.groups) { assert.deepEqual(group.transform.off, group.transform.chOff); assert.deepEqual(group.transform.ext, group.transform.chExt); }
  assert.match(await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string'), /https:\/\/example.com\/rotation/);
  const pdfResponse = await request('pdf', html); assert.equal(pdfResponse.status, 200);
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer()), pdf = await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getPageCount(), 1); assert.ok(Math.abs(pdf.getPage(0).getWidth() - 675) < .5); assert.ok(Math.abs(pdf.getPage(0).getHeight() - 450) < .5);
  await writeFile('.export-test/issue19-test/export-rotation.pdf', pdfBytes);
  await writeFile('.export-test/issue19-test/export-rotation.pptx', await zip.generateAsync({ type: 'nodebuffer' }));
  await writeFile('.export-test/issue19-test/export-rotation.html', html);
});

for (const grouped of [false, true]) test(`rotated side-specific border fallback has valid directed endpoints across quadrants (${grouped ? 'semantic group' : 'standalone'})`, async () => {
  const angles = [30, -30, 120, -120, 210, 300, 0, 90, 180, 270];
  const html = `<html><head><style>body{margin:0}[data-artboard]{position:relative;width:1200px;height:600px}.card{position:absolute;width:200px;height:100px;box-sizing:border-box;background:#abcdef;border:2px solid red;border-left-color:blue}.card p{position:absolute;left:20px;top:20px;width:120px;height:50px;margin:0;font:18px/24px Arial}</style></head><body><main data-stage><section data-artboard="p1">${angles.map((angle, i) => `<div data-el="c${i}" class="card" style="left:${20 + i % 5 * 240}px;top:${70 + Math.floor(i / 5) * 240}px;rotate:${angle}deg">${grouped ? `<p data-el="c${i}-text">Native child</p>` : ''}</div>`).join('')}</section></main></body></html>`;
  const { xml } = await slideXml(html);
  const structure = await inspectSlide(xml);
  assert.equal(structure.groups.length, angles.length, 'each container owns its native fill and side-specific borders, with or without child text');
  const native = await xmlPage(page => page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml'), a = 'http://schemas.openxmlformats.org/drawingml/2006/main', p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    const extents = [...doc.getElementsByTagNameNS(a, 'ext')].map(n => [Number(n.getAttribute('cx')), Number(n.getAttribute('cy'))]);
    const lines = [...doc.getElementsByTagNameNS(p, 'sp')].filter(n => n.getElementsByTagNameNS(p, 'cNvPr')[0].getAttribute('name').endsWith('-border')).map(n => {
      const t = n.getElementsByTagNameNS(a, 'xfrm')[0], off = t.getElementsByTagNameNS(a, 'off')[0], ext = t.getElementsByTagNameNS(a, 'ext')[0];
      const x = Number(off.getAttribute('x')) / 9525, y = Number(off.getAttribute('y')) / 9525, w = Number(ext.getAttribute('cx')) / 9525, h = Number(ext.getAttribute('cy')) / 9525;
      const flipH = t.getAttribute('flipH') === '1', flipV = t.getAttribute('flipV') === '1';
      return { name: n.getElementsByTagNameNS(p, 'cNvPr')[0].getAttribute('name'), start: [x + (flipH ? w : 0), y + (flipV ? h : 0)], end: [x + (flipH ? 0 : w), y + (flipV ? 0 : h)] };
    });
    return { extents, lines };
  }, xml));
  assert.ok(native.extents.every(pair => pair.every(value => Number.isFinite(value) && value >= 0)), 'DrawingML extents must be non-negative, including standalone fallback lines');
  const sides = [[[-100, -50], [100, -50]], [[100, -50], [100, 50]], [[-100, 50], [100, 50]], [[-100, -50], [-100, 50]]];
  for (const [i, angle] of angles.entries()) {
    const lines = native.lines.filter(line => line.name === `c${i}-border`); assert.equal(lines.length, 4);
    const rad = angle * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad), cx = 120 + i % 5 * 240, cy = 120 + Math.floor(i / 5) * 240;
    const transformed = ([x, y]) => [cx + cos * x - sin * y, cy + sin * x + cos * y];
    for (let j = 0; j < 4; j++) for (const [key, point] of [['start', sides[j][0]], ['end', sides[j][1]]]) {
      const expected = transformed(point); for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(lines[j][key][axis] - expected[axis]) < .002, JSON.stringify({ grouped, angle, side: j, key, actual: lines[j][key], expected }));
    }
  }
  if (grouped) {
    assert.equal(structure.leaves.filter(n => n.text === 'Native child').length, angles.length);
    for (const group of structure.groups) { assert.deepEqual(group.transform.off, group.transform.chOff); assert.deepEqual(group.transform.ext, group.transform.chExt); }
  }
});

test('PPTX editable text maps common Flex/Grid vertical axes and padding while ordinary blocks stay top', async () => {
  const cases = [
    ['block', 'display:block;text-align:center', 't'],
    ['row-top','display:flex;align-items:flex-start','t'],
    ['row-center','display:flex;align-items:center','ctr'],
    ['row-bottom','display:flex;align-items:flex-end','b'],
    ['column-top','display:flex;flex-direction:column;justify-content:flex-start;align-items:center','t'],
    ['column-center','display:flex;flex-direction:column;justify-content:center;align-items:flex-start','ctr'],
    ['column-bottom','display:flex;flex-direction:column;justify-content:flex-end;align-items:center','b'],
    ['reverse-start','display:flex;flex-direction:column-reverse;justify-content:flex-start','b'],
    ['reverse-end','display:flex;flex-direction:column-reverse;justify-content:flex-end','t'],
    ['grid-center','display:grid;align-items:center','ctr'],
    ['grid-bottom','display:grid;align-items:end','b'],
    ['grid-fill','display:grid;grid-template-rows:1fr;align-items:center;align-content:start','ctr'],
    ['grid-content-center','display:grid;align-content:center','ctr'],
    ['grid-content-bottom','display:grid;align-content:end','b'],
  ];
  cases.unshift(cases.splice(2,1)[0]);
  const html=`<!doctype html><html><head><style>body{margin:0}[data-artboard]{position:relative;width:1200px;height:900px}.text{position:absolute;box-sizing:border-box;width:190px;height:130px;padding:14px 18px 22px 10px;border:2px solid #123456;border-radius:16px;background:#dbe5df;font:20px/28px Arial;white-space:normal;text-align:center}</style></head><body><main data-stage><section data-artboard="p1">${cases.map(([id,css],i)=>`<div data-el="${id}" class="text" style="left:${30+i%5*235}px;top:${50+Math.floor(i/5)*240}px;${css};${id==='row-center'?'rotate:30deg;transform-origin:20% 70%;scale:1.2':''}">${id.startsWith('grid')?'<span>Editable <b>wrapped words</b><br>Second line</span>':'Editable <span style="font-weight:bold">wrapped words</span><br>Second line'}</div>`).join('')}</section></main></body></html>`;
  const {xml}=await slideXml(html),structure=await inspectSlide(xml);
  for(const [id,,anchor] of cases){const text=structure.leaves.find(n=>n.name===id&&n.xml.includes('<p:txBody>'));assert.ok(text,id);assert.match(text.xml,new RegExp(`<a:bodyPr[^>]*anchor="${anchor}"`),id);assert.match(text.xml,/<a:bodyPr[^>]*wrap="square"/);assert.match(text.text,/^Editable ?wrapped wordsSecond line$/,id);assert.doesNotMatch(text.xml,/<a:(?:normAutofit|spAutoFit)/);const scaled=id==='row-center'?1.2:1;for(const [attr,pixels] of [['tIns',16],['rIns',20],['bIns',24],['lIns',12]]){const value=Number(text.xml.match(new RegExp(`${attr}="(\\d+)"`))[1])/9525;assert.ok(Math.abs(value-pixels*scaled)<.002,`${id} ${attr}: ${value} expected ${pixels*scaled}`);}if(id==='row-center')assert.match(text.xml,/<a:xfrm[^>]*rot="1800000"/);}
});

test('PPTX same-node background and own text become native subgroups inside existing semantic groups without changing leaf order',async()=>{
  const html=`<!doctype html><html><head><style>body{margin:0}[data-artboard]{width:800px;height:600px;position:relative}p{margin:0;font:20px/28px Arial}.repeat{position:absolute;width:160px;height:100px;box-sizing:border-box;border:2px solid #123456;border-radius:18px;background:#abcdef;font:22px/30px Arial;display:flex;align-items:center;justify-content:center;text-align:center}</style></head><body><main data-stage><section data-artboard="p1"><p data-el="title">First leaf</p><div data-el="outer" data-group="1" style="display:contents"><a href="https://example.com/card"><div data-el="card-a" class="repeat" style="left:40px;top:100px;rotate:30deg">Card A</div></a><div data-el="card-b" class="repeat" style="left:280px;top:100px;border-left-color:blue">Card B</div></div><div data-el="card-c" class="repeat" style="left:510px;top:100px">Card C</div><p data-el="only" style="position:absolute;top:300px">Last leaf</p></section></main></body></html>`;
  const {xml,zip}=await slideXml(html),s=await inspectSlide(xml);
  assert.deepEqual(s.top.map(n=>n.name),['title','outer','card-c','only']);
  assert.deepEqual(s.groups.map(g=>g.name).sort(),['card-a','card-b','card-c','outer']);
  assert.deepEqual(s.groups.find(g=>g.name==='outer').children.map(n=>[n.kind,n.name]),[['grpSp','card-a'],['grpSp','card-b']]);
  for(const name of ['card-a','card-b','card-c']){const group=s.groups.find(g=>g.name===name);assert.equal(group.children.filter(n=>n.xml.includes('<p:txBody>')).length,1);assert.equal(group.children.length,name==='card-b'?6:2);assert.deepEqual(group.transform.off,group.transform.chOff);assert.deepEqual(group.transform.ext,group.transform.chExt);assert.ok(group.children.every(n=>n.name===name||n.name===name+'-border'));}
  assert.deepEqual(s.leaves.filter(n=>n.text).map(n=>n.text),['First leaf','Card A','Card B','Card C','Last leaf']);assert.equal(s.leaves.length,12);assert.equal(new Set(s.ids).size,s.ids.length);
  const rels=await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string');for(const ref of s.references)assert.match(rels,new RegExp(`Id="${ref}"`));assert.match(rels,/https:\/\/example.com\/card/);
});

test('review P2: actual text-item align-self overrides container cross alignment; column keeps its main axis and unrepresentable grid/mixed items disclose approximation',async()=>{
  const cases=[
    ['flex-start','display:flex;align-items:center','<span style="align-self:start">Text</span>','t',false],
    ['grid-start','display:grid;align-items:center','<span style="align-self:start">Text</span>','t',false],
    ['flex-end','display:flex;align-items:center','<span style="align-self:end">Text</span>','b',false],
    ['grid-end','display:grid;align-items:center','<span style="align-self:end">Text</span>','b',false],
    ['flex-stretch','display:flex;align-items:center','<span style="align-self:stretch">Text</span>','t',false],
    ['column','display:flex;flex-direction:column;justify-content:center','<span style="align-self:start">Text</span>','ctr',false],
    ['fixed-grid','display:grid;grid-template-rows:80px;align-content:center;align-items:end','<span>Text</span>','t',true],
    ['auto-grid','display:grid;align-content:center;align-items:end','<span>Text</span>','ctr',false],
    ['mixed-flex','display:flex;align-items:center','<span style="align-self:start">First</span><span style="align-self:end">Last</span>','t',true],
  ];
  const html=`<!doctype html><html><head><style>body{margin:0}[data-artboard]{position:relative;width:1200px;height:750px}.card{position:absolute;width:200px;height:200px;font:20px/24px Arial;background:#def}</style></head><body><main data-stage><section data-artboard="p1">${cases.map(([id,style,body],i)=>`<div data-el="${id}" class="card" style="left:${20+i%5*235}px;top:${40+Math.floor(i/5)*300}px;${style}">${body}</div>`).join('')}</section></main></body></html>`;
  const dom=await xmlPage(async page=>{await page.setContent(html);return page.locator('[data-el]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>{const r=n.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(n);const t=range.getBoundingClientRect();return[n.dataset.el,{top:r.top,height:r.height,textTop:t.top,textHeight:t.height}];})));});
  for(const id of ['flex-start','grid-start'])assert.ok(dom[id].textTop-dom[id].top<2,id+' really starts at top');
  assert.ok(Math.abs(dom['fixed-grid'].textTop-dom['fixed-grid'].top-116)<2,'80px centered track plus end puts text below the full-box center');
  const {xml,zip}=await slideXml(html),structure=await inspectSlide(xml),notes=await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');
  for(const [id,,,anchor,approx] of cases){const text=structure.leaves.find(n=>n.name===id&&n.xml.includes('<p:txBody>'));assert.ok(text,id);assert.match(text.xml,new RegExp(`<a:bodyPr[^>]*anchor="${anchor}"`),id);assert.match(text.xml,/<a:bodyPr[^>]*wrap="square"/);if(approx)assert.match(notes,new RegExp(id+': .*近似'),id);else assert.doesNotMatch(notes,new RegExp(id+':'),id+' maps representably');}
});

test('PPTX keeps one-line editor text and includes unmarked notes inside editable cards', async () => {
  const {xml} = await slideXml(`<!doctype html><style>
    [data-artboard]{width:900px;height:500px;position:relative;font:24px/36px Arial}
    .note{position:absolute;top:220px;left:40px;width:760px}
  </style><main data-stage><section data-artboard="p1">
    <div data-el="heading" data-text-box>编辑器标题 <b>与原地验证</b></div>
    <div data-el="card">
      <p data-el="ordinary">Editable paragraph in the card.</p>
      <div><span data-el="inline" data-text-box><b>第一段</b>继续显示。</span></div>
      <div class="note"><b>预计：</b>独立说明完整保留。</div>
      <div style="opacity:0;display:flex"><div>HIDDEN NOT A NOTE</div></div>
    </div>
    <div data-el="wrapped" data-text-box style="width:85px">浏览器里已经换行</div>
    <footer style="display:flex"><span data-el="folio">09</span></footer>
    <h2 data-el="tight-line" style="width:112px;font:24px/18px Arial">Two lines appear</h2>
  </section></main>`);
  for (const name of ['heading', 'inline', 'folio']) {
    const shape = namedShape(xml, name);
    assert.match(shape, /<a:bodyPr[^>]*wrap="none"/);
    assert.doesNotMatch(shape, /<a:(?:normAutofit|spAutoFit)/);
  }
  assert.match(namedShape(xml, 'inline'), /<a:t>第一段<\/a:t>.*<a:t>继续显示。<\/a:t>/s);
  const note = shapesOf(xml).find(shape => shape.includes('独立说明完整保留。'));
  assert.ok(note);
  assert.match(note, /<a:off x="381000" y="2095500"/);
  assert.match(note, /<a:rPr[^>]*sz="1800"[^>]*b="1"/);
  assert.equal((xml.match(/<a:t>独立说明完整保留。<\/a:t>/g) || []).length, 1);
  assert.doesNotMatch(xml, /HIDDEN NOT A NOTE/);
  for (const name of ['ordinary','wrapped','tight-line']) assert.match(namedShape(xml, name), /<a:bodyPr[^>]*wrap="square"/);
});

test('editor font size export scales the entire slide and its native items together', async () => {
  const {xml, zip} = await slideXml(`<!doctype html><style>
    [data-artboard]{width:600px;height:300px;position:relative}
    p{position:absolute;top:30px;left:12px;width:240px;margin:0;font:24px/36px Arial}
  </style><main data-stage data-pptx-font-size="editor"><section data-artboard="p1">
    <p data-el="body">Editable 24 point text</p>
  </section></main>`);
  const shape = namedShape(xml, 'body');
  assert.match(shape, /sz="2400"/);
  assert.match(shape, /<a:spcPts val="3600"/);
  assert.match(shape, /<a:off x="152400" y="381000"/);
  assert.match(shape, /<a:ext cx="3048000" cy="457200"/);
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /<p:sldSz cx="7620000" cy="3810000"/);
});
