// Runs once when the app starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverInterruptedTurns } = await import("./lib/agent/turn");
  await recoverInterruptedTurns().catch((e) => console.error("could not release agent locks:", (e as Error).message));
}
