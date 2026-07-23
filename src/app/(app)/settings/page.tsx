import { auth } from "@clerk/nextjs/server";

import SettingsPageClient from "./settings-page";

export default async function SettingsPage() {
  await auth.protect();

  return <SettingsPageClient />;
}
