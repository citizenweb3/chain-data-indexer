import { redirect } from "next/navigation";

// Temporary: Task 5.1 will repurpose `/` for the combined cross-chain dashboard.
export default function Home() {
  redirect("/cosmoshub/dashboard");
}
