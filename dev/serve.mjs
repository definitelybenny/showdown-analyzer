// Static server for dev/out (IndexedDB is unreliable on file:// origins). Usage: node dev/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };
const port = Number(process.argv[2]) || 5179;
http.createServer((req, res) => {
	const name = path.basename(decodeURIComponent(req.url.split('?')[0])) || 'harness.html';
	const file = path.join(out, name);
	if (!fs.existsSync(file)) {
		res.writeHead(404);
		return res.end('not found');
	}
	res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
	fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/harness.html`));
