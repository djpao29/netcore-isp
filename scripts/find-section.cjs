const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Find exact match by looking for the pattern
const startIdx = content.indexOf("activeModule === 'dashboard'");
if (startIdx >= 0) {
  // Find the end of the header section (before the KPIs grid)
  const headerEndIdx = content.indexOf("{/* 12 Primary KPIs Grid */}", startIdx);
  if (headerEndIdx >= 0) {
    const oldSection = content.substring(startIdx, headerEndIdx);
    console.log('Found section length:', oldSection.length);
    console.log('---OLD SECTION---');
    console.log(oldSection);
    console.log('---END---');
  }
}