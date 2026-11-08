import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const pretextLicense = await readFile("node_modules/@chenglou/pretext/LICENSE", "utf8");
const license = await readFile("node_modules/lucide/LICENSE", "utf8");
await build({
  entryPoints: ["html-design/src/editor.js"],
  bundle: true,
  format: "iife",
  target: ["es2022"],
  outfile: "html-design/editor.js",
  loader: { ".css": "text" },
  legalComments: "none",
  charset: "utf8",
  banner: {
    js:
      "/*! html-design editor v7 · 自动生成，请修改 src/ 后运行 npm run build */\n/*! Lucide icons: " +
      license +
      " */\n/*! Pretext: " + pretextLicense + " */",
  },
});
await build({
  entryPoints: ["html-design/src/text-measure.js"], bundle: true, format: "iife", target: ["es2022"],
  outfile: "html-design/text-measure.js", legalComments: "none", charset: "utf8",
  banner: { js: "/*! Pretext: " + pretextLicense + " */" },
});
await build({entryPoints:['html-design/src/runtime-browser.js'],bundle:true,format:'iife',target:['es2022'],outfile:'html-design/runtime-browser.js',legalComments:'none',charset:'utf8'});
