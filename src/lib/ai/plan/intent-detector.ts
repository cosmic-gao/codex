import { detectIntent } from "lib/ai/intent/detector";
import { UIMessage, LanguageModel } from "ai";

/**
 * Detects if the user's intent requires a plan based on the message and history.
 * 
 * @param model - The language model to use for detection
 * @param messageText - The current user message
 * @param messages - The full message history
 * @returns Promise resolving to true if plan mode is required
 */
export async function detectPlanIntent(
  model: LanguageModel,
  messageText: string,
  messages: UIMessage[]
): Promise<boolean> {
  // Construct conversation history context
  const conversationHistory = messages
    .slice(-5) // Last 5 messages for context
    .filter((m) => m.role === "user")
    .flatMap((m) =>
      m.parts
        .filter((p): p is Extract<typeof m.parts[number], { type: "text" }> => p.type === "text")
        .map((p) => p.text)
    );

  return await detectIntent(model, messageText, {
    conversationHistory,
  });
}
