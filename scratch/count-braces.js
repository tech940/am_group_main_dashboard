const fs = require('fs');

const content = fs.readFileSync('features/delegation-tasks/delegation-tasks-page.tsx', 'utf8');
const lines = content.split('\n');

let braceCount = 0;
let parenCount = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Count only outside comments and strings if possible, but keep it simple first
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '{') braceCount++;
    else if (char === '}') braceCount--;
    else if (char === '(') parenCount++;
    else if (char === ')') parenCount--;
  }
  
  if (braceCount < 0 || parenCount < 0) {
    console.log(`Unbalanced at line ${i + 1}: braces=${braceCount}, parens=${parenCount}`);
    console.log(`Content: ${line}`);
    break;
  }
}

console.log(`Final count: braces=${braceCount}, parens=${parenCount}`);
