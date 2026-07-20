const fs = require('fs');

const content = fs.readFileSync('features/delegation-tasks/delegation-tasks-page.tsx', 'utf8');

// Find line number for a character index
function getLineNumber(index) {
  return content.substring(0, index).split('\n').length;
}

// Find tags (multi-line supported)
const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9.-]*)(?:\s+[^>]*?)?(\/?)>/g;

let match;
const stack = [];

while ((match = tagRegex.exec(content)) !== null) {
  const fullTag = match[0];
  const name = match[1];
  const isSelfClosing = match[2] === '/';
  const isClosing = fullTag.startsWith('</');
  const index = match.index;
  const line = getLineNumber(index);
  
  // Ignore TypeScript generics like <string | null> or <T>
  if (['string', 'T', 'boolean', 'number', 'any', 'TaskRow', 'Activity', 'Assignee', 'BrandRollup'].includes(name)) {
    continue;
  }
  
  if (isSelfClosing) {
    continue;
  }
  
  if (isClosing) {
    if (stack.length === 0) {
      console.log(`Unmatched closing tag ${fullTag} at line ${line}`);
    } else {
      const top = stack.pop();
      if (top.name !== name) {
        console.log(`Mismatch at line ${line}: found ${fullTag}, expected </${top.name}> (opened at line ${top.line})`);
      }
    }
  } else {
    stack.push({ name, line, tag: fullTag });
  }
}

console.log('Done matching tags! Remaining in stack:', stack);
