import json, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
path = root / 'relay-server/registry/block-mappings.json'
registry = json.loads(path.read_text(encoding='utf-8-sig'))
catalog = json.loads((path.parent / 'mindustry-content.json').read_text(encoding='utf-8-sig'))
entries = {entry['mindustry']: entry for entry in registry['mappings']}
defaults = {'turret':'dispenser','production':'polished_andesite','distribution':'smooth_stone',
 'liquid':'light_blue_terracotta','power':'copper_block','defense':'stone_bricks',
 'crafting':'blast_furnace','units':'polished_blackstone','effect':'yellow_terracotta','logic':'observer'}
stairs = {'conveyor':'stone_stairs','titanium-conveyor':'sandstone_stairs',
 'armored-conveyor':'nether_brick_stairs','plastanium-conveyor':'purpur_stairs'}
for block in catalog['blocks']:
    if not block['buildable']: continue
    name = block['name']; size = block['size']
    if name not in entries:
        height = 1 if size == 1 else min(3,size)
        material = defaults.get(block['category'], 'light_gray_concrete')
        if name.startswith('core-'): material = 'yellow_terracotta'
        if 'duct' in name: material = 'cut_copper_stairs' if block['rotate'] else 'cut_copper'
        if block['class'] in ['Conveyor','ArmoredConveyor','StackConveyor','Duct','ArmoredDuct']: material = 'cut_copper_stairs'
        if 'beam-node' in name: material = 'lightning_rod'
        if 'wall' in name: material = 'stone_bricks'; height = min(3,size)
        entries[name] = {'mindustry':name,'minecraft':'minecraft:'+material,
            'volume':{'x':size,'z':size,'y':height},'reverse':False}
    entry = entries[name]
    entry['volume']['x'] = size
    entry['volume']['z'] = size
    if name not in stairs and (block['class'] in ['Conveyor','ArmoredConveyor','StackConveyor','Duct','ArmoredDuct'] or
                              ('duct' in name and block['rotate'])):
        entry['minecraft'] = 'minecraft:cut_copper_stairs'
    entry.update(label=block['label'],category=block['category'],requirements=block['requirements'],
        has_items=block['has_items'],rotate=block['rotate'],env_enabled=block['env_enabled'],
        env_disabled=block['env_disabled'],env_required=block['env_required'])
    if block['class'] in ['Sorter','Unloader','DirectionalUnloader']: entry['configuration'] = 'item'
    if name in ['power-node','power-node-large','surge-tower','mass-driver','payload-mass-driver',
                'bridge-conveyor','phase-conveyor','bridge-conduit','phase-conduit']: entry['configuration'] = 'link'
    if name in stairs:
        aliases = entry.setdefault('minecraft_aliases',[])
        if entry['minecraft'] not in aliases: aliases.append(entry['minecraft'])
        entry['minecraft'] = 'minecraft:'+stairs[name]
registry['mappings'] = list(entries.values())
path.write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
resources = root / 'clients/minecraft-bridge/src/main/resources'
(resources/'block-mappings.json').write_text(path.read_text(encoding='utf-8'),encoding='utf-8')
(resources/'mindustry-content.json').write_text(json.dumps(catalog,ensure_ascii=False),encoding='utf-8')
print(f"Registry: {len(entries)} models, all {sum(b['buildable'] for b in catalog['blocks'])} survival buildings covered.")
