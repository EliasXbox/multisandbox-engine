const items = new Set(require('./registry/mindustry-content.json').items.map(item => item.name));
class BuildingInventory {
    constructor(world, send, enqueue) { this.world=world;this.send=send;this.enqueue=enqueue;this.pending=new Map(); }
    request(data) {
        const id=String(data.request_id || '');
        if (!/^[a-f0-9-]{36}$/i.test(id) || !['read','take','put'].includes(data.operation)) return;
        const amount=Number(data.amount);
        if (data.operation !== 'read' && (!items.has(data.resource)||!Number.isInteger(amount)||amount<1||amount>64))return;
        const actor=this.world.players.get('MINECRAFT:'+data.player_id);if(!actor)return;
        const existing=this.pending.get(id);
        if(existing){if(existing.player_id===data.player_id)this.enqueue('MINDUSTRY',existing);return;}
        const object=this.world.objects.get(data.object_id);
        const current=Number(data.world_epoch)===Number(this.world.meta.world_epoch);
        if(current && (!object || !object.inventory || this.world.snapshot ||
            Math.hypot(actor.x-Math.max(object.origin.x,Math.min(actor.x,object.origin.x+object.volume.x)),
                actor.z-Math.max(object.origin.z,Math.min(actor.z,object.origin.z+object.volume.z)))>8)) {
            this.send('MINECRAFT',{type:'BUILDING_INVENTORY_RESULT',request_id:id,player_id:data.player_id,
                object_id:data.object_id,world_epoch:data.world_epoch,accepted:0,status:'rejected',items:[]});return;
        }
        // An old request can only recover a cached receipt, never mutate a different map.
        const packet={type:'BUILDING_INVENTORY_REQUEST',request_id:id,player_id:data.player_id,
            object_id:data.object_id,world_epoch:data.world_epoch,operation:data.operation,resource:data.resource,
            amount,lookup_only:!current,x:object?.mindustry_anchor?.x,y:object?.mindustry_anchor?.y,
            block_id:object?.mindustry,team:object?.team};
        if(this.pending.size>=1024){this.send('MINECRAFT',{...packet,type:'BUILDING_INVENTORY_RESULT',accepted:0,status:'rejected',items:[]});return;}
        this.pending.set(id,packet);this.enqueue('MINDUSTRY',packet);
    }
    result(data) {
        const request=this.pending.get(data.request_id);
        if(!request || request.player_id!==data.player_id)return;
        const accepted=Number(data.accepted);
        if(!Number.isInteger(accepted)||accepted<0||accepted>request.amount)return;
        this.send('MINECRAFT',{...data,type:'BUILDING_INVENTORY_RESULT',object_id:request.object_id,
            world_epoch:request.world_epoch});
        // Keep mutation receipts until bounded expiry; repeats are still idempotent in Mindustry.
        if(request.operation==='read')this.pending.delete(data.request_id);
        else if(data.status!=='unknown')this.pending.delete(data.request_id);
    }
    configure(data) {
        const object=this.world.objects.get(data.object_id),actor=this.world.players.get('MINECRAFT:'+data.player_id);
        const entry=object && require('./mappings').blocks.get(object.mindustry);
        if(!actor||!entry?.configuration||this.world.snapshot||Number(data.world_epoch)!==Number(this.world.meta.world_epoch)||
            Math.hypot(actor.x-object.origin.x,actor.z-object.origin.z)>12)return;
        const packet={type:'BUILDING_CONFIGURE',player_id:data.player_id,block_id:object.mindustry,
            x:object.mindustry_anchor.x,y:object.mindustry_anchor.y,world_epoch:this.world.meta.world_epoch,configuration:entry.configuration};
        if(entry.configuration==='item'){
            if(data.resource!==''&&!items.has(data.resource))return;packet.resource=data.resource;
        }else{
            const target=this.world.objects.get(data.target_id);if(!target||target.team!==object.team)return;
            packet.target_x=target.mindustry_anchor.x;packet.target_y=target.mindustry_anchor.y;
        }
        this.enqueue('MINDUSTRY',packet);
    }
}
module.exports=BuildingInventory;
