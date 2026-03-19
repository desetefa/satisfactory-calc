# Satisfactory Calculator

A production calculator for the game [Satisfactory](https://www.satisfactorygame.com/) by Coffee Stain Studios.

## Data Layer

Game data (recipes, buildings, belts, items, fluids) is **bundled as static JSON** — no external database. This works well on Vercel:

- No DB connection costs
- No cold starts for data
- Data loads at build time

**Source:** [KirkMcDonald/satisfactory-calculator](https://github.com/KirkMcDonald/satisfactory-calculator) (MIT)  
**Data version:** Satisfactory **1.0** (Oct 2024)

### Structure

```
src/
├── data/
│   └── satisfactory.json   # Raw game data
├── lib/
│   ├── types.ts             # TypeScript types
│   └── db.ts                # Lookup functions
```

### Usage

```ts
import { getRecipe, getRecipesForProduct, recipePerMinute } from "@/lib/db";

const recipe = getRecipe("iron-ingot");
const alternatives = getRecipesForProduct("iron-ingot");
const { ingredients, products } = recipePerMinute(recipe);
```

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/data` | Full database |
| `GET /api/belts` | All belt tiers |
| `GET /api/recipes` | All recipes |
| `GET /api/recipes?key=iron-ingot` | Single recipe |
| `GET /api/recipes?product=iron-ingot` | Recipes that produce an item |
| `GET /api/items` | Items + fluids |

## Development

```bash
npm install
npm run dev
```

## Deploy to Vercel

```bash
vercel
```

See [RESEARCH_SATISFACTORY_DATA_SOURCES.md](./RESEARCH_SATISFACTORY_DATA_SOURCES.md) for data sources and game mechanics.
