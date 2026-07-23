import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="border-foreground bg-accent grid min-h-dvh place-items-center border-[12px] p-6">
      <div className="hard-shadow border-foreground bg-background border-2 p-2">
        <SignIn />
      </div>
    </main>
  );
}
