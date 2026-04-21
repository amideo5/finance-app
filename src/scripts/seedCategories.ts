import { collection, setDoc, doc } from "firebase/firestore";
import { db } from "@/src/firebaseConfig";

export const seedCategories = async () => {
  const categories = [
    { id: "food", name: "Food", type: "expense", icon: "🍽️", color: "#EF4444", parent_id: null },
    { id: "travel", name: "Travel", type: "expense", icon: "✈️", color: "#14B8A6", parent_id: null },
    { id: "rent", name: "Rent", type: "expense", icon: "🏠", color: "#F59E0B", parent_id: null },
    { id: "bills", name: "Bills", type: "expense", icon: "💡", color: "#3B82F6", parent_id: null },
    { id: "shopping", name: "Shopping", type: "expense", icon: "🛍️", color: "#8B5CF6", parent_id: null },
    { id: "health", name: "Health", type: "expense", icon: "⚕️", color: "#10B981", parent_id: null },
    { id: "entertainment", name: "Entertainment", type: "expense", icon: "🎮", color: "#EC4899", parent_id: null },
    { id: "misc", name: "Misc", type: "expense", icon: "📦", color: "#6B7280", parent_id: null },
    { id: "bike_emi", name: "Bike EMI", type: "expense", icon: "🏍️", color: "#F97316", parent_id: null },

    // income
    { id: "salary", name: "Salary", type: "income", icon: "💼", color: "#10B981", parent_id: null },
    { id: "business_income", name: "Business Income", type: "income", icon: "🏢", color: "#3B82F6", parent_id: null },
  ];

  try {
    for (const cat of categories) {
      await setDoc(doc(collection(db, "categories"), cat.id), cat);
    }
    console.log("Categories seeded successfully");
  } catch (e) {
    console.log("Error seeding categories:", e);
  }
};
