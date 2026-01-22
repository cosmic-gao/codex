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
        type StepRunResult = "completed" | "aborted" | "failed";

        const isAborted = (): boolean =>
          request.signal.aborted;

        /**
         * @description
         * Update server-side plan progress for a single step and emit a progress part.
         * This is the authoritative step status writer for plan-mode execution.
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
          if (!current) return;

          while (current.steps.length <= stepUpdate.stepIndex) {
            current.steps.push({ status: "pending" });
          }

          const prev = current.steps[stepUpdate.stepIndex] ?? { status: "pending" };
          const now = Date.now();

          if (stepUpdate.status === "in_progress") {
            for (let index = 0; index < current.steps.length; index += 1) {
              if (index === stepUpdate.stepIndex) continue;
              const step = current.steps[index];
              if (!step) continue;
              if (step.status !== "in_progress") continue;
              current.steps[index] = {
                status: "pending",
              };
            }
            current.steps[stepUpdate.stepIndex] = {
              status: "in_progress",
              startTime: now,
            };
            current.currentStepIndex = stepUpdate.stepIndex;
          } else if (stepUpdate.status === "completed") {
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
          } else {
            current.steps[stepUpdate.stepIndex] = {
              ...prev,
              status: "failed",
              endTime: now,
              errorMessage: stepUpdate.errorMessage,
            };
            current.currentStepIndex = undefined;
          }

          planProgressStore.set(stepUpdate.planId, current);
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
        }): Promise<StepRunResult> => {
          const stepAbort = createAbortController();
          const isStepAborted = (): boolean => stepAbort.signal.aborted || isAborted();

          writeStepStatus({
            planId: stepRun.planId,
            stepIndex: stepRun.stepIndex,
            status: "in_progress",
          });

          const result = streamText({
            model,
            system: stepRun.system,
            messages: await convertToModelMessages(messages),
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
                  writeStepStatus({
                    planId: stepRun.planId,
                    stepIndex: stepRun.stepIndex,
                    status: "failed",
                    errorMessage: String(output),
                  });
                  return "failed";
                }
              }

              const delta = getTextDelta(value);
              if (delta !== undefined) {
                textBufferParts.push(delta);
                if (!stepRun.emitText) {
                  continue;
                }
              }

              dataStream.write(value as any);

              if (isStepAborted()) {
                break;
              }
            }
          } finally {
            try {
              reader.releaseLock();
            } catch {}
          }

          if (isStepAborted()) {
            writeStepStatus({
              planId: stepRun.planId,
              stepIndex: stepRun.stepIndex,
              status: "failed",
              errorMessage: ABORT_ERROR_MESSAGE,
            });
            return "aborted";
          }

          const text = textBufferParts.join("").trim();
          if (text.length > 0) {
            writeStepOutput({ toolName: "assistant", output: text });
          }

          writeStepStatus({
            planId: stepRun.planId,
            stepIndex: stepRun.stepIndex,
            status: "completed",
          });
          return "completed";
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
            for (let i = 0; i < outlineSteps.length; i += 1) {
              if (request.signal.aborted) return;
              const step = outlineSteps[i] ?? {};
              const title =
                typeof step.title === "string" && step.title.length > 0
                  ? step.title
                  : `Step ${i}`;
              const description =
                typeof step.description === "string" ? step.description : "";
              const isLast = i === outlineSteps.length - 1;
              const system = [
                systemPrompt,
                `\n\n<outline id="${outlineId}">\n${outlineJson}\n</outline>\n`,
                `You are a step-execution middleware. Execute ONLY step ${i}.\n`,
                `Step title: ${title}\n`,
                description.length > 0 ? `Step description: ${description}\n` : "",
                "Rules:\n",
                "- Your output MUST correspond strictly to this step only.\n",
                "- Do not include work from other steps, even if it seems helpful.\n",
                "- Do not reference future steps or start the next step.\n",
                "- Do not revise the plan.\n",
                "- If the step requests a specific artifact (file, snippet, payload), output only that artifact.\n",
                "- Do not call outline/plan/progress tools.\n",
                isLast
                  ? "- This is the final step. Produce the final deliverable in full.\n"
                  : "- This is not the final step. Produce only the artifact for this step.\n",
                "- Stop when the step output is complete.\n",
              ].join("");
              const result = await runStep({
                system,
                tools: executionTools,
                planId: outlineId,
                stepIndex: i,
                emitText: isLast,
              });
              if (result !== "completed") return;
            }
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
            for (let i = 0; i < planSteps.length; i += 1) {
              if (request.signal.aborted) return;
              const step = planSteps[i] ?? {};
              const title =
                typeof step.title === "string" && step.title.length > 0
                  ? step.title
                  : `Step ${i}`;
              const description =
                typeof step.description === "string" ? step.description : "";
              const isLast = i === planSteps.length - 1;
              const system = [
                systemPrompt,
                `\n\n<plan id="${planId}">\n${planJson}\n</plan>\n`,
                `You are a step-execution middleware. Execute ONLY step ${i}.\n`,
                `Step title: ${title}\n`,
                description.length > 0 ? `Step description: ${description}\n` : "",
                "Rules:\n",
                "- Your output MUST correspond strictly to this step only.\n",
                "- Do not include work from other steps, even if it seems helpful.\n",
                "- Do not reference future steps or start the next step.\n",
                "- Do not revise the plan.\n",
                "- If the step requests a specific artifact (file, snippet, payload), output only that artifact.\n",
                "- Do not call outline/plan/progress tools.\n",
                isLast
                  ? "- This is the final step. Produce the final deliverable in full.\n"
                  : "- This is not the final step. Produce only the artifact for this step.\n",
                "- Stop when the step output is complete.\n",
              ].join("");
              const result = await runStep({
                system,
                tools: executionTools,
                planId,
                stepIndex: i,
                emitText: isLast,
              });
              if (result !== "completed") return;
            }
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
