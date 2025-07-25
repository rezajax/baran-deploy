const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ensure the data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Path to the JSON file that stores application data
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Load existing data from disk or initialize default structure
function loadData() {
  try {
    const content = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(content || '{}');
  } catch (err) {
    return { athletes: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

// Simple in-memory token for admin authentication
let adminToken = null;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mail@baranfit.ir';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'baranfit';

// Helper to send JSON responses
function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Helper to send static files
function serveStatic(filePath, res) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      // Basic MIME type handling
      const ext = path.extname(filePath).toLowerCase();
      const types = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml'
      };
      const contentType = types[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

// Generate a random token string
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Check if request is authenticated
function isAuthenticated(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length);
  return token && token === adminToken;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  // Handle API routes
  if (url.pathname.startsWith('/api')) {
    // Parse request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        body = body ? JSON.parse(body) : {};
      } catch (e) {
        body = {};
      }

      // Login endpoint
      if (method === 'POST' && url.pathname === '/api/login') {
        const { email, password } = body;
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          adminToken = generateToken();
          sendJSON(res, 200, { token: adminToken });
        } else {
          sendJSON(res, 401, { error: 'Unauthorized' });
        }
        return;
      }

      // All other endpoints require authentication
      if (!isAuthenticated(req)) {
        sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      // GET all athletes
      if (method === 'GET' && url.pathname === '/api/athletes') {
        sendJSON(res, 200, data.athletes || []);
        return;
      }

      // POST create athlete
      if (method === 'POST' && url.pathname === '/api/athletes') {
        const newAthlete = body;
        if (!newAthlete) {
          sendJSON(res, 400, { error: 'Invalid data' });
          return;
        }
        newAthlete.id = Date.now().toString();
        if (!data.athletes) data.athletes = [];
        data.athletes.push(newAthlete);
        saveData(data);
        sendJSON(res, 201, newAthlete);
        return;
      }

      // Routes for specific athlete
      const athleteMatch = url.pathname.match(/^\/api\/athletes\/([^/]+)$/);
      if (athleteMatch) {
        const athleteId = athleteMatch[1];
        const athleteIndex = (data.athletes || []).findIndex(a => a.id === athleteId);
        if (method === 'GET') {
          if (athleteIndex === -1) {
            sendJSON(res, 404, { error: 'Not found' });
          } else {
            sendJSON(res, 200, data.athletes[athleteIndex]);
          }
          return;
        }
        if (method === 'PUT') {
          if (athleteIndex === -1) {
            sendJSON(res, 404, { error: 'Not found' });
            return;
          }
          // Replace athlete with provided data except id
          const updated = body;
          updated.id = athleteId;
          data.athletes[athleteIndex] = updated;
          saveData(data);
          sendJSON(res, 200, updated);
          return;
        }
        if (method === 'DELETE') {
          if (athleteIndex === -1) {
            sendJSON(res, 404, { error: 'Not found' });
            return;
          }
          const removed = data.athletes.splice(athleteIndex, 1)[0];
          saveData(data);
          sendJSON(res, 200, { success: true, removed });
          return;
        }
      }

      // If no route matched
      sendJSON(res, 404, { error: 'Not found' });
    });
    return;
  }

  // Serve static files from public directory
  const filePath = url.pathname === '/' ? path.join(__dirname, 'public', 'index.html') : path.join(__dirname, 'public', url.pathname);
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      serveStatic(filePath, res);
    } else {
      // Fallback to index.html for SPA routes
      serveStatic(path.join(__dirname, 'public', 'index.html'), res);
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});