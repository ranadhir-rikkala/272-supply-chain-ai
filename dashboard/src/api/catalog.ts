export const CATEGORIES: { code: string; name: string }[] = [
  { code: "BEV", name: "Beverages" },
  { code: "SNK", name: "Snacks" },
  { code: "DAI", name: "Dairy" },
  { code: "FRZ", name: "Frozen" },
  { code: "PCR", name: "Personal Care" },
  { code: "HHC", name: "Household Cleaning" },
  { code: "PAP", name: "Paper Goods" },
  { code: "ELE", name: "Small Electronics" },
  { code: "PHA", name: "Phone Accessories" },
  { code: "OUT", name: "Outdoor & Summer" },
  { code: "WIN", name: "Winter" },
  { code: "SCH", name: "School & Office" },
];

export function categoryName(code: string): string {
  return CATEGORIES.find((c) => c.code === code)?.name ?? code;
}
