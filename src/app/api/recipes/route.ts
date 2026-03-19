import { NextRequest, NextResponse } from "next/server";
import { getAllRecipes, getRecipe, getRecipesForProduct } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const product = searchParams.get("product");

  if (key) {
    const recipe = getRecipe(key);
    if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    return NextResponse.json(recipe);
  }

  if (product) {
    const recipes = getRecipesForProduct(product);
    return NextResponse.json(recipes);
  }

  const recipes = getAllRecipes();
  return NextResponse.json(recipes);
}
