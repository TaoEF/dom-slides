// Copies need fresh DOM IDs as well as data-el IDs (SVG clip paths, labels, links).
export function rekeyDOMIds(tree, prefix) {
  const all = [tree, ...tree.querySelectorAll("*")],
    ids = new Map();
  for (const node of all)
    if (node.id) {
      const old = node.id;
      node.id = `${prefix}-${old}`;
      ids.set(old, node.id);
    }
  const ordered = [...ids].sort((a, b) => b[0].length - a[0].length);
  for (const node of all) {
    for (const attr of [...node.attributes]) {
      if (["id", "src", "srcset"].includes(attr.name)) continue;
      let value = attr.value;
      if (["for", "headers", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-flowto", "aria-activedescendant", "aria-details", "aria-errormessage"].includes(attr.name))
        value = value
          .split(/\s+/)
          .map((id) => ids.get(id) || id)
          .join(" ");
      for (const [before, after] of ordered) {
        value = value
          .replaceAll(`url(#${before})`, `url(#${after})`)
          .replaceAll(`url("#${before}")`, `url("#${after}")`)
          .replaceAll(`url('#${before}')`, `url('#${after}')`);
        if (value === `#${before}`) value = `#${after}`;
      }
      if (value !== attr.value) node.setAttribute(attr.name, value);
    }
    if (node.matches("style")) {
      let css = node.textContent;
      for (const [before, after] of ordered)
        css = css.replaceAll(`#${before}`, `#${after}`);
      node.textContent = css;
    }
  }
}
