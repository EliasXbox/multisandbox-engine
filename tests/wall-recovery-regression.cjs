const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),Mappings=require('../relay-server/mappings');
const config=JSON.parse(fs.readFileSync(path.join(root,'relay-server/config/world-sync.json')));config.mindustry_to_mse.flip_z=false;
class SocketServer{constructor(){this.clients=new Set();}on(){}}
const packets=[];
const sandbox={console:{log(){},warn(){},error(){}},URL,__dirname:path.join(root,'relay-server'),require(id){
    if(id==='http')return{createServer(){return{listen(){}}}};
    if(id==='fs')return{existsSync(){return false;},mkdirSync(){},writeFileSync(){},renameSync(){}};
    if(id==='path')return path;if(id==='ws')return{Server:SocketServer,OPEN:1};
    if(id==='./config/world-sync.json')return config;
    if(id.startsWith('./'))return require(path.join(root,'relay-server',id));throw Error(id);
}};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'relay-server/server.js'),'utf8')+
    '\nglobalThis.api={world,clients,httpQueues,handlePacket};',sandbox);
const api=sandbox.api;api.world.meta.world_epoch=1;
api.clients.set('MINECRAFT',{readyState:1,send(raw){packets.push(JSON.parse(raw));}});
const natural=[...Mappings.naturalWalls.values()],built=[...Mappings.blocks.values()].filter(entry=>entry.mindustry.includes('wall'));
for(const entry of [...natural,...built]){
    api.world.objects.clear();api.world.cells.clear();packets.length=0;api.httpQueues.set('MINDUSTRY',[]);
    api.handlePacket({type:'PLACE_BLOCK',game:'MINDUSTRY',block_id:entry.mindustry,x:20,y:20,solid:true,size:entry.volume.x});
    const object=[...api.world.objects.values()][0];assert.ok(object);
    assert.equal(object.volume.y,entry.volume.y);
    const rendered=packets.find(p=>p.type==='MC_SET_BLOCK');assert.equal(rendered.natural_wall,Mappings.naturalWalls.has(entry.mindustry));
    const breaking={type:'BREAK_BLOCK',game:'MINECRAFT',x:object.origin.x,z:object.origin.z,y:object.origin.y+object.volume.y-1,refund:true,player_id:'steve'};
    api.handlePacket(breaking);api.handlePacket(breaking);
    assert.equal(api.world.objects.size,0);
    const refunds=packets.filter(p=>p.type==='BUILDING_REFUND');assert.equal(refunds.length,1,entry.mindustry+' cannot drop twice');
    assert.equal(refunds[0].mindustry_block,entry.mindustry);
    api.handlePacket({type:'PLACE_BLOCK',game:'MINECRAFT',mindustry_block:entry.mindustry,block_id:entry.minecraft,x:30,z:30,y:3});
    const relocated=api.world.findAt(30,30);assert.equal(relocated.mindustry,entry.mindustry);
    assert.equal(relocated.volume.y,entry.volume.y);assert.equal(api.httpQueues.get('MINDUSTRY').at(-1).block_id,entry.mindustry);
}
assert.ok(!Mappings.naturalWalls.has('ore-wall-thorium'),'ore overlays are not solid wall items');
assert.ok(!Mappings.naturalWalls.has('remove-wall'),'editor removal tool must not become an item');
assert.equal(Mappings.blocks.size,245,'natural walls do not become manufactured survival buildings');
console.log(`PASS: ${natural.length} natural and ${built.length} built walls removed as whole volumes, refunded once and replaced with original identity.`);
