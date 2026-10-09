const registry = require('./registry/block-mappings.json');
const Survival = require('./survival');
const blocks = new Map(registry.mappings.map(entry => [entry.mindustry, entry]));
const naturalWalls = new Map();
const reverse = new Map();
for (const entry of registry.mappings) {
    if (entry.reverse === false) continue;
    for (const material of [entry.minecraft, ...(entry.minecraft_aliases || [])]) {
        const key = material.replace(/^minecraft:/, '').toUpperCase();
        if (!reverse.has(key)) reverse.set(key, entry);
    }
}

const floors = {
    stone: 'stone', craters: 'andesite', sand: 'sandstone', darksand: 'gray_concrete',
    dirt: 'dirt', mud: 'mud', grass: 'grass_block', moss: 'moss_block',
    'spore-moss': 'purple_terracotta', ice: 'packed_ice', snow: 'snow_block',
    salt: 'white_concrete', shale: 'deepslate', basalt: 'basalt', dacite: 'diorite',
    rhyolite: 'granite', regolith: 'brown_terracotta', 'yellow-stone': 'yellow_terracotta',
    'metal-floor': 'iron_block', 'metal-floor-damaged': 'cracked_stone_bricks'
};
const terrain = new Map(require('./registry/mindustry-content.json').blocks.map(block => [block.name,block]));
const palette = [['white_terracotta',209,178,161],['orange_terracotta',161,83,37],['magenta_terracotta',150,88,109],
    ['light_blue_terracotta',113,108,137],['yellow_terracotta',186,133,36],['lime_terracotta',103,117,52],
    ['pink_terracotta',161,78,78],['gray_terracotta',57,42,35],['light_gray_terracotta',135,107,98],
    ['cyan_terracotta',86,91,91],['purple_terracotta',118,70,86],['blue_terracotta',74,59,91],
    ['brown_terracotta',77,51,35],['green_terracotta',76,83,42],['red_terracotta',143,61,47],['black_terracotta',37,23,16]];
function terrainColor(name) {
    const color=terrain.get(name)?.color || '808080';
    const rgb=[0,2,4].map(offset=>parseInt(color.slice(offset,offset+2),16));
    return palette.reduce((best,entry)=>{
        const distance=rgb.reduce((sum,value,index)=>sum+(value-entry[index+1])**2,0);
        return distance<best.distance?{material:entry[0],distance}:best;
    },{material:'stone',distance:Infinity}).material;
}
const ores = {
    'ore-copper': 'copper_ore', 'ore-lead': 'deepslate_iron_ore', 'ore-scrap': 'iron_ore',
    'ore-coal': 'coal_ore', 'ore-titanium': 'deepslate_diamond_ore',
    'ore-thorium': 'amethyst_block', 'ore-beryllium': 'emerald_ore',
    'ore-tungsten': 'deepslate_gold_ore'
};
for (const block of require('./registry/mindustry-content.json').blocks) {
    if (block.item_drop && block.overlay) {
        ores[block.name] = ores['ore-' + block.item_drop] || (block.item_drop === 'graphite' ? 'coal_ore' : 'iron_ore');
    }
}

function resolve(data) {
    const name = String(data.block || data.block_id || 'air');
    const layer = data.layer || 'block';
    if (name === 'air' || name.startsWith('build')) return null;
    if (layer === 'block' && blocks.has(name)) return blocks.get(name);
    if (layer === 'block' && naturalWalls.has(name)) return naturalWalls.get(name);
    // Unmapped terrain and buildings retain their original semantic identity.
    // These visual fallbacks never become ambiguous reverse mappings.
    let material;
    let height = 1;
    let fluidDepth = 0;
    if (layer === 'floor') {
        material = floors[name] || terrainColor(name);
        if (data.liquid === true || /water|slag|cryofluid|arkycite|^tar$/.test(name)) {
            material = name === 'slag' ? 'lava' : 'water';
            fluidDepth = data.deep === true || name.indexOf('deep') >= 0 ? 2 : 1;
        }
    } else if (layer === 'overlay') {
        material = ores[name] || 'iron_ore';
    } else {
        material = Survival.trees.has(name) ? 'oak_log' : name.endsWith('-wall') ? (floors[name.slice(0, -5)] || 'stone') :
            data.synthetic === true ? 'light_gray_concrete' : name === 'graphitic-wall' ? 'coal_block' : terrainColor(name);
        height = Survival.trees.has(name) ? 3 : data.synthetic === true ? 1 : data.solid === true ? 4 : 1;
    }
    const size = layer === 'block' ? Math.max(1, Number(data.size || 1)) : 1;
    return { mindustry: name, minecraft: 'minecraft:' + material,
        volume: { x: size, z: size, y: height }, fluidDepth, reverse: false };
}

function normalizeAngle(angle) { return ((angle % 360) + 360) % 360; }
function transformAngle(angle, cfg = {}) {
    const radians = angle * Math.PI / 180;
    const x = Math.cos(radians) * (cfg.flip_x ? -1 : 1);
    const z = Math.sin(radians) * (cfg.flip_z ? -1 : 1);
    return normalizeAngle(Math.atan2(z, x) * 180 / Math.PI);
}

for (const block of terrain.values()) {
    if (!block.buildable && !block.synthetic && !block.floor && block.solid && block.name.includes('wall')) {
        naturalWalls.set(block.name, { ...resolve({block_id:block.name,layer:'block',solid:true,size:block.size}),
            label:block.label,natural_wall:true,env_enabled:block.env_enabled,env_disabled:block.env_disabled,
            env_required:block.env_required,requirements:[] });
    }
}
module.exports = { blocks, naturalWalls, reverse, resolve, normalizeAngle, transformAngle };
