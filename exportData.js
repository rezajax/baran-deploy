// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const https = require('https');
const path = require('path');
const FormData = require('form-data');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FILE_PATH = path.join(__dirname, 'data', 'data.json');

// Add some debugging to verify environment variables are loaded
console.log('BOT_TOKEN loaded:', BOT_TOKEN ? 'Yes' : 'No');
console.log('CHAT_ID loaded:', CHAT_ID ? 'Yes' : 'No');

function sendFile() {
    // Check if required environment variables are available
    if (!BOT_TOKEN || !CHAT_ID) {
        console.error('Missing required environment variables. Check your .env file.');
        return;
    }

    // Check if file exists
    if (!fs.existsSync(FILE_PATH)) {
        console.error('File not found:', FILE_PATH);
        return;
    }

    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('document', fs.createReadStream(FILE_PATH));

    const options = {
        method: 'POST',
        host: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendDocument`,
        headers: form.getHeaders()
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('Telegram response:', data);
            // Parse and check if successful
            try {
                const response = JSON.parse(data);
                if (response.ok) {
                    console.log('File sent successfully!');
                } else {
                    console.error('Telegram API error:', response.description);
                }
            } catch (e) {
                console.log('Raw response received');
            }
        });
    });

    req.on('error', err => console.error('Error sending file:', err));
    form.pipe(req);
}

sendFile();