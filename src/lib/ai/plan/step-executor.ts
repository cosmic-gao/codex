import { streamText, UIMessage, convertToModelMessages, smoothStream, LanguageModel, Tool } from "ai";
import { ProgressWriter } from "./progress-writer";
import globalLogger from "logger";

const logger = globalLogger.withDefaults({
  message: "StepExecutor",
});

type StepRunRequest = {
  system: string;
  tools: Record<string, Tool>;
  planId: string;
  stepIndex: number;
  emitText: boolean; // Whether to emit text to the main stream (usually for the last step)
  messages: UIMessage[];
  abortSignal?: AbortSignal;
};

type StepRunResult = {
  status: "completed" | "aborted" | "failed";
  output?: string;
};

export class StepExecutor {
  constructor(
    private model: LanguageModel,
    private progressWriter: ProgressWriter
  ) {}

  async runStep(request: StepRunRequest): Promise<StepRunResult> {
    const { system, tools, planId, stepIndex, emitText, messages, abortSignal } = request;

    // Create a local abort controller that can be triggered by parent signal or internal logic
    const stepAbort = new AbortController();
    if (abortSignal?.aborted) stepAbort.abort();
    else {
      abortSignal?.addEventListener("abort", () => stepAbort.abort(), { once: true });
    }

    const isStepAborted = (): boolean => stepAbort.signal.aborted;

    // GUARANTEE: Mark step as in_progress
    logger.info(`Step ${stepIndex} starting: plan=${planId}`);
    this.progressWriter.writeStepStatus({
      planId,
      stepIndex,
      status: "in_progress",
    });

    let finalStatus: "completed" | "aborted" | "failed" = "completed";
    let finalErrorMessage: string | undefined;
    let textOutput = "";
    let fullTextAccumulator = "";

    try {
      const result = streamText({
        model: this.model,
        system,
        messages: await convertToModelMessages(messages),
        experimental_transform: smoothStream({ chunking: "word" }),
        maxRetries: 2,
        tools,
        toolChoice: "auto",
        abortSignal: stepAbort.signal,
      });

      result.consumeStream();
      
      const textBufferParts: Array<string> = [];
      const toolNameByToolCallId = new Map<string, string>();
      
      const reader = result
        .toUIMessageStream()
        .getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value.type === "tool-input-available") {
            toolNameByToolCallId.set(value.toolCallId, value.toolName);
            
            // Check for forbidden tool usage
            const forbiddenTools = ["outline", "plan", "progress"];
            if (forbiddenTools.includes(value.toolName)) {
              const errorMsg = `Step ${stepIndex} attempted to call forbidden tool: ${value.toolName}`;
              logger.warn(errorMsg);
              finalStatus = "failed";
              finalErrorMessage = `Forbidden tool usage: ${value.toolName} (progress is managed automatically)`;
              stepAbort.abort();
            }
          } else if (
            value.type === "tool-output-available" ||
            value.type === "tool-output-error"
          ) {
            const isError = value.type === "tool-output-error";
            const output = isError ? value.errorText : value.output;
            const toolName = toolNameByToolCallId.get(value.toolCallId);
            
            if (toolName) {
              this.progressWriter.writeStepOutput({
                planId,
                stepIndex,
                toolName,
                output: isError ? `Error: ${output}` : output,
              });
            }

            if (isError) {
              finalStatus = "failed";
              finalErrorMessage = String(output);
              logger.error(`Step ${stepIndex} tool error: ${finalErrorMessage}`);
              stepAbort.abort();
            }
          }

          const delta = this.getTextDelta(value);
          if (delta !== undefined) {
            textBufferParts.push(delta);
            fullTextAccumulator += delta;
            
            // Logic:
            // If emitText is FALSE: Stream everything to step output (Plan UI)
            // If emitText is TRUE:  Stream to main chat (User UI) AND accumulate
            
            if (!emitText) {
              const currentBuffer = textBufferParts.join("");
              // Flush buffer periodically to step output
              if (currentBuffer.length > 20 || delta.includes('\n')) {
                  this.progressWriter.writeStepOutput({
                      planId,
                      stepIndex,
                      toolName: "assistant",
                      output: currentBuffer
                  });
                  textBufferParts.length = 0;
              }
              continue; // Don't write raw value to main stream
            }
          }

          // If we are here, we are either:
          // 1. Emitting text (emitText=true) -> Write raw value
          // 2. Processing non-text parts -> Write raw value (e.g. tool calls)
          // Note: Step output writing (above) is independent of this.
          if (emitText || value.type !== "text-delta") {
             this.progressWriter.writeRaw(value as any);
          }
          
          if (isStepAborted()) {
            finalStatus = "aborted";
            finalErrorMessage = "Aborted";
            break;
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }

      // Flush remaining text buffer for step output
      if (textBufferParts.length > 0 && !emitText) {
          const remaining = textBufferParts.join("");
          if (remaining.length > 0) {
               this.progressWriter.writeStepOutput({
                   planId,
                   stepIndex,
                   toolName: "assistant",
                   output: remaining
               });
          }
      }

      textOutput = fullTextAccumulator.trim();

    } catch (error) {
      finalStatus = "failed";
      finalErrorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Step ${stepIndex} unexpected error:`, error);
    }

    // GUARANTEE: Status ALWAYS updated to final state
    if (finalStatus === "completed") {
      this.progressWriter.writeStepStatus({
        planId,
        stepIndex,
        status: "completed",
      });
    } else {
      this.progressWriter.writeStepStatus({
        planId,
        stepIndex,
        status: "failed",
        errorMessage: finalErrorMessage,
      });
    }

    return {
      status: finalStatus,
      output: textOutput,
    };
  }

  private getTextDelta(chunk: any): string | undefined {
    if (!chunk || typeof chunk !== "object") return undefined;
    if (chunk.type === "text-delta" && typeof chunk.textDelta === "string")
      return chunk.textDelta;
    return undefined;
  }
}
