import { auth } from "@clerk/nextjs/server";

import TodayPageClient from "./today-page";

export default async function TodayPage() {
  await auth.protect();

  return <TodayPageClient />;
}
