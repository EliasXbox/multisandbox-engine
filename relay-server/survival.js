// Drops depend on the canonical Mindustry identity, never on a visual material alone.
const deposits = {
    'ore-scrap': ['scrap', 'IRON_NUGGET', 0],
    'ore-copper': ['copper', 'RAW_COPPER', 2],
    'ore-lead': ['lead', 'RAW_IRON', 2],
    'ore-coal': ['coal', 'COAL', 1],
    'ore-titanium': ['titanium', 'DIAMOND', 3],
    'ore-thorium': ['thorium', 'AMETHYST_SHARD', 4],
    'ore-beryllium': ['beryllium', 'EMERALD', 3],
    'ore-tungsten': ['tungsten', 'RAW_GOLD', 3]
};
const content = require('./registry/mindustry-content.json');
const depositLayers = new Map();
const resourceDrops = {copper:['RAW_COPPER',2],lead:['RAW_IRON',2],scrap:['IRON_NUGGET',0],
    coal:['COAL',1],titanium:['DIAMOND',3],thorium:['AMETHYST_SHARD',4],beryllium:['EMERALD',3],
    tungsten:['RAW_GOLD',3],graphite:['CHARCOAL',1],sand:['SAND',0]};
for (const block of content.blocks) {
    const drop = resourceDrops[block.item_drop];
    if (drop) {
        deposits[block.name] = [block.item_drop, ...drop];
        depositLayers.set(block.name, block.overlay ? 'overlay' : block.floor ? 'floor' : 'block');
    }
}
const trees = new Set(['pine', 'snow-pine', 'spore-pine', 'white-tree', 'white-tree-dead']);
const stone = new Set(['stone', 'craters', 'shale', 'basalt', 'dacite', 'rhyolite', 'yellow-stone']);

function resourceFor(object) {
    const name = object.mindustry;
    let rule = depositLayers.get(name) === object.layer ? deposits[name] : null;
    if (object.layer === 'block' && trees.has(name)) rule = ['wood', 'OAK_LOG', 0];
    if ((object.layer === 'floor' && stone.has(name)) ||
        (object.layer === 'block' && name && name.endsWith('-wall') && stone.has(name.slice(0, -5)))) {
        rule = ['stone', 'COBBLESTONE', 1];
    }
    return rule ? { id: rule[0], material: rule[1], min_pickaxe_tier: rule[2], renewable: true,
        cooldown_ms: rule[0] === 'scrap' ? 0 : rule[2] === 0 ? 1500 : 1000 } : null;
}

function cellMetadata(object) {
    return { mindustry_block: object.mindustry, mse_layer: object.layer,
        survival_resource: resourceFor(object),
        survival_protected: object.layer !== 'block' || !!resourceFor(object) };
}

module.exports = { resourceFor, cellMetadata, trees };
