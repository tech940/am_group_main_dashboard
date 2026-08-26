const fs = require('fs');
const path = require('path');

const targetFile = path.resolve('features/kia/business-excellence-page.tsx');
const content = fs.readFileSync(targetFile, 'utf8');
const lines = content.split('\n');

const searchTerms = [
  'calculateForRows',
  'cySummary',
  'lySummary',
  'deriveExecutivePerVehicleRows',
  'deriveServiceTypeRatioRows',
  'averageBilling',
  'Others',
  'Lab / Veh',
  'lab_per_veh',
  'part_per_veh',
  'labourPerVehicle'
];

let output = `Searching in: ${targetFile}\n`;
searchTerms.forEach(term => {
  output += `\n=== Matches for "${term}" ===\n`;
  let count = 0;
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes(term.toLowerCase())) {
      count++;
      if (count <= 50) {
        output += `${index + 1}: ${line.trim()}\n`;
      }
    }
  });
  if (count > 50) {
    output += `... and ${count - 50} more matches\n`;
  }
});

fs.writeFileSync(path.resolve('scratch/search-results.txt'), output, 'utf8');
console.log('Done searching!');
