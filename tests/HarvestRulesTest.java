import com.crossplay.minecraft.HarvestRules;

class HarvestRulesTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        check(HarvestRules.canHarvest("AIR", 0), "hand collects scrap and wood");
        check(!HarvestRules.canHarvest("AIR", 1), "hand cannot mine ores");
        check(!HarvestRules.canHarvest("DIAMOND_AXE", 1), "axe is not a pickaxe");
        check(HarvestRules.canHarvest("WOODEN_PICKAXE", 1), "wood pick starts progression");
        check(!HarvestRules.canHarvest("WOODEN_PICKAXE", 2), "lead needs stone");
        check(HarvestRules.canHarvest("STONE_PICKAXE", 2), "stone unlocks lead");
        check(!HarvestRules.canHarvest("STONE_PICKAXE", 3), "titanium needs iron");
        check(!HarvestRules.canHarvest("GOLDEN_PICKAXE", 3), "gold speed does not bypass tier");
        check(HarvestRules.canHarvest("IRON_PICKAXE", 3), "iron unlocks advanced ores");
        check(!HarvestRules.canHarvest("IRON_PICKAXE", 4), "thorium needs diamond");
        check(HarvestRules.canHarvest("DIAMOND_PICKAXE", 4), "diamond unlocks thorium");
        check(HarvestRules.canHarvest("NETHERITE_PICKAXE", 4), "netherite retains progression");
        System.out.println("PASS: hand collection, pickaxe-only mining and progression tiers.");
    }
}
