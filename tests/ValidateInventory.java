import arc.Core;
import arc.Settings;
import arc.util.I18NBundle;
import mindustry.Vars;
import mindustry.content.Blocks;
import mindustry.content.Items;
import mindustry.content.UnitTypes;
import mindustry.core.ContentLoader;
import mindustry.core.GameState;
import mindustry.core.World;
import mindustry.game.Team;
import mindustry.gen.Building;
import mindustry.gen.Groups;
import mindustry.gen.Player;
import mindustry.world.Tile;
import rhino.*;

/** Actual CoreBuild and ItemModule, in memory; no game world or settings file is written. */
public final class ValidateInventory {
    static Building building(mindustry.world.Block block,int x,int y){
        Building building=block.newBuilding().create(block,Team.sharded);building.tile=Vars.world.tile(x,y);building.tile.build=building;
        building.x=building.tile.worldx();building.y=building.tile.worldy();return building;
    }
    public static void main(String[] args) throws Exception {
        Vars.headless=true;Core.settings=new Settings(){ public void forceSave(){} };
        Core.bundle=I18NBundle.createEmptyBundle();Vars.content=new ContentLoader();Vars.state=new GameState();
        Vars.world=new World();Groups.init();Vars.content.createBaseContent();Vars.content.init();
        Vars.net=new mindustry.net.Net(null);
        Vars.world.resize(16,16);for(int x=0;x<16;x++)for(int y=0;y<16;y++)Vars.world.tiles.set(x,y,new Tile(x,y));
        Building core=Blocks.coreShard.newBuilding().create(Blocks.coreShard,Team.sharded);
        core.tile=Vars.world.tile(3,3);core.tile.build=core;core.items.add(Items.copper,10);
        ((mindustry.world.blocks.storage.CoreBlock.CoreBuild)core).storageCapacity=1024;
        Vars.player=Player.create();Vars.player.team(Team.sharded);
        Context context=Context.enter();
        try{
            context.setLanguageVersion(200);Scriptable scope=context.initStandardObjects();
            String source=java.nio.file.Files.readString(java.nio.file.Path.of(args[0]));
            int start=source.indexOf("function applyBuildingConfiguration"),end=source.indexOf("function pollEvents",start);
            if(end<0)end=source.indexOf("function pollRelay",start);
            if(end<0)throw new AssertionError("Cannot isolate inventory handler");
            String globals="var Vars=Packages.mindustry.Vars,Core=Packages.arc.Core;function cons(f){return new Packages.arc.func.Cons({get:f});}"+
                "function hostAuthority(){return true;}function mseLog(s){throw new Error(s);}var replies=[];function postEvent(p){replies.push(p);}"+
                "var worldEpoch=50,minecraftPlayers={};minecraftPlayers['MINECRAFT:test']={targetX:3,targetY:3,dead:false,unit:Packages.mindustry.content.UnitTypes.dagger.create(Packages.mindustry.game.Team.sharded)};";
            context.evaluateString(scope,globals+source.substring(start,end)+
                "function request(id,op,amount,epoch){applyInventoryRequest({request_id:id,player_id:'test',object_id:'core',world_epoch:epoch||50,x:3,y:3,block_id:'core-shard',team:1,operation:op,resource:'copper',amount:amount});}"+
                "request('00000000-0000-0000-0000-000000000001','take',4);"+
                "if(replies[0].accepted!==4)throw new Error('take did not use real inventory');"+
                "request('00000000-0000-0000-0000-000000000001','take',4);"+
                "if(Vars.world.tile(3,3).build.items.get(Packages.mindustry.content.Items.copper)!==6)throw new Error('retry took twice');"+
                "request('00000000-0000-0000-0000-000000000002','put',3);"+
                "if(replies[2].accepted!==3||Vars.world.tile(3,3).build.items.get(Packages.mindustry.content.Items.copper)!==9)throw new Error('deposit '+JSON.stringify(replies[2])+' count='+Vars.world.tile(3,3).build.items.get(Packages.mindustry.content.Items.copper));"+
                "request('00000000-0000-0000-0000-000000000003','take',64);if(replies[3].accepted!==9)throw new Error('overdraw');"+
                "request('00000000-0000-0000-0000-000000000004','put',3,49);if(replies[4].status!=='unknown')throw new Error('old map mutation');"+
                "minecraftPlayers['MINECRAFT:test'].targetX=15;request('00000000-0000-0000-0000-000000000005','take',1);if(replies[5].accepted!==0)throw new Error('remote take');"+
                "request('00000000-0000-0000-0000-000000000001','take',4,49);if(replies[6].accepted!==4)throw new Error('old receipt recovery');",
                "inventory-test",1);
            var sorter=Blocks.sorter.newBuilding().create(Blocks.sorter,Team.sharded);sorter.tile=Vars.world.tile(5,3);sorter.tile.build=sorter;
            context.evaluateString(scope,"minecraftPlayers['MINECRAFT:test'].targetX=3;"+
                "applyBuildingConfiguration({player_id:'test',x:5,y:3,block_id:'sorter',configuration:'item',resource:'copper'});"+
                "if(String(Vars.world.tile(5,3).build.sortItem.name)!=='copper')throw new Error('sorter configuration');"+
                "applyBuildingConfiguration({player_id:'test',x:5,y:3,block_id:'sorter',configuration:'item',resource:''});"+
                "if(Vars.world.tile(5,3).build.sortItem!=null)throw new Error('sorter clear');", "configuration-test",1);
            building(Blocks.massDriver,5,5);building(Blocks.massDriver,10,5);
            building(Blocks.itemBridge,5,8);building(Blocks.itemBridge,5,11);
            building(Blocks.powerNode,8,8);building(Blocks.powerNode,10,8);
            context.evaluateString(scope,
                "applyBuildingConfiguration({player_id:'test',x:5,y:5,block_id:'mass-driver',configuration:'link',target_x:10,target_y:5});"+
                "if(Vars.world.tile(5,5).build.link!==Vars.world.tile(10,5).pos())throw new Error('mass driver link');"+
                "applyBuildingConfiguration({player_id:'test',x:5,y:8,block_id:'bridge-conveyor',configuration:'link',target_x:5,target_y:11});"+
                "if(Vars.world.tile(5,8).build.link!==Vars.world.tile(5,11).pos())throw new Error('bridge link');"+
                "applyBuildingConfiguration({player_id:'test',x:8,y:8,block_id:'power-node',configuration:'link',target_x:10,target_y:8});"+
                "if(!Vars.world.tile(8,8).build.power.links.contains(Vars.world.tile(10,8).pos()))throw new Error('power link');",
                "link-test",1);
            System.out.println("PASS: real Mindustry core withdrawal/deposit, idempotent retry, partial withdrawal, map isolation and receipt recovery.");
        }finally{Context.exit();}
    }
}
