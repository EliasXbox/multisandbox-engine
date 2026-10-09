const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const mappings = require('../relay-server/mappings');
fs.writeFileSync(path.join(root,'clients/minecraft-bridge/src/main/resources/natural-walls.json'),
    JSON.stringify({mappings:Array.from(mappings.naturalWalls.values())},null,2)+'\n');
console.log(`Generated ${mappings.naturalWalls.size} recoverable natural walls; no terrain recipes or reverse aliases added.`);
