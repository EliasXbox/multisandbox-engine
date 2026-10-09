import arc.Core;
import arc.Settings;
import arc.util.I18NBundle;
import mindustry.Vars;
import mindustry.core.ContentLoader;
import mindustry.core.GameState;
import mindustry.type.UnitType;
import rhino.Context;
import rhino.Scriptable;

/** Verifies the actual Mindustry/Rhino custom type bridge, using in-memory content only. */
public class ValidateSteveUnit {
    public static void main(String[] args) throws Exception {
        Vars.headless = true;
        Core.settings = new Settings(); Core.bundle = I18NBundle.createEmptyBundle();
        Vars.content = new ContentLoader(); Vars.state = new GameState();
        Vars.content.createBaseContent();
        Context context = Context.enter();
        try {
            context.setLanguageVersion(200);
            Scriptable scope = context.initStandardObjects();
            String source = java.nio.file.Files.readString(java.nio.file.Path.of(args[0]));
            String globals = "function prov(f){return new Packages.arc.func.Prov({get:f});}" +
                "function extend(Base,name,def){return new JavaAdapter(Base,def,name);}";
            int begin = source.indexOf("const minecraftPlayers");
            int end = source.indexOf("let applyingRemoteBlock", begin);
            Object result = context.evaluateString(scope, globals + source.substring(begin, end) +
                "if(steveUnitType.useUnitCap || steveUnitType.canDrown) throw new Error('unsafe type flags');" +
                "if(!steveUnitType.supportsEnv(17)) throw new Error('Steve cannot survive Erekir environment');" +
                "var unit=steveUnitType.create(Packages.mindustry.game.Team.sharded);" +
                "unit.super$controller(new JavaAdapter(Packages.mindustry.entities.units.AIController,{updateMovement:function(){},updateWeapons:function(){},updateTargeting:function(){},shouldShoot:function(){return false;}}));" +
                "if(unit.spawnedByCore || unit.maxHealth != 150 || unit.super$controller().shouldShoot()) throw new Error('incorrect unit/controller');" +
                "minecraftPlayers.test={unit:unit,armor:20,toughness:8,protection:0};" +
                "unit.rawDamage(60); if(Math.abs(unit.health - 133.2)>0.01) throw new Error('armor reduction: '+unit.health);" +
                "unit.super$rawDamage(10); if(Math.abs(unit.health - 123.2)>0.01) throw new Error('double environmental armor');" +
                "unit.health=150;unit.rawDamage(160);if(unit.dead || unit.health<80) throw new Error('armor applied after lethal damage');" +
                "'PASS: real Mindustry/Rhino custom unit creates at full health, ignores unit cap, cannot drown and has no automatic weapons.';", "steve-test", 1);
            System.out.println(Context.toString(result));
        } finally { Context.exit(); }
    }
}
