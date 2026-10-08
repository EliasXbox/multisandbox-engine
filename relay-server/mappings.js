const registry = require('./registry/block-mappings.json');
const blocks = new Map(registry.mappings.map(entry => [entry.mindustry, entry]));
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
const ores = {
    'ore-copper': 'copper_ore', 'ore-lead': 'deepslate_iron_ore', 'ore-scrap': 'iron_ore',
    'ore-coal': 'coal_ore', 'ore-titanium': 'deepslate_diamond_ore',
    'ore-thorium': 'amethyst_block', 'ore-beryllium': 'emerald_ore',
    'ore-tungsten': 'deepslate_gold_ore'
};

function resolve(data) {
    const name = String(data.block || data.block_id || 'air');
    const layer = data.layer || 'block';
    if (name === 'air' || name.startsWith('build')) return null;
    if (layer === 'block' && blocks.has(name)) return blocks.get(name);
    // Unmapped terrain and buildings retain their original semantic identity.
    // These visual fallbacks never become ambiguous reverse mappings.
    let material;
    let height = 1;
    let fluidDepth = 0;
    if (layer === 'floor') {
        material = floors[name] || 'stone';
        if (data.liquid === true || /water|slag|cryofluid|arkycite|^tar$/.test(name)) {
            material = name === 'slag' ? 'lava' : 'water';
            fluidDepth = data.deep === true || name.indexOf('deep') >= 0 ? 2 : 1;
        }
    } else if (layer === 'overlay') {
        material = ores[name] || 'iron_ore';
    } else {
        material = name.endsWith('-wall') ? (floors[name.slice(0, -5)] || 'stone') :
            data.synthetic === true ? 'light_gray_concrete' : 'moss_block';
        height = data.synthetic === true ? 1 : data.solid === true ? 4 : 1;
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

module.exports = { blocks, reverse, resolve, normalizeAngle, transformAngle };
