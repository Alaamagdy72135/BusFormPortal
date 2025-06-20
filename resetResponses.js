// resetResponses.js
const fs = require('fs');
const path = './data/responses.json';

fs.writeFileSync(path, JSON.stringify([], null, 2), 'utf8');
console.log('✅ responses.json has been reset.');
