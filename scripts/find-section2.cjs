const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Find exact match by looking for the pattern
const startIdx = content.indexOf("activeModule === 'dashboard'");
if (startIdx >= 0) {
  // Find the KPIs grid start
  const gridIdx = content.indexOf('<div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">', startIdx);
  if (gridIdx >= 0) {
    const oldSection = content.substring(startIdx, gridIdx);
    console.log('Found section length:', oldSection.length);
    console.log('---OLD SECTION---');
    console.log(JSON.stringify(oldSection));
    console.log('---END---');
  }
}