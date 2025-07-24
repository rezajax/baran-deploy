const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/*
 * A minimal HTTP server that provides a REST API for managing athletes and
 * their workout plans. Data is persisted to a JSON file on disk. No external
 * dependencies are required, ensuring the server can run in environments with
 * restricted network access. Authentication is implemented via simple bearer
 * tokens stored in memory. In a real application you would use a more
 * robust session store and secure credential management.
 */

// Location of the data file. If it doesn't exist it will be created.
const DATA_FILE = path.join(__dirname, 'data.json');

// Ensure the data file exists. If missing, initialize with an empty dataset.
function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = { athletes: [], nextId: 1 };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

// Load the dataset from disk. Synchronous read to simplify logic since Node
// handles I/O on background threads and this call only happens on startup.
function loadData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

// Save the dataset back to disk. Synchronous to avoid race conditions.
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// In-memory session store mapping tokens to session information
const sessions = {};

// Admin credentials can be configured via environment variables. Defaults are
// provided here for convenience.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test';

// Generate a random session token
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Utility: parse JSON body from a request. Returns a promise.
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Simple MIME type mapping for static file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Resolve and serve static files from the public directory. If the file
// doesn't exist, return null so that other handlers can respond.
function serveStaticFile(req, res) {
  // Only handle GET and HEAD requests for static files
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  // Prevent directory traversal
  const filePath = path.join(__dirname, 'public', decodeURIComponent(req.url.split('?')[0]));
  if (!filePath.startsWith(path.join(__dirname, 'public'))) return false;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mimeType });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      fs.createReadStream(filePath).pipe(res);
    }
    return true;
  }
  return false;
}

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(json);
}

// Authenticate requests using the Authorization header. Returns the session if
// valid or null otherwise.
function authenticate(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return sessions[token] || null;
}

// HTTP server request handler
const server = http.createServer(async (req, res) => {
  try {
    // First attempt to serve static files from the public directory
    if (serveStaticFile(req, res)) {
      return;
    }
    // Parse URL and method for routing
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;
    // API routes begin with /api
    if (url.pathname.startsWith('/api')) {
      // Login endpoint
      if (url.pathname === '/api/login' && method === 'POST') {
        const body = await parseRequestBody(req);
        const email = body.email || '';
        const password = body.password || '';
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          const token = generateToken();
          sessions[token] = { email };
          return sendJson(res, 200, { success: true, token });
        }
        return sendJson(res, 401, { success: false, message: 'Invalid credentials' });
      }
      // Logout endpoint
      if (url.pathname === '/api/logout' && method === 'POST') {
        const session = authenticate(req);
        if (session) {
          const authHeader = req.headers['authorization'];
          const token = authHeader.slice(7);
          delete sessions[token];
        }
        return sendJson(res, 200, { success: true });
      }
      // Fetch all athletes (requires auth)
      if (url.pathname === '/api/athletes' && method === 'GET') {
        const session = authenticate(req);
        if (!session) return sendJson(res, 401, { error: 'Unauthorized' });
        const data = loadData();
        const athletes = data.athletes.map(a => ({ id: a.id.toString(), name: a.name, plan: a.plan }));
        return sendJson(res, 200, athletes);
      }
      // Create a new athlete (requires auth)
      if (url.pathname === '/api/athletes' && method === 'POST') {
        const session = authenticate(req);
        if (!session) return sendJson(res, 401, { error: 'Unauthorized' });
        const body = await parseRequestBody(req);
        const { name, plan } = body;
        if (!name) return sendJson(res, 400, { error: 'Name is required' });
        const data = loadData();
        const newId = data.nextId++;
        const athlete = { id: newId, name: name, plan: plan || {} };
        data.athletes.push(athlete);
        saveData(data);
        return sendJson(res, 200, { id: newId.toString(), name: name, plan: athlete.plan });
      }
      // Handle routes with an ID parameter: /api/athletes/:id
      const idMatch = url.pathname.match(/^\/api\/athletes\/(\d+)$/);
      if (idMatch) {
        const id = parseInt(idMatch[1], 10);
        const data = loadData();
        const athleteIndex = data.athletes.findIndex(a => a.id === id);
        // GET single athlete (publicly accessible)
        if (method === 'GET') {
          if (athleteIndex === -1) return sendJson(res, 404, { error: 'Athlete not found' });
          const athlete = data.athletes[athleteIndex];
          return sendJson(res, 200, { id: athlete.id.toString(), name: athlete.name, plan: athlete.plan });
        }
        // PUT update athlete (requires auth)
        if (method === 'PUT') {
          const session = authenticate(req);
          if (!session) return sendJson(res, 401, { error: 'Unauthorized' });
          if (athleteIndex === -1) return sendJson(res, 404, { error: 'Athlete not found' });
          const body = await parseRequestBody(req);
          const { name, plan } = body;
          if (name !== undefined) data.athletes[athleteIndex].name = name;
          if (plan !== undefined) data.athletes[athleteIndex].plan = plan;
          saveData(data);
          return sendJson(res, 200, { id: id.toString(), name: data.athletes[athleteIndex].name, plan: data.athletes[athleteIndex].plan });
        }
        // DELETE athlete (requires auth)
        if (method === 'DELETE') {
          const session = authenticate(req);
          if (!session) return sendJson(res, 401, { error: 'Unauthorized' });
          if (athleteIndex === -1) return sendJson(res, 404, { error: 'Athlete not found' });
          data.athletes.splice(athleteIndex, 1);
          saveData(data);
          return sendJson(res, 200, { success: true });
        }
      }
      // Unknown API route
      return sendJson(res, 404, { error: 'Not found' });
    }
    // If not API and not a static file, always serve the main index.html (SPA fallback)
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    // If index.html is missing, return 500
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// Start listening on the configured port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});