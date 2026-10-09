# Survival Foundation gameplay

## Getting started

Mindustry is the shared world's authority. Minecraft Survival gathers renewable deposits without consuming the Mindustry ore tile. Use progressively stronger pickaxes for tougher resources; scrap can be collected by hand, graphite with a wooden pickaxe, copper/lead with stone, titanium/beryllium/tungsten with iron and thorium with diamond or netherite.

Natural trees provide logs and supported rock provides cobblestone. Four scrap or four spore pods craft four oak planks. In **Erekir**, four beryllium (emeralds) craft four oak planks, and four graphite (charcoal) craft one iron ingot. Both Erekir conversions also appear in the core workshop. These processing recipes adapt gameplay rather than simulating every Mindustry industrial requirement.

## Cores, inventories and the workshop

Right-click a friendly core, drill, cultivator or another item-holding building near Steve. Click a displayed resource to withdraw one; Shift-click withdraws up to 64. Click a resource in your own inventory to deposit one, or Shift-click it to deposit the stack. The real Mindustry host validates ownership, distance, available items and capacity, then confirms the transfer.

Click the crafting-table button in a core's menu to open **MSE Workshop**. Alternatively, sneak and right-click a placed Minecraft crafting table. The arrows change pages; the middle button switches between buildings and resource processing. Each click crafts the displayed amount and consumes the listed costs. Buildings must be compatible with the current environment.

The workshop covers all 245 survival-buildable structures in the Mindustry 160.4 catalog. Common buildings also have quick adapted recipes in Minecraft's recipe book. Place the tagged **[MSE]** building item: ordinary Minecraft materials are not construction items in Survival. One item builds a complete volume, even when its model spans many blocks.

## Walls and recovery

Break any occupied cell of a manufactured building or wall to remove its whole model and receive one reusable **[MSE]** item. Natural walls also support whole-wall recovery with a suitable pickaxe. For ore-bearing walls, such as graphite walls, normal mining gathers resources; **sneak while breaking** to recover the wall itself. Ore overlays remain deposits rather than collectible wall structures.

## Direction and configuration

Conveyors use stairs to represent their direction; place them facing the intended route. Old slab aliases remain supported for compatibility.

Sneak and right-click a sorter or unloader while holding a resource to select its filter. An empty hand clears it. For supported power nodes, mass drivers and traditional bridges, sneak and right-click the source and then the target to configure a link; repeating an existing link removes it. Native range and compatibility rules still apply.

## Combat

Minecraft players have a real Mindustry unit representation. Enemy units and players can exchange damage across games; health is shared proportionally. Minecraft melee weapons and bow projectiles can hit the corresponding projections. Armor, toughness and Protection reduce damage before it reaches Steve's Mindustry unit. Mindustry controls its units, death and respawn. Dedicated MSE worlds suppress unrelated Minecraft creature spawning.

## Current limits

Campaign support is partial: Mindustry keeps objectives, research and progression. Minecraft menus cover items and the configurations above; they do not reproduce logic editors, every factory/unit control, payload interfaces or every specialized native interaction. Block models are approximations, not copies of Mindustry sprites.

Transfers use journals and idempotent receipts for ordinary reconnects. An unconfirmed transfer after a map change is preserved for recovery instead of being repeated in a different world. The two games' independent saves are not an atomic transaction during an operating-system crash. Keep backups when upgrading or testing.
