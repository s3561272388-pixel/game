import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
fs.mkdirSync("dist", { recursive: true });
// Resolve/read with Node for compatibility with restricted Windows native directory enumeration.
const resolver = {
  name: "portable-local-files",
  setup(api) {
    api.onResolve({ filter: /.*/ }, (args) => {
      const importer = args.importer || path.join(root, "package.json");
      const req = createRequire(importer);
      return { path: req.resolve(args.path), namespace: "local-source" };
    });
    api.onLoad({ filter: /.*/, namespace: "local-source" }, (args) => ({
      contents: fs.readFileSync(args.path, "utf8"),
      loader:
        { ".jsx": "jsx", ".css": "css", ".json": "json" }[
          path.extname(args.path)
        ] || "js",
    }));
  },
};
const output = await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "apps/web/launcher.jsx")],
  plugins: [resolver],
  tsconfigRaw: { compilerOptions: { jsx: "transform" } },
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  outfile: "dist/game.js",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
});
for (const file of output.outputFiles)
  fs.writeFileSync(
    path.join(root, "dist", path.basename(file.path)),
    file.contents,
  );
const js = fs.readFileSync("dist/game.js", "utf8"),
  css = fs.readFileSync("dist/game.css", "utf8");
const template = fs
  .readFileSync("index.html", "utf8")
  .replace(
    '<script type="module" src="/apps/web/launcher.jsx"></script>',
    () => "<script>" + js.replace(/<\/script/gi, "<\\/script") + "</script>",
  )
  .replace("</head>", () => "<style>" + css + "</style></head>");
fs.writeFileSync("开始游戏.html", template);
fs.writeFileSync("dist/index.html", template);
const desktop = fs.readFileSync('index.html','utf8')
  .replace('<script type="module" src="/apps/web/launcher.jsx"></script>', '<script src="game.js" defer></script>')
  .replace('</head>', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; media-src \'self\' blob:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; frame-src \'none\'"><link rel="stylesheet" href="game.css"></head>');
fs.writeFileSync('dist/desktop.html',desktop);
fs.cpSync("assets", "dist/assets", { recursive: true });
console.log("Built 开始游戏.html (double-click, no server required) and dist/");
