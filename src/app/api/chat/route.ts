import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
  Tool,
  UIMessage,
} from "ai";

import { customModelProvider, isToolCallUnsupportedModel } from "lib/ai/models";

import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";

import { agentRepository, chatRepository } from "lib/db/repository";
import globalLogger from "logger";
import {
  buildMcpServerCustomizationsSystemPrompt,
  buildUserSystemPrompt,
  buildToolCallUnsupportedModelSystemPrompt,
} from "lib/ai/prompts";
import {
  chatApiSchemaRequestBodySchema,
  ChatMention,
  ChatMetadata,
} from "app-types/chat";
import { DefaultToolName } from "lib/ai/tools";
import { OutlineToolOutputSchema, PlanToolOutputSchema } from "app-types/plan";
import { detectIntent } from "lib/ai/intent/detector";
import {
  OUTLINE_GENERATION_PROMPT,
  PLAN_GENERATION_PROMPT,
  validateOutline,
} from "lib/ai/prompts/plan-prompts";
import { PlanProgressTracker } from "lib/ai/plan/progress-tracker";
import { recordPlanCreated } from "lib/ai/analytics/plan-analytics";

import { errorIf, safe } from "ts-safe";

import {
  excludeToolExecution,
  handleError,
  manualToolExecuteByLastMessage,
  mergeSystemPrompt,
  extractInProgressToolPart,
  filterMcpServerCustomizations,
  loadMcpTools,
  loadWorkFlowTools,
  loadAppDefaultTools,
  convertToSavePart,
} from "./shared.chat";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "./actions";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { generateUUID } from "lib/utils";
import { nanoBananaTool, openaiImageTool } from "lib/ai/tools/image";
import { ImageToolName } from "lib/ai/tools";
import { buildCsvIngestionPreviewParts } from "@/lib/ai/ingest/csv-ingest";
import { serverFileStorage } from "lib/file-storage";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Chat API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }
    const {
      id,
      message,
      chatModel,
      toolChoice,
      allowedAppDefaultToolkit,
      allowedMcpServers,
      imageTool,
      mentions = [],
      attachments = [],
    } = chatApiSchemaRequestBodySchema.parse(json);

    const model = customModelProvider.getModel(chatModel);

    let thread = await chatRepository.selectThreadDetails(id);

    if (!thread) {
      logger.info(`create chat thread: ${id}`);
      const newThread = await chatRepository.insertThread({
        id,
        title: "",
        userId: session.user.id,
      });
      thread = await chatRepository.selectThreadDetails(newThread.id);
    }

    if (thread!.userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    const messages: UIMessage[] = (thread?.messages ?? []).map((m) => {
      const parts = m.parts.filter(
        (part): part is UIMessage["parts"][number] =>
          part.type !== "data-plan" &&
          part.type !== "data-plan-progress" &&
          part.type !== "data-outline" &&
          part.type !== "data-plan-step-output",
      );
      return {
        id: m.id,
        role: m.role,
        parts,
        metadata: m.metadata,
      };
    });

    if (messages.at(-1)?.id == message.id) {
      messages.pop();
    }
    const ingestionPreviewParts = await buildCsvIngestionPreviewParts(
      attachments,
      (key) => serverFileStorage.download(key),
    );
    if (ingestionPreviewParts.length) {
      const baseParts = [...message.parts];
      let insertionIndex = -1;
      for (let i = baseParts.length - 1; i >= 0; i -= 1) {
        if (baseParts[i]?.type === "text") {
          insertionIndex = i;
          break;
        }
      }
      if (insertionIndex !== -1) {
        baseParts.splice(insertionIndex, 0, ...ingestionPreviewParts);
        message.parts = baseParts;
      } else {
        message.parts = [...baseParts, ...ingestionPreviewParts];
      }
    }

    if (attachments.length) {
      const firstTextIndex = message.parts.findIndex(
        (part: any) => part?.type === "text",
      );
      const attachmentParts: any[] = [];

      attachments.forEach((attachment) => {
        const exists = message.parts.some(
          (part: any) =>
            part?.type === attachment.type && part?.url === attachment.url,
        );
        if (exists) return;

        if (attachment.type === "file") {
          attachmentParts.push({
            type: "file",
            url: attachment.url,
            mediaType: attachment.mediaType,
            filename: attachment.filename,
          });
        } else if (attachment.type === "source-url") {
          attachmentParts.push({
            type: "source-url",
            url: attachment.url,
            mediaType: attachment.mediaType,
            title: attachment.filename,
          });
        }
      });

      if (attachmentParts.length) {
        if (firstTextIndex >= 0) {
          message.parts = [
            ...message.parts.slice(0, firstTextIndex),
            ...attachmentParts,
            ...message.parts.slice(firstTextIndex),
          ];
        } else {
          message.parts = [...message.parts, ...attachmentParts];
        }
      }
    }

    messages.push(message);

    const supportToolCall = !isToolCallUnsupportedModel(model);

    const agentId = (
      mentions.find((m) => m.type === "agent") as Extract<
        ChatMention,
        { type: "agent" }
      >
    )?.agentId;

    const agent = await rememberAgentAction(agentId, session.user.id);

    if (agent?.instructions?.mentions) {
      mentions.push(...agent.instructions.mentions);
    }

    const useImageTool = Boolean(imageTool?.model);

    const isToolCallAllowed =
      supportToolCall &&
      (toolChoice != "none" || mentions.length > 0) &&
      !useImageTool;

    const metadata: ChatMetadata = {
      agentId: agent?.id,
      toolChoice: toolChoice,
      toolCount: 0,
      chatModel: chatModel,
    };

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const planProgressStore = new Map<
          string,
          {
            planId: string;
            steps: Array<{
              status: "pending" | "in_progress" | "completed" | "failed";
              actions?: { label: string; value?: string }[];
              startTime?: number;
              endTime?: number;
              toolCalls?: string[];
              errorMessage?: string;
            }>;
            currentStepIndex?: number;
          }
        >();
        const progressTracker = new PlanProgressTracker(
          planProgressStore,
          dataStream,
        );
        
        // Stop progress tracking when request is aborted
        if (request.signal.aborted) {
          progressTracker.stop();
        } else {
          request.signal.addEventListener("abort", () => {
            progressTracker.stop();
          }, { once: true });
        }
        
        let activePlanId: string | undefined;
        const emittedPlanIds = new Set<string>();

        const getTextDelta = (chunk: any): string | undefined => {
          if (!chunk || typeof chunk !== "object") return undefined;
          if (chunk.type === "text-delta" && typeof chunk.textDelta === "string")
            return chunk.textDelta;
          if (chunk.type === "text" && typeof chunk.text === "string") return chunk.text;
          return undefined;
        };

        const ABORT_ERROR_MESSAGE = "aborted";
        type StepRunResult = {
          status: "completed" | "aborted" | "failed";
          output?: string;
        };

        const isAborted = (): boolean =>
          request.signal.aborted;

        /**
         * @description
         * Update server-side plan progress for a single step and emit a progress part.
         * This is the authoritative step status writer for plan-mode execution.
         * GUARANTEES: Every status transition is logged and persisted.
         *
         * @param stepUpdate Plan step update payload.
         */
        const writeStepStatus = (stepUpdate: {
          planId: string;
          stepIndex: number;
          status: "in_progress" | "completed" | "failed";
          errorMessage?: string;
        }): void => {
          const current = planProgressStore.get(stepUpdate.planId);
          if (!current) {
            logger.error(`[Plan] ❌ writeStepStatus: Plan ${stepUpdate.planId} not found in store`);
            return;
          }

          // Ensure steps array is large enough with proper initialization
          while (current.steps.length <= stepUpdate.stepIndex) {
            current.steps.push({
              status: "pending",
              actions: undefined,
              startTime: undefined,
              endTime: undefined,
              toolCalls: undefined,
              errorMessage: undefined,
            });
          }

          const prev = current.steps[stepUpdate.stepIndex] ?? {
            status: "pending" as const,
            actions: undefined,
            startTime: undefined,
            endTime: undefined,
            toolCalls: undefined,
            errorMessage: undefined,
          };
          const now = Date.now();

          // Log state transition
          logger.info(`[Plan] 📊 Status transition: Step ${stepUpdate.stepIndex} ${prev.status} → ${stepUpdate.status}`);

          if (stepUpdate.status === "in_progress") {
            // Clear any other in-progress steps and reset their timing
            for (let index = 0; index < current.steps.length; index += 1) {
              if (index === stepUpdate.stepIndex) continue;
              const step = current.steps[index];
              if (!step) continue;
              if (step.status !== "in_progress") continue;
              // Only reset steps that are actually in-progress (not completed/failed)
              logger.warn(`[Plan] ⚠️ Clearing stale in-progress step ${index} when starting step ${stepUpdate.stepIndex}`);
              current.steps[index] = {
                ...step,
                status: "pending",
                startTime: undefined,
                endTime: undefined,
              };
            }
            
            // Determine start time: use previous step's endTime if available, otherwise current time
            let startTime = now;
            if (stepUpdate.stepIndex > 0) {
              const prevStep = current.steps[stepUpdate.stepIndex - 1];
              if (prevStep?.endTime) {
                startTime = prevStep.endTime;
                logger.info(`[Plan] ⏰ Step ${stepUpdate.stepIndex} inheriting endTime from step ${stepUpdate.stepIndex - 1}: ${new Date(startTime).toISOString()}`);
              }
            }
            
            current.steps[stepUpdate.stepIndex] = {
              ...prev,
              status: "in_progress",
              startTime,
              endTime: undefined,
              errorMessage: undefined, // Clear any previous error
            };
            current.currentStepIndex = stepUpdate.stepIndex;
          } else if (stepUpdate.status === "completed") {
            // Validate: can only complete if currently in-progress or pending
            if (prev.status !== "in_progress" && prev.status !== "pending") {
              logger.warn(`[Plan] ⚠️ Attempting to complete step ${stepUpdate.stepIndex} with unexpected previous status: ${prev.status}`);
            }
            
            current.steps[stepUpdate.stepIndex] = {
              ...prev,
              status: "completed",
              endTime: now,
              errorMessage: undefined,
            };
            const nextIndex =
              stepUpdate.stepIndex + 1 < current.steps.length
                ? stepUpdate.stepIndex + 1
                : undefined;
            current.currentStepIndex = nextIndex;
            
            const duration = prev.startTime ? now - prev.startTime : 0;
            logger.info(`[Plan] ✅ Step ${stepUpdate.stepIndex} completed in ${(duration / 1000).toFixed(2)}s`);
          } else {
            // Failed status
            current.steps[stepUpdate.stepIndex] = {
              ...prev,
              status: "failed",
              endTime: now,
              errorMessage: stepUpdate.errorMessage,
            };
            current.currentStepIndex = undefined;
            
            logger.error(`[Plan] ❌ Step ${stepUpdate.stepIndex} failed: ${stepUpdate.errorMessage || 'Unknown error'}`);
          }

          planProgressStore.set(stepUpdate.planId, current);
          
          // Debug logging for verification
          const step = current.steps[stepUpdate.stepIndex];
          logger.info(`[Plan] 📈 Progress update emitted: planId=${stepUpdate.planId}, step=${stepUpdate.stepIndex}/${current.steps.length}, status=${step?.status}, currentStepIndex=${current.currentStepIndex}`);
          
          dataStream.write({
            type: "data-plan-progress",
            id: stepUpdate.planId,
            data: current,
          });
        };

        const createAbortController = (): AbortController => {
          const abortController = new AbortController();
          if (request.signal.aborted) abortController.abort();
          else {
            request.signal.addEventListener("abort", () => abortController.abort(), {
              once: true,
            });
          }
          return abortController;
        };

        /**
         * @description
         * Execute a single plan step in plan-mode and emit step-bound outputs and progress.
         * Guarantees: Status will ALWAYS be updated (in_progress → completed/failed/aborted)
         * Abort/stop must immediately prevent further step execution.
         *
         * @param stepRun Step execution request.
         * @returns Step run result: completed | aborted | failed.
         */
        const runStep = async (stepRun: {
          system: string;
          tools: Record<string, Tool>;
          planId: string;
          stepIndex: number;
          emitText: boolean;
          messages: UIMessage[];
        }): Promise<StepRunResult> => {
          const stepAbort = createAbortController();
          const isStepAborted = (): boolean => stepAbort.signal.aborted || isAborted();

          // GUARANTEE: Mark step as in_progress - This ALWAYS happens first
          logger.info(`[Plan] ⏳ Step ${stepRun.stepIndex}/${planProgressStore.get(stepRun.planId)?.steps.length || '?'} starting: plan=${stepRun.planId}`);
          writeStepStatus({
            planId: stepRun.planId,
            stepIndex: stepRun.stepIndex,
            status: "in_progress",
          });

          let finalStatus: "completed" | "aborted" | "failed" = "completed";
          let finalErrorMessage: string | undefined;
          let textOutput = "";
          let fullTextAccumulator = ""; // Accumulate full text for logging/history

          try {
            const result = streamText({
              model,
              system: stepRun.system,
              messages: await convertToModelMessages(stepRun.messages),
              experimental_transform: smoothStream({ chunking: "word" }),
              maxRetries: 2,
              tools: stepRun.tools,
              toolChoice: "auto",
              abortSignal: stepAbort.signal,
            });
            result.consumeStream();

            const textBufferParts: Array<string> = [];
            const toolNameByToolCallId = new Map<string, string>();
            const writeStepOutput = (payload: {
              toolName: string;
              output: unknown;
            }): void => {
              dataStream.write({
                type: "data-plan-step-output",
                id: stepRun.planId,
                data: {
                  planId: stepRun.planId,
                  stepIndex: stepRun.stepIndex,
                  toolName: payload.toolName,
                  output: payload.output,
                },
              });
            };
            const reader = result
              .toUIMessageStream({
                messageMetadata: ({ part }) => {
                  if (part.type == "finish") {
                    metadata.usage = part.totalUsage;
                    return metadata;
                  }
                },
              })
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
                    const errorMsg = `[Plan] ⚠️ Step ${stepRun.stepIndex} attempted to call forbidden tool: ${value.toolName}`;
                    logger.warn(errorMsg);
                    finalStatus = "failed";
                    finalErrorMessage = `Forbidden tool usage: ${value.toolName} (progress is managed automatically)`;
                  }
                } else if (
                  value.type === "tool-output-available" ||
                  value.type === "tool-output-error"
                ) {
                  const isError = value.type === "tool-output-error";
                  const output = isError ? value.errorText : value.output;
                  const toolName = toolNameByToolCallId.get(value.toolCallId);
                  if (toolName) {
                    writeStepOutput({
                      toolName,
                      output: isError ? `Error: ${output}` : output,
                    });
                  }
                  if (isError) {
                    dataStream.write(value as any);
                    finalStatus = "failed";
                    finalErrorMessage = String(output);
                    logger.error(`[Plan] ❌ Step ${stepRun.stepIndex} tool error: ${finalErrorMessage}`);
                    break;
                  }
                }

                const delta = getTextDelta(value);
                if (delta !== undefined) {
                  textBufferParts.push(delta);
                  fullTextAccumulator += delta;
                  
                  // If we are not emitting text to the main stream, we should stream it as a step output
                  // to keep the Plan UI responsive.
                  if (!stepRun.emitText) {
                    // Flush buffer every 20 chars or on newlines to balance update frequency vs message part count
                    const currentBuffer = textBufferParts.join("");
                    if (currentBuffer.length > 20 || delta.includes('\n')) {
                        writeStepOutput({ toolName: "assistant", output: currentBuffer });
                        textBufferParts.length = 0; // Clear buffer
                    }
                    continue;
                  }
                }

                dataStream.write(value as any);

                if (isStepAborted()) {
                  finalStatus = "aborted";
                  finalErrorMessage = ABORT_ERROR_MESSAGE;
                  logger.warn(`[Plan] 🛑 Step ${stepRun.stepIndex} aborted by user/system`);
                  break;
                }
              }
            } finally {
              try {
                reader.releaseLock();
              } catch {}
            }

            // Flush remaining text buffer
            if (textBufferParts.length > 0 && !stepRun.emitText) {
                const remaining = textBufferParts.join("");
                if (remaining.length > 0) {
                     writeStepOutput({ toolName: "assistant", output: remaining });
                }
            }

            textOutput = fullTextAccumulator.trim();
            // Note: We don't need to write final textOutput again if we streamed it
          } catch (error) {
            // Catch any unexpected errors during execution
            finalStatus = "failed";
            finalErrorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`[Plan] 💥 Step ${stepRun.stepIndex} unexpected error:`, error);
          }

          // GUARANTEE: Status ALWAYS updated to final state
          if (finalStatus === "completed") {
            logger.info(`[Plan] ✅ Step ${stepRun.stepIndex} completed successfully (output: ${textOutput.length} chars)`);
            writeStepStatus({
              planId: stepRun.planId,
              stepIndex: stepRun.stepIndex,
              status: "completed",
            });
            // Note: We already streamed the output chunks, so no need to write it again here
            // unless we want to ensure the final block is consistent?
            // Actually, if we streamed chunks, we don't want to duplicate.
            // But if we missed anything (unlikely with finally block flushing), it might be missing.
            // Given we flush in finally, we should be good.
          } else {
            logger.warn(`[Plan] ⚠️ Step ${stepRun.stepIndex} finished with status: ${finalStatus}${finalErrorMessage ? `, error: ${finalErrorMessage}` : ''}`);
            writeStepStatus({
              planId: stepRun.planId,
              stepIndex: stepRun.stepIndex,
              status: "failed",
              errorMessage: finalErrorMessage,
            });
          }

          return { 
            status: finalStatus, 
            output: textOutput 
          };
        };

        const mcpClients = await mcpClientsManager.getClients();
        const mcpTools = await mcpClientsManager.tools();
        logger.info(
          `mcp-server count: ${mcpClients.length}, mcp-tools count :${Object.keys(mcpTools).length}`,
        );
        const MCP_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadMcpTools({
              mentions,
              allowedMcpServers,
            }),
          )
          .orElse({});

        const WORKFLOW_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadWorkFlowTools({
              mentions,
              dataStream,
            }),
          )
          .orElse({});

        const APP_DEFAULT_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadAppDefaultTools({
              mentions,
              allowedAppDefaultToolkit,
              dataStream,
              planProgressStore,
              setActivePlanId: (planId) => {
                activePlanId = planId;
              },
            }),
          )
          .orElse({});
        const inProgressToolParts = extractInProgressToolPart(message);
        if (inProgressToolParts.length) {
          await Promise.all(
            inProgressToolParts.map(async (part) => {
              const output = await manualToolExecuteByLastMessage(
                part,
                { ...MCP_TOOLS, ...WORKFLOW_TOOLS, ...APP_DEFAULT_TOOLS },
                request.signal,
              );
              part.output = output;

              dataStream.write({
                type: "tool-output-available",
                toolCallId: part.toolCallId,
                output,
              });
            }),
          );
        }

        const userPreferences = thread?.userPreferences || undefined;

        const mcpServerCustomizations = await safe()
          .map(() => {
            if (Object.keys(MCP_TOOLS ?? {}).length === 0)
              throw new Error("No tools found");
            return rememberMcpServerCustomizationsAction(session.user.id);
          })
          .map((v) => filterMcpServerCustomizations(MCP_TOOLS!, v))
          .orElse({});

        const systemPrompt = mergeSystemPrompt(
          buildUserSystemPrompt(session.user, userPreferences, agent),
          buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
          !supportToolCall && buildToolCallUnsupportedModelSystemPrompt,
        );

        const messageText = message.parts
          .filter((p): p is Extract<(typeof message.parts)[number], { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        
        // Smart intent detection with conversation history
        const conversationHistory = messages
          .slice(-5) // Last 5 messages for context
          .filter((m) => m.role === "user")
          .flatMap((m) =>
            m.parts
              .filter((p): p is Extract<typeof m.parts[number], { type: "text" }> => p.type === "text")
              .map((p) => p.text)
          );
        
        const isPlanMode = await detectIntent(model, messageText, {
          conversationHistory,
        });

        const IMAGE_TOOL: Record<string, Tool> = useImageTool
          ? {
              [ImageToolName]:
                imageTool?.model === "google"
                  ? nanoBananaTool
                  : openaiImageTool,
            }
          : {};
        const vercelAITooles = safe({
          ...MCP_TOOLS,
          ...WORKFLOW_TOOLS,
        })
          .map((t) => {
            const bindingTools =
              toolChoice === "manual" ||
              (message.metadata as ChatMetadata)?.toolChoice === "manual"
                ? excludeToolExecution(t)
                : t;
            return {
              ...bindingTools,
              ...APP_DEFAULT_TOOLS, // APP_DEFAULT_TOOLS Not Supported Manual
              ...IMAGE_TOOL,
            };
          })
          .unwrap();
        metadata.toolCount = Object.keys(vercelAITooles).length;

        const allowedMcpTools = Object.values(allowedMcpServers ?? {})
          .map((t) => t.tools)
          .flat();

        logger.info(
          `${agent ? `agent: ${agent.name}, ` : ""}tool mode: ${toolChoice}, mentions: ${mentions.length}`,
        );

        logger.info(
          `allowedMcpTools: ${allowedMcpTools.length ?? 0}, allowedAppDefaultToolkit: ${allowedAppDefaultToolkit?.length ?? 0}`,
        );
        if (useImageTool) {
          logger.info(`binding tool count Image: ${imageTool?.model}`);
        } else {
          logger.info(
            `binding tool count APP_DEFAULT: ${Object.keys(APP_DEFAULT_TOOLS ?? {}).length}, MCP: ${Object.keys(MCP_TOOLS ?? {}).length}, Workflow: ${Object.keys(WORKFLOW_TOOLS ?? {}).length}`,
          );
        }
        logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);

        const writeOutlineSnapshot = (outlineId: string, outline: any) => {
          if (emittedPlanIds.has(outlineId)) return;
          emittedPlanIds.add(outlineId);
          activePlanId = outlineId;
          const steps = (outline.steps ?? []).map(() => ({
            status: "pending" as const,
            actions: undefined,
            startTime: undefined,
            endTime: undefined,
            toolCalls: undefined,
            errorMessage: undefined,
          }));
          const snapshot = {
            planId: outlineId,
            steps,
            currentStepIndex: steps.length ? 0 : undefined,
          };
          planProgressStore.set(outlineId, snapshot);
          dataStream.write({
            type: "data-outline",
            id: outlineId,
            data: outline,
          });
          dataStream.write({
            type: "data-plan-progress",
            id: outlineId,
            data: snapshot,
          });
        };

        const writePlanSnapshot = (planId: string, plan: any) => {
          if (emittedPlanIds.has(planId)) return;
          emittedPlanIds.add(planId);
          activePlanId = planId;
          const steps = (plan.steps ?? []).map(() => ({
            status: "pending" as const,
            actions: undefined,
            startTime: undefined,
            endTime: undefined,
            toolCalls: undefined,
            errorMessage: undefined,
          }));
          const snapshot = {
            planId,
            steps,
            currentStepIndex: steps.length ? 0 : undefined,
          };
          planProgressStore.set(planId, snapshot);
          dataStream.write({
            type: "data-plan",
            id: planId,
            data: plan,
          });
          dataStream.write({
            type: "data-plan-progress",
            id: planId,
            data: snapshot,
          });
        };

        if (isPlanMode && vercelAITooles[DefaultToolName.Outline]) {
          const outlineAbort = new AbortController();
          if (request.signal.aborted) outlineAbort.abort();
          else
            request.signal.addEventListener("abort", () => outlineAbort.abort(), {
              once: true,
            });

          const outlineOnlyResult = streamText({
            model,
            system: systemPrompt + "\n\n" + OUTLINE_GENERATION_PROMPT,
            messages: await convertToModelMessages(messages),
            experimental_transform: smoothStream({ chunking: "word" }),
            maxRetries: 2,
            tools: {
              [DefaultToolName.Outline]: vercelAITooles[DefaultToolName.Outline],
            },
            stopWhen: stepCountIs(1),
            toolChoice: "auto",
            abortSignal: outlineAbort.signal,
          });
          outlineOnlyResult.consumeStream();
          const outlineReader = outlineOnlyResult.toUIMessageStream().getReader();

          let outlineId: string | undefined;
          let outlineData: unknown | undefined;
          try {
            while (true) {
              const { done, value } = await outlineReader.read();
              if (done) break;
              if (value.type !== "tool-input-available") continue;
              if (value.toolName !== DefaultToolName.Outline) continue;
              const parsed = OutlineToolOutputSchema.safeParse(value.input);
              if (!parsed.success) continue;
              outlineId = value.toolCallId;
              outlineData = parsed.data;
              outlineAbort.abort();
              break;
            }
          } finally {
            try {
              outlineReader.releaseLock();
            } catch {}
          }

          if (outlineId && outlineData) {
            // Validate outline quality
            const validation = validateOutline(outlineData);
            if (!validation.valid) {
              logger.warn(`Outline validation failed: ${validation.errors.join(", ")}`);
            }

            writeOutlineSnapshot(outlineId, outlineData);
            progressTracker.setActivePlanId(outlineId);
            activePlanId = outlineId;

            // Record analytics
            recordPlanCreated(
              outlineId,
              (outlineData as any).title || "Untitled Plan",
              (outlineData as any).steps?.length || 0
            );

            const outlineJson = JSON.stringify(outlineData);
            const {
              [DefaultToolName.Outline]: _outlineTool,
              [DefaultToolName.Progress]: _progressTool,
              ...executionTools
            } = vercelAITooles;

            const outlineSteps = Array.isArray((outlineData as any).steps)
              ? ((outlineData as any).steps as any[])
              : [];
            
            logger.info(`[Plan] Executing outline ${outlineId} with ${outlineSteps.length} steps`);
            
            // Create a mutable copy of messages for step execution
            const stepMessages = [...messages];
            
            for (let i = 0; i < outlineSteps.length; i += 1) {
              if (request.signal.aborted) {
                logger.info(`[Plan] Outline execution aborted at step ${i}`);
                return;
              }
              const step = outlineSteps[i] ?? {};
              const title =
                typeof step.title === "string" && step.title.length > 0
                  ? step.title
                  : `Step ${i}`;
              const description =
                typeof step.description === "string" ? step.description : "";
              const isLast = i === outlineSteps.length - 1;
              
              logger.info(`[Plan] Preparing step ${i}: "${title}"`);
              
              const system = [
                systemPrompt,
                `\n\n<outline id="${outlineId}">\n${outlineJson}\n</outline>\n`,
                `\n## 🔒 STEP EXECUTION MODE - MANDATORY SINGLE-STEP CONSTRAINT\n`,
                `\n### 📍 CURRENT EXECUTION SCOPE (IMMUTABLE)\n`,
                `- **Step Index**: ${i} of ${outlineSteps.length - 1}\n`,
                `- **Step Title**: ${title}\n`,
                description.length > 0 ? `- **Step Description**: ${description}\n` : "",
                `- **Status Management**: AUTOMATIC - System manages all progress tracking\n`,
                `\n### ⚠️ CRITICAL EXECUTION RULES (VIOLATION = TASK FAILURE)\n`,
                `\n**RULE 1 - SCOPE BOUNDARY (ABSOLUTE)**\n`,
                `You MUST execute ONLY the work defined in Step ${i}. Any work beyond this step's scope is FORBIDDEN.\n`,
                `- ✅ ALLOWED: Complete the specific objective of "${title}"\n`,
                `- ❌ FORBIDDEN: Any work related to Step ${i + 1} or later steps\n`,
                `- ❌ FORBIDDEN: Anticipating, preparing for, or mentioning future steps\n`,
                `\n**RULE 2 - OUTPUT BOUNDARY (ABSOLUTE)**\n`,
                isLast 
                  ? `This is the FINAL step (${i}/${outlineSteps.length - 1}). Output the complete final deliverable that fulfills the entire plan.\n`
                  : `You MUST output ONLY the artifact/result for Step ${i}. Start outputting the content immediately. Do NOT include content for Step ${i + 1} onwards.\n`,
                `\n**RULE 3 - TOOL RESTRICTION (ABSOLUTE)**\n`,
                `You are FORBIDDEN from calling these tools: outline, plan, progress.\n`,
                `Reason: Progress tracking is automatically managed by the system. Your manual status updates will cause data corruption.\n`,
                `\n**RULE 4 - TERMINATION REQUIREMENT (ABSOLUTE)**\n`,
                `You MUST stop immediately after completing Step ${i}'s work. Do NOT continue to subsequent steps.\n`,
                `IF you continue generating content for Step ${i + 1}, you will cause a SYSTEM FAILURE.\n`,
                `\n### 🛑 STOPPING INSTRUCTION\n`,
                `When you have finished the artifact for Step ${i}, you MUST stop generating text immediately. Do not write any concluding remarks or transitions to the next step.\n`,
                `The system will automatically:\n`,
                `1. Mark Step ${i} as completed\n`,
                `2. Initiate Step ${i + 1} execution in a new context\n`,
                `\n### 🎯 PRE-EXECUTION VERIFICATION\n`,
                `Before you begin, mentally confirm:\n`,
                `✓ I understand I am executing ONLY Step ${i}: "${title}"\n`,
                `✓ I will NOT produce any output related to steps ${i + 1}-${outlineSteps.length - 1}\n`,
                `✓ I will NOT call outline/plan/progress tools\n`,
                `✓ I will stop immediately when Step ${i} is complete\n`,
                `✓ The system will automatically update progress - I do not manage status\n`,
                `\n### 📋 EXECUTION PROTOCOL\n`,
                `1. Read Step ${i}'s description carefully\n`,
                `2. Execute ONLY the work required for this step\n`,
                `3. Produce the output artifact for THIS step only\n`,
                `4. Stop immediately when complete\n`,
                `5. Wait for system to initiate next step\n`,
                `\n▶️ BEGIN STEP ${i} EXECUTION NOW:\n`,
              ].join("");
              const result = await runStep({
                system,
                tools: executionTools,
                planId: outlineId,
                stepIndex: i,
                emitText: isLast,
                messages: stepMessages,
              });
              
              logger.info(`[Plan] Step ${i} result status: ${result.status}`);
              
              if (result.status !== "completed") {
                logger.warn(`[Plan] Stopping execution at step ${i} due to: ${result.status}`);
                return;
              }
              
              // Append step output to messages for next step
              if (result.output && result.output.length > 0) {
                stepMessages.push({
                  id: generateUUID(),
                  role: "assistant",
                  parts: [
                    {
                      type: "text",
                      text: result.output,
                    },
                  ],
                });
                logger.info(`[Plan] Added step ${i} output to message history (${result.output.length} chars)`);
              }
            }
            
            logger.info(`[Plan] Outline ${outlineId} execution completed successfully`);
            return;
          }
        } else if (isPlanMode && vercelAITooles[DefaultToolName.Plan]) {
          const planAbort = new AbortController();
          if (request.signal.aborted) planAbort.abort();
          else
            request.signal.addEventListener("abort", () => planAbort.abort(), {
              once: true,
            });

          const planOnlyResult = streamText({
            model,
            system: systemPrompt + "\n\n" + PLAN_GENERATION_PROMPT,
            messages: await convertToModelMessages(messages),
            experimental_transform: smoothStream({ chunking: "word" }),
            maxRetries: 2,
            tools: { [DefaultToolName.Plan]: vercelAITooles[DefaultToolName.Plan] },
            stopWhen: stepCountIs(1),
            toolChoice: "auto",
            abortSignal: planAbort.signal,
          });
          planOnlyResult.consumeStream();
          const planReader = planOnlyResult.toUIMessageStream().getReader();

          let planId: string | undefined;
          let planData: unknown | undefined;
          try {
            while (true) {
              const { done, value } = await planReader.read();
              if (done) break;
              if (value.type !== "tool-input-available") continue;
              if (value.toolName !== DefaultToolName.Plan) continue;
              const parsed = PlanToolOutputSchema.safeParse(value.input);
              if (!parsed.success) continue;
              planId = value.toolCallId;
              planData = parsed.data;
              planAbort.abort();
              break;
            }
          } finally {
            try {
              planReader.releaseLock();
            } catch {}
          }

          if (planId && planData) {
            writePlanSnapshot(planId, planData);
            progressTracker.setActivePlanId(planId);
            activePlanId = planId;

            // Record analytics
            recordPlanCreated(
              planId,
              (planData as any).title || "Untitled Plan",
              (planData as any).steps?.length || 0
            );

            const planJson = JSON.stringify(planData);
            const {
              [DefaultToolName.Plan]: _planTool,
              [DefaultToolName.Progress]: _progressTool,
              ...executionTools
            } = vercelAITooles;

            const planSteps = Array.isArray((planData as any).steps)
              ? ((planData as any).steps as any[])
              : [];
            
            logger.info(`[Plan] Executing plan ${planId} with ${planSteps.length} steps`);
            
            // Create a mutable copy of messages for step execution
            const stepMessages = [...messages];
            
            for (let i = 0; i < planSteps.length; i += 1) {
              if (request.signal.aborted) {
                logger.info(`[Plan] Plan execution aborted at step ${i}`);
                return;
              }
              const step = planSteps[i] ?? {};
              const title =
                typeof step.title === "string" && step.title.length > 0
                  ? step.title
                  : `Step ${i}`;
              const description =
                typeof step.description === "string" ? step.description : "";
              const isLast = i === planSteps.length - 1;
              
              logger.info(`[Plan] Preparing step ${i}: "${title}"`);
              
              const system = [
                systemPrompt,
                `\n\n<plan id="${planId}">\n${planJson}\n</plan>\n`,
                `\n## 🔒 STEP EXECUTION MODE - MANDATORY SINGLE-STEP CONSTRAINT\n`,
                `\n### 📍 CURRENT EXECUTION SCOPE (IMMUTABLE)\n`,
                `- **Step Index**: ${i} of ${planSteps.length - 1}\n`,
                `- **Step Title**: ${title}\n`,
                description.length > 0 ? `- **Step Description**: ${description}\n` : "",
                `- **Status Management**: AUTOMATIC - System manages all progress tracking\n`,
                `\n### ⚠️ CRITICAL EXECUTION RULES (VIOLATION = TASK FAILURE)\n`,
                `\n**RULE 1 - SCOPE BOUNDARY (ABSOLUTE)**\n`,
                `You MUST execute ONLY the work defined in Step ${i}. Any work beyond this step's scope is FORBIDDEN.\n`,
                `- ✅ ALLOWED: Complete the specific objective of "${title}"\n`,
                `- ❌ FORBIDDEN: Any work related to Step ${i + 1} or later steps\n`,
                `- ❌ FORBIDDEN: Anticipating, preparing for, or mentioning future steps\n`,
                `\n**RULE 2 - OUTPUT BOUNDARY (ABSOLUTE)**\n`,
                isLast 
                  ? `This is the FINAL step (${i}/${planSteps.length - 1}). Output the complete final deliverable that fulfills the entire plan.\n`
                  : `You MUST output ONLY the artifact/result for Step ${i}. Start outputting the content immediately. Do NOT include content for Step ${i + 1} onwards.\n`,
                `\n**RULE 3 - TOOL RESTRICTION (ABSOLUTE)**\n`,
                `You are FORBIDDEN from calling these tools: outline, plan, progress.\n`,
                `Reason: Progress tracking is automatically managed by the system. Your manual status updates will cause data corruption.\n`,
                `\n**RULE 4 - TERMINATION REQUIREMENT (ABSOLUTE)**\n`,
                `You MUST stop immediately after completing Step ${i}'s work. Do NOT continue to subsequent steps.\n`,
                `IF you continue generating content for Step ${i + 1}, you will cause a SYSTEM FAILURE.\n`,
                `\n### 🛑 STOPPING INSTRUCTION\n`,
                `When you have finished the artifact for Step ${i}, you MUST stop generating text immediately. Do not write any concluding remarks or transitions to the next step.\n`,
                `The system will automatically:\n`,
                `1. Mark Step ${i} as completed\n`,
                `2. Initiate Step ${i + 1} execution in a new context\n`,
                `\n### 🎯 PRE-EXECUTION VERIFICATION\n`,
                `Before you begin, mentally confirm:\n`,
                `✓ I understand I am executing ONLY Step ${i}: "${title}"\n`,
                `✓ I will NOT produce any output related to steps ${i + 1}-${planSteps.length - 1}\n`,
                `✓ I will NOT call outline/plan/progress tools\n`,
                `✓ I will stop immediately when Step ${i} is complete\n`,
                `✓ The system will automatically update progress - I do not manage status\n`,
                `\n### 📋 EXECUTION PROTOCOL\n`,
                `1. Read Step ${i}'s description carefully\n`,
                `2. Execute ONLY the work required for this step\n`,
                `3. Produce the output artifact for THIS step only\n`,
                `4. Stop immediately when complete\n`,
                `5. Wait for system to initiate next step\n`,
                `\n▶️ BEGIN STEP ${i} EXECUTION NOW:\n`,
              ].join("");
              const result = await runStep({
                system,
                tools: executionTools,
                planId,
                stepIndex: i,
                emitText: isLast,
                messages: stepMessages,
              });
              
              logger.info(`[Plan] Step ${i} result status: ${result.status}`);
              
              if (result.status !== "completed") {
                logger.warn(`[Plan] Stopping execution at step ${i} due to: ${result.status}`);
                return;
              }
              
              // Append step output to messages for next step
              if (result.output && result.output.length > 0) {
                stepMessages.push({
                  id: generateUUID(),
                  role: "assistant",
                  parts: [
                    {
                      type: "text",
                      text: result.output,
                    },
                  ],
                });
                logger.info(`[Plan] Added step ${i} output to message history (${result.output.length} chars)`);
              }
            }
            
            logger.info(`[Plan] Plan ${planId} execution completed successfully`);
            return;
          }
        }

        const result = streamText({
          model,
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          experimental_transform: smoothStream({ chunking: "word" }),
          maxRetries: 2,
          tools: vercelAITooles,
          stopWhen: stepCountIs(10),
          toolChoice: "auto",
          abortSignal: request.signal,
        });
        result.consumeStream();

        const uiStream = result.toUIMessageStream({
          messageMetadata: ({ part }) => {
            if (part.type == "finish") {
              metadata.usage = part.totalUsage;
              return metadata;
            }
          },
        });

        const tapped = uiStream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (chunk.type === "tool-input-available") {
                if (chunk.toolName === DefaultToolName.Plan) {
                  const parsed = PlanToolOutputSchema.safeParse(chunk.input);
                  if (parsed.success) {
                    writePlanSnapshot(chunk.toolCallId, parsed.data);
                    progressTracker.setActivePlanId(chunk.toolCallId);
                    activePlanId = chunk.toolCallId;
                  }
                }
                
                // Handle progress tracking for inline plans
                if (activePlanId) {
                  progressTracker.trackInput(
                    chunk.toolCallId,
                    chunk.toolName,
                    chunk.input,
                  );
                }
              } else if (
                chunk.type === "tool-output-available" ||
                chunk.type === "tool-output-error"
              ) {
                // Handle progress tracking for inline plans
                if (activePlanId) {
                  const isError = chunk.type === "tool-output-error";
                  const output = isError ? chunk.errorText : chunk.output;
                  progressTracker.trackOutput(
                    chunk.toolCallId,
                    output,
                    isError,
                  );
                }
              }

              controller.enqueue(chunk);
            },
          }),
        );

        dataStream.merge(tapped);
      },

      generateId: generateUUID,
      onFinish: async ({ responseMessage }) => {
        if (responseMessage.id == message.id) {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            ...responseMessage,
            parts: responseMessage.parts.map(convertToSavePart),
            metadata,
          });
        } else {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: message.role,
            parts: message.parts.map(convertToSavePart),
            id: message.id,
          });
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: responseMessage.role,
            id: responseMessage.id,
            parts: responseMessage.parts.map(convertToSavePart),
            metadata,
          });
        }

        if (agent) {
          agentRepository.updateAgent(agent.id, session.user.id, {
            updatedAt: new Date(),
          } as any);
        }
      },
      onError: handleError,
      originalMessages: messages,
    });

    return createUIMessageStreamResponse({
      stream,
    });
  } catch (error: any) {
    logger.error(error);
    return Response.json({ message: error.message }, { status: 500 });
  }
}
