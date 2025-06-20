// resetUsage.js
const fs = require('fs');
const lines = require('./public/lines.json');
const usage = {};

Object.keys(lines).forEach(line => {
  usage[line] = {
    max: 0,     // You can change default max per line here
    used: 0
  };
});

fs.writeFileSync('./data/usage.json', JSON.stringify(usage, null, 2), 'utf8');
console.log('✅ usage.json has been reset with all lines and 0 max/used.');
