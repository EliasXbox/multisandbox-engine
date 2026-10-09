const assert=require('node:assert/strict');
const Inventory=require('../relay-server/building-inventory');
const World=require('../relay-server/world-state');
const world=new World();world.meta.world_epoch=50;
world.setPlayer({id:'MINECRAFT:steve',x:3,z:3});
const object=world.createObject({id:'core',mindustry:'core-shard',x:3,z:3,y:3,inventory:true,
    mindustry_anchor:{x:3,y:3},volume:{x:3,z:3,y:2}});
const sent=[],queued=[];const inventory=new Inventory(world,(g,p)=>sent.push(p),(g,p)=>queued.push(p));
const request={request_id:'00000000-0000-0000-0000-000000000001',player_id:'steve',object_id:'core',
    operation:'take',resource:'copper',amount:4,world_epoch:50};
inventory.request(request);assert.equal(queued.length,1);
inventory.request({...request,amount:64});assert.equal(queued[1].amount,4,'retry cannot change an existing transaction');
inventory.result({...request,accepted:5});assert.equal(sent.length,0,'host cannot confirm more than reserved');
inventory.result({...request,accepted:4,status:'ok',items:[]});assert.equal(sent.at(-1).accepted,4);
world.players.get('MINECRAFT:steve').x=99;
inventory.request({...request,request_id:'00000000-0000-0000-0000-000000000002'});
assert.equal(sent.at(-1).status,'rejected');
inventory.request({...request,request_id:'00000000-0000-0000-0000-000000000003',world_epoch:49});
assert.equal(queued.at(-1).lookup_only,true,'old epoch can only recover an existing receipt');
inventory.request({...request,request_id:'00000000-0000-0000-0000-000000000004',resource:'unknown'});
assert.equal(queued.length,3,'unknown resources cannot enter the host inventory');
const catalog=require('../relay-server/registry/mindustry-content.json');
const mappings=require('../relay-server/mappings');
const resources=new Set(catalog.items.map(i=>i.name));
for(const block of catalog.blocks.filter(b=>b.buildable)){
    const entry=mappings.blocks.get(block.name);assert.ok(entry,block.name+' has a model');
    assert.equal(entry.volume.x,block.size,block.name+' retains footprint');
    assert.deepEqual(entry.requirements,block.requirements,block.name+' has exact workshop costs');
    for(const cost of entry.requirements)assert.ok(resources.has(cost.item));
}
assert.equal(mappings.blocks.size,245);
assert.equal(mappings.blocks.get('titanium-conveyor').minecraft,'minecraft:sandstone_stairs');
const Survival=require('../relay-server/survival');
assert.equal(Survival.resourceFor({mindustry:'ore-wall-tungsten',layer:'overlay'}).id,'tungsten');
assert.equal(Survival.resourceFor({mindustry:'graphitic-wall',layer:'block'}).id,'graphite');
assert.equal(Survival.resourceFor({mindustry:'graphitic-wall',layer:'block'}).min_pickaxe_tier,1,'Erekir graphite must be obtainable before iron');
console.log('PASS: inventory range, bounded confirmation, immutable retries, old-map lookup, all 245 building costs and Erekir deposits.');
