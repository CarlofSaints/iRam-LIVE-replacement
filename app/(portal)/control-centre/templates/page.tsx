import { redirect } from "next/navigation";

// Templates moved to the main menu (/templates); keep old bookmarks working.
export default function OldTemplatesPage() {
  redirect("/templates");
}
