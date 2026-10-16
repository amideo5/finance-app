import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/src/constants/categories";
import { db } from "@/src/firebaseConfig";
import { doc, setDoc } from "firebase/firestore";

export const seedCategories = async () => {
  const categories = [
    ...EXPENSE_CATEGORIES.map((category) => ({ ...category, type: "expense", parent_id: null })),
    ...INCOME_CATEGORIES.map((category) => ({ ...category, type: "income", parent_id: null })),
  ];

  try {
    for (const cat of categories) {
      await setDoc(doc(db, "categories", cat.id), cat);
    }
    console.log("Categories seeded successfully");
  } catch (e) {
    console.log("Error seeding categories:", e);
  }
};
