import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import config from "../src/app/config/index";

const clientId = config.google_client_id;
if (!clientId || !/^[a-zA-Z0-9.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
	throw new Error("Set a valid GOOGLE_CLIENT_ID in .env before starting the test page.");
}

const html = await readFile(new URL("./google-test/index.html", import.meta.url));
const javascript = await readFile(new URL("./google-test/sign-in.js", import.meta.url));

const server = createServer((request, response) => {
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
	response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
	response.setHeader("X-Content-Type-Options", "nosniff");
	if (request.headers.host !== "localhost:3000" || request.method !== "GET") {
		response.writeHead(403).end("Open http://localhost:3000 in your browser.");
		return;
	}
	if (request.url === "/") {
		response.setHeader("Content-Type", "text/html; charset=utf-8");
		response.end(html);
	} else if (request.url === "/sign-in.js") {
		response.setHeader("Content-Type", "text/javascript; charset=utf-8");
		response.end(javascript);
	} else if (request.url === "/config") {
		response.setHeader("Content-Type", "application/json; charset=utf-8");
		// The public client ID is the only backend configuration sent to the page.
		response.end(JSON.stringify({ clientId }));
	} else {
		response.writeHead(404).end("Not found");
	}
});

server.on("error", () => {
	console.error("Cannot start the Google test page. Check whether port 3000 is already in use.");
	process.exitCode = 1;
});
server.listen(3000, "127.0.0.1", () => {
	console.info("Homi Google test page: http://localhost:3000 (Ctrl+C to stop)");
});
