# Satisfactory Calculator – Data Sources Research

Research on game mechanics and data sources for building a Satisfactory production calculator. Satisfactory is a factory-building game by Coffee Stain Studios where you mine resources, build production buildings (smelters, constructors, assemblers, etc.), and move items between them via conveyor belts and pipes.

---

## Core Game Mechanics (for the Calculator)

### Buildings (Input → Output)
- **Extractors**: Miners (ore), Oil Extractors, Water Extractors – produce raw resources
- **Production**: Smelter, Constructor, Assembler, Manufacturer, Foundry, Refinery, Blender, Packager, Particle Accelerator, Converter, Quantum Encoder, Nuclear Power Plant
- Each building has: inputs (1–4), outputs (1–4), cycle time (seconds), power consumption

### Transport
- **Belts**: Mk.1–Mk.6 with throughput in **items/min**
- **Pipes**: Mk.1–Mk.2 with throughput in **m³/min** (fluids)

### Belt Throughput (items/min)
| Tier | Name              | Items/min |
|------|-------------------|-----------|
| Mk.1 | Conveyor Belt     | 60        |
| Mk.2 | Conveyor Belt Mk.2| 120       |
| Mk.3 | Conveyor Belt Mk.3| 270       |
| Mk.4 | Conveyor Belt Mk.4| 480       |
| Mk.5 | Conveyor Belt Mk.5| 780       |
| Mk.6 | Conveyor Belt Mk.6| 1200      |

### Pipe Throughput (m³/min)
| Tier | Rate |
|------|------|
| Mk.1 | 300  |
| Mk.2 | 600  |

### Recipe Throughput Formula
```
items_per_minute = (quantity_per_cycle / cycle_time_seconds) × 60
```

Example: Iron Ingot (1 ore → 1 ingot, 2 s cycle) = 30 iron ingots/min per Smelter

---

## Recommended Data Sources

### 1. **KirkMcDonald/satisfactory-calculator** (Best for quick start)

**URL:** https://raw.githubusercontent.com/KirkMcDonald/satisfactory-calculator/master/data/data.json  
**License:** MIT  
**Format:** Single JSON file (≈76 KB)

**Structure:**
```json
{
  "belts": [{ "name": "Conveyor Belt", "key_name": "belt1", "rate": 60 }, ...],
  "pipes": [{ "name": "Pipeline Mk.1", "key_name": "pipe1", "rate": 300 }, ...],
  "buildings": [{ "name": "Constructor", "key_name": "constructor", "category": "crafting1", "power": 4, "max": 1 }, ...],
  "miners": [{ "name": "Miner MK1", "key_name": "miner-mk1", "base_rate": 60, "power": 5 }, ...],
  "items": [{ "name": "Iron Ore", "key_name": "iron-ore", "tier": -1, "stack_size": 100 }, ...],
  "fluids": [...],
  "recipes": [{
    "name": "Iron Ingot",
    "key_name": "iron-ingot",
    "category": "smelting1",
    "time": 2,
    "ingredients": [["iron-ore", 1]],
    "products": [["iron-ingot", 1]]
  }, ...],
  "resources": [...]
}
```

**Recipe quantities:** Per cycle. To get items/min: `(quantity / time) × 60`.

**Pros:** Ready to use, calculator-focused, belts/buildings/recipes/items in one file.  
**Cons:** Community-maintained; may lag behind game updates.

---

### 2. **Maurdekye/satisfactory_factory_planner** (Alternative recipe format)

**URL:** https://raw.githubusercontent.com/Maurdekye/satisfactory_factory_planner/master/recipes.json  
**Format:** Recipe-only JSON (≈36 KB)

**Structure:** Array of recipes with machine names and per-minute quantities:
```json
{
  "machine": "Smelter",
  "ingredients": [["Iron Ore", 30.0]],
  "products": [["Iron Ingot", 30.0]]
}
```

**Pros:** Quantities already in per-minute format; machine name included.  
**Cons:** No buildings, belts, or items; uses display names not keys.

---

### 3. **Docs.json** (Official game data – most authoritative)

**Location:** In-game install folder (not in the repo):
- Steam: `C:\Program Files\Steam\steamapps\common\Satisfactory\CommunityResources`
- Epic: `C:\Program Files\Epic Games\SatisfactoryEarlyAccess\CommunityResources`

**Content:** Class descriptors for items, equipment, fluids, buildings, recipes, schematics. Machine-readable, generated with each game build.

**Tools to use with Docs.json:**
- **@satisfactory-dev/docs.json.ts** – TypeScript schemas and types  
  https://github.com/satisfactory-dev/Docs.json.ts
- **satisfactory-docs-parser** – NPM package for parsing  
  https://github.com/lunafoxx/satisfactory-docs-parser

**Pros:** Official, always up to date with your game version.  
**Cons:** Requires game install; no license specified; schema is more complex.

---

### 4. **Official Satisfactory Wiki**

**URL:** https://satisfactory.wiki.gg  
**Use:** Reference for recipes, buildings, belts, game mechanics.  
The wiki uses Docs.json for some data; useful for manual verification.

---

### 5. **satisfactory-calculator.com (SCIM)**

**URL:** https://satisfactory-calculator.com  
**Content:** Interactive map, production planner, database (~871 recipes, 178 items, 541 buildings).  
**Data access:** No documented public API or JSON export. Use as UX reference only.

---

## What to Avoid for Static Game Data

- **ficsit.app API** – GraphQL/REST for mods and SMR (Satisfactory Mod Repository). Not a source for static recipes/belts/buildings.
- **FICSIT Remote Monitoring** – Mod that exposes *live* save data (buildings, belts, current production). Intended for monitoring, not for recipe/item databases.

---

## Suggested Approach

| Phase     | Data source                         | Rationale                              |
|----------|--------------------------------------|----------------------------------------|
| **MVP**  | KirkMcDonald `data.json`             | Single file, ready to use, MIT license. **Data targets Satisfactory 1.0** (Oct 2024) |
| **Later**| Docs.json via `@satisfactory-dev/docs.json.ts` | Official data, version-aligned   |
| **Check**| satisfactory.wiki.gg                 | Verify key numbers when in doubt       |

---

## Machine Categories (building → recipe mapping)

| Category       | Building            |
|----------------|---------------------|
| crafting1      | Constructor         |
| crafting2      | Assembler           |
| crafting3      | Manufacturer        |
| smelting1      | Smelter             |
| smelting2      | Foundry             |
| refining       | Refinery            |
| packaging      | Packager            |
| blending       | Blender             |
| accelerating   | Particle Accelerator|
| converting     | Converter           |
| encoding       | Quantum Encoder     |
| nuke-reacting  | Nuclear Power Plant |

---

## Miner/Extractor Base Rates (items or m³/min)

| Building        | Base rate | Notes              |
|-----------------|-----------|--------------------|
| Miner MK1       | 60        | Ore per min        |
| Miner MK2       | 120       |                    |
| Miner MK3       | 240       |                    |
| Oil Extractor   | 120       | m³ crude oil/min   |
| Water Extractor | 120       | m³ water/min       |

*Actual output depends on node purity (impure/normal/pure).*
