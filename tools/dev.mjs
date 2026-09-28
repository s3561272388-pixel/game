import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dist = path.join(root, "dist");
const args = process.argv.slice(2),
  port = Number(args[args.indexOf("--port") + 1]) || 5173;
let revision = 0,
  timer,
  busy = false,
  pending = false;
const clients = new Set();
async function compile() {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  try {
    await import("./build.mjs?revision=" + revision++);
    clients.forEach((res) => res.write("data: reload\n\n"));
  } catch (e) {
    console.error("Build failed:", e.message);
  } finally {
    busy = false;
    if (pending) {
      pending = false;
      compile();
    }
  }
}
await compile();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === "/__reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  const target = path.resolve(
    dist,
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  if (!target.startsWith(dist + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = fs.readFileSync(target);
    if (target.endsWith(".html"))
      body = Buffer.from(
        body
          .toString()
          .replace(
            "</body>",
            () =>
              '<script>new EventSource("/__reload").onmessage=()=>location.reload()</script></body>',
          ),
      );
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Game ready: http://127.0.0.1:${port}`),
);
for (const dir of ["apps", "packages", "data", "assets"])
  fs.watch(path.join(root, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(compile, 250);
  });
