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

console.log(`Searching in: ${targetFile}`);
searchTerms.forEach(term => {
  console.log(`\n=== Matches for "${term}" ===`);
  let count = 0;
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes(term.toLowerCase())) {
      count++;
      if (count <= 30) {
        console.log(`${index + 1}: ${line.trim()}`);
      }
    }
  });
  if (count > 30) {
    console.log(`... and ${count - 30} more matches`);
  }
});
