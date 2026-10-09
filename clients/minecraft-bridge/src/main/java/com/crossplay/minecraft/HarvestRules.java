package com.crossplay.minecraft;

/** Tool progression used by canonical resource deposits. */
public final class HarvestRules {
    private HarvestRules() {}

    public static int pickaxeTier(String tool) {
        if ("WOODEN_PICKAXE".equals(tool) || "GOLDEN_PICKAXE".equals(tool)) return 1;
        if ("STONE_PICKAXE".equals(tool)) return 2;
        if ("IRON_PICKAXE".equals(tool)) return 3;
        if ("DIAMOND_PICKAXE".equals(tool) || "NETHERITE_PICKAXE".equals(tool)) return 4;
        return 0;
    }

    // Packet tiers: 0 = hand, 1 = wood, 2 = stone, 3 = iron, 4 = diamond.
    public static boolean canHarvest(String tool, int required) {
        int tier = pickaxeTier(tool);
        return required >= 0 && required <= 4 && tier >= required;
    }
}
