import { streamText, stepCountIs, UIMessage, convertToModelMessages, smoothStream, LanguageModel, Tool } from "ai";
import { DefaultToolName } from "lib/ai/tools";
import { OutlineToolOutputSchema } from "app-types/plan";
import { OUTLINE_GENERATION_PROMPT, validateOutline } from "lib/ai/tools/planning/outline";
import { ProgressWriter } from "./progress-writer";
import { recordPlanCreated } from "lib/ai/analytics/plan-analytics";
import globalLogger from "logger";

const logger = globalLogger.withDefaults({
  message: "OutlineRunner",
});

export class OutlineRunner {
  constructor(
    private model: LanguageModel,
    private progressWriter: ProgressWriter
  ) {}

  /**
   * Generates an outline, validates it, and writes the snapshot.
   * 
   * @returns The generated outline ID and data, or undefined if generation failed.
   */
  async generateAndSnapshot(
    messages: UIMessage[],
    systemPrompt: string,
    tools: Record<string, Tool>,
    abortSignal?: AbortSignal
  ): Promise<{ outlineId: string; outlineData: any } | undefined> {
    const outlineTool = tools[DefaultToolName.Outline];
    if (!outlineTool) {
      logger.error("Outline tool not found in provided tools");
      return undefined;
    }

    const outlineAbort = new AbortController();
    if (abortSignal?.aborted) outlineAbort.abort();
    else {
      abortSignal?.addEventListener("abort", () => outlineAbort.abort(), { once: true });
    }

    try {
      const result = streamText({
        model: this.model,
        system: systemPrompt + "\n\n" + OUTLINE_GENERATION_PROMPT,
        messages: await convertToModelMessages(messages),
        experimental_transform: smoothStream({ chunking: "word" }),
        maxRetries: 2,
        tools: {
          [DefaultToolName.Outline]: outlineTool,
        },
        stopWhen: stepCountIs(1),
        toolChoice: "auto", // Or 'required' if supported
        abortSignal: outlineAbort.signal,
      });

      result.consumeStream();
      const reader = result.toUIMessageStream().getReader();

      let outlineId: string | undefined;
      let outlineData: unknown | undefined;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type !== "tool-input-available") continue;
          if (value.toolName !== DefaultToolName.Outline) continue;
          
          const parsed = OutlineToolOutputSchema.safeParse(value.input);
          if (!parsed.success) {
            logger.warn(`Failed to parse outline output: ${parsed.error}`);
            continue;
          }
          
          outlineId = value.toolCallId;
          outlineData = parsed.data;
          // We found what we needed, stop the stream
          outlineAbort.abort();
          break;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }

      if (outlineId && outlineData) {
        // Validate outline quality
        const validation = validateOutline(outlineData as any);
        if (!validation.valid) {
          logger.warn(`Outline validation failed: ${validation.errors.join(", ")}`);
          // We could choose to reject here, but for now we log and proceed
        }

        // Write snapshot
        this.progressWriter.writeSnapshot(outlineId, outlineData, "data-outline");

        // Record analytics
        recordPlanCreated(
          outlineId,
          (outlineData as any).title || "Untitled Plan",
          (outlineData as any).steps?.length || 0
        );

        return { outlineId, outlineData };
      }

      return undefined;

    } catch (error) {
      logger.error("Error generating outline:", error);
      return undefined;
    }
  }
}
