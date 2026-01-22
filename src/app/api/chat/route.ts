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
            }>;
            currentStepIndex?: number;
          }
        >();
        let activePlanId: string | undefined;
        const emittedPlanIds = new Set<string>();

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
        const forcePlanFirst = /计划|规划|plan/i.test(messageText);

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

        const toolNameByToolCallId = new Map<string, string>();
        let isExplicitPlanProgress = false;
        let stepIndexForStepOutput: number | undefined;

        if (forcePlanFirst && vercelAITooles[DefaultToolName.Outline]) {
          const outlineAbort = new AbortController();
          if (request.signal.aborted) outlineAbort.abort();
          else
            request.signal.addEventListener("abort", () => outlineAbort.abort(), {
              once: true,
            });

          const outlineOnlyResult = streamText({
            model,
            system:
              systemPrompt +
              `\n\n你必须先调用 outline 工具输出完整的大纲步骤列表，然后停止。不要在生成大纲的同时执行任何步骤。大纲只包含 title、description、steps（steps 只包含 title、description）。`,
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
            writeOutlineSnapshot(outlineId, outlineData);
            const outlineJson = JSON.stringify(outlineData);
            const { [DefaultToolName.Outline]: _outlineTool, ...executionTools } =
              vercelAITooles;

            const executionResult = streamText({
              model,
              system:
                systemPrompt +
                `\n\n<outline id="${outlineId}">\n${outlineJson}\n</outline>\n\n现在开始按该大纲逐步执行：\n- 严格按 steps 的顺序执行（从 0 到最后）\n- 每步开始前调用 update-plan-progress：{ planId:\"${outlineId}\", stepIndex:i, status:\"in_progress\", currentStepIndex:i }\n- 每步结束后调用 update-plan-progress：{ planId:\"${outlineId}\", stepIndex:i, status:\"completed\", currentStepIndex:i+1 }\n- 每步需要调用其它工具产出内容（例如搜索/HTTP/代码执行/工作流等），并让工具输出作为该步骤的详情\n- 若失败调用 status:\"failed\" 并停止继续执行\n- 不要调用 outline/plan 工具，也不要改写 steps 内容，只更新进度\n`,
              messages: await convertToModelMessages(messages),
              experimental_transform: smoothStream({ chunking: "word" }),
              maxRetries: 2,
              tools: executionTools,
              stopWhen: stepCountIs(10),
              toolChoice: "auto",
              abortSignal: request.signal,
            });
            executionResult.consumeStream();

            const uiStream = executionResult.toUIMessageStream({
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
                    toolNameByToolCallId.set(chunk.toolCallId, chunk.toolName);
                    if (chunk.toolName === DefaultToolName.UpdatePlanProgress) {
                      isExplicitPlanProgress = true;
                      const input = chunk.input as any;
                      if (typeof input?.currentStepIndex === "number") {
                        stepIndexForStepOutput = input.currentStepIndex;
                      } else if (typeof input?.stepIndex === "number") {
                        stepIndexForStepOutput = input.stepIndex;
                      }
                    } else if (!isExplicitPlanProgress && activePlanId) {
                      const current = planProgressStore.get(activePlanId);
                      if (current?.currentStepIndex !== undefined) {
                        const idx = current.currentStepIndex;
                        if (current.steps[idx]?.status === "pending") {
                          current.steps[idx] = { status: "in_progress" };
                          dataStream.write({
                            type: "data-plan-progress",
                            id: activePlanId,
                            data: current,
                          });
                        }
                      }
                    }
                  } else if (
                    chunk.type === "tool-output-available" ||
                    chunk.type === "tool-output-error"
                  ) {
                    const toolName = toolNameByToolCallId.get(chunk.toolCallId);
                    const isProgressTool =
                      toolName === DefaultToolName.UpdatePlanProgress;
                    const isOutlineOrPlanTool =
                      toolName === DefaultToolName.Outline ||
                      toolName === DefaultToolName.Plan;
                    if (!isProgressTool && !isOutlineOrPlanTool && activePlanId) {
                      const current = planProgressStore.get(activePlanId);
                      const idx =
                        stepIndexForStepOutput ?? current?.currentStepIndex;
                      if (idx !== undefined) {
                        const output =
                          (chunk as any).output ??
                          (chunk as any).error ??
                          undefined;
                        dataStream.write({
                          type: "data-plan-step-output",
                          id: activePlanId,
                          data: {
                            planId: activePlanId,
                            stepIndex: idx,
                            toolName,
                            output,
                          },
                        });
                      }
                    }
                    if (!isProgressTool && !isExplicitPlanProgress && activePlanId) {
                      const current = planProgressStore.get(activePlanId);
                      if (current?.currentStepIndex !== undefined) {
                        const idx = current.currentStepIndex;
                        const status =
                          chunk.type === "tool-output-error"
                            ? ("failed" as const)
                            : ("completed" as const);
                        current.steps[idx] = { status };
                        const nextIndex =
                          idx + 1 < current.steps.length ? idx + 1 : undefined;
                        current.currentStepIndex = nextIndex;
                        if (nextIndex !== undefined) {
                          const nextStatus = current.steps[nextIndex]?.status;
                          if (nextStatus === "pending") {
                            current.steps[nextIndex] = { status: "in_progress" };
                          }
                        }
                        dataStream.write({
                          type: "data-plan-progress",
                          id: activePlanId,
                          data: current,
                        });
                      }
                    }
                  }

                  controller.enqueue(chunk);
                },
              }),
            );

            dataStream.merge(tapped);
            return;
          }
        } else if (forcePlanFirst && vercelAITooles[DefaultToolName.Plan]) {
          const planAbort = new AbortController();
          if (request.signal.aborted) planAbort.abort();
          else
            request.signal.addEventListener("abort", () => planAbort.abort(), {
              once: true,
            });

          const planOnlyResult = streamText({
            model,
            system:
              systemPrompt +
              `\n\n你必须先调用 plan 工具输出完整的步骤列表，然后停止。不要在生成计划的同时执行任何步骤。在 plan 工具中，只生成 title 和 description，不要生成 actions。`,
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
            const planJson = JSON.stringify(planData);
            const { [DefaultToolName.Plan]: _planTool, ...executionTools } =
              vercelAITooles;

            const executionResult = streamText({
              model,
              system:
                systemPrompt +
                `\n\n<plan id="${planId}">\n${planJson}\n</plan>\n\n现在开始执行该计划：\n- 严格按 steps 的顺序执行（从 0 到最后）\n- 每步开始前调用 update-plan-progress：{ planId:\"${planId}\", stepIndex:i, status:\"in_progress\", currentStepIndex:i }\n- 每步完成后调用 update-plan-progress：{ planId:\"${planId}\", stepIndex:i, status:\"completed\", currentStepIndex:i+1 }\n- 若失败调用 status:\"failed\" 并停止继续执行\n- 不要再次调用 plan 工具，也不要改写 steps 内容，只更新进度\n`,
              messages: await convertToModelMessages(messages),
              experimental_transform: smoothStream({ chunking: "word" }),
              maxRetries: 2,
              tools: executionTools,
              stopWhen: stepCountIs(10),
              toolChoice: "auto",
              abortSignal: request.signal,
            });
            executionResult.consumeStream();

            const uiStream = executionResult.toUIMessageStream({
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
                    toolNameByToolCallId.set(chunk.toolCallId, chunk.toolName);
                    if (chunk.toolName === DefaultToolName.UpdatePlanProgress) {
                      isExplicitPlanProgress = true;
                      const input = chunk.input as any;
                      if (typeof input?.currentStepIndex === "number") {
                        stepIndexForStepOutput = input.currentStepIndex;
                      } else if (typeof input?.stepIndex === "number") {
                        stepIndexForStepOutput = input.stepIndex;
                      }
                    } else if (!isExplicitPlanProgress && activePlanId) {
                      const current = planProgressStore.get(activePlanId);
                      if (current?.currentStepIndex !== undefined) {
                        const idx = current.currentStepIndex;
                        if (current.steps[idx]?.status === "pending") {
                          current.steps[idx] = { status: "in_progress" };
                          dataStream.write({
                            type: "data-plan-progress",
                            id: activePlanId,
                            data: current,
                          });
                        }
                      }
                    }
                  } else if (
                    chunk.type === "tool-output-available" ||
                    chunk.type === "tool-output-error"
                  ) {
                    const toolName = toolNameByToolCallId.get(chunk.toolCallId);
                    const isProgressTool =
                      toolName === DefaultToolName.UpdatePlanProgress;
                    if (!isProgressTool && activePlanId) {
                      const current = planProgressStore.get(activePlanId);
                      const idx =
                        stepIndexForStepOutput ?? current?.currentStepIndex;
                      if (idx !== undefined) {
                        const output =
                          (chunk as any).output ??
                          (chunk as any).error ??
                          undefined;
                        dataStream.write({
                          type: "data-plan-step-output",
                          id: activePlanId,
                          data: {
                            planId: activePlanId,
                            stepIndex: idx,
                            toolName,
                            output,
                          },
                        });
                      }
                    }
                  }

                  controller.enqueue(chunk);
                },
              }),
            );

            dataStream.merge(tapped);
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
                toolNameByToolCallId.set(chunk.toolCallId, chunk.toolName);

                if (chunk.toolName === DefaultToolName.Plan) {
                  const parsed = PlanToolOutputSchema.safeParse(chunk.input);
                  if (parsed.success) {
                    writePlanSnapshot(chunk.toolCallId, parsed.data);
                  }
                } else if (chunk.toolName === DefaultToolName.UpdatePlanProgress) {
                  isExplicitPlanProgress = true;
                  const input = chunk.input as any;
                  if (typeof input?.currentStepIndex === "number") {
                    stepIndexForStepOutput = input.currentStepIndex;
                  } else if (typeof input?.stepIndex === "number") {
                    stepIndexForStepOutput = input.stepIndex;
                  }
                } else if (!isExplicitPlanProgress && activePlanId) {
                  const current = planProgressStore.get(activePlanId);
                  if (current?.currentStepIndex !== undefined) {
                    const idx = current.currentStepIndex;
                    if (current.steps[idx]?.status === "pending") {
                      current.steps[idx] = { status: "in_progress" };
                      dataStream.write({
                        type: "data-plan-progress",
                        id: activePlanId,
                        data: current,
                      });
                    }
                  }
                }
              } else if (
                chunk.type === "tool-output-available" ||
                chunk.type === "tool-output-error"
              ) {
                const toolName = toolNameByToolCallId.get(chunk.toolCallId);
                const isProgressTool =
                  toolName === DefaultToolName.UpdatePlanProgress;
                const isPlanTool = toolName === DefaultToolName.Plan;
                if (!isProgressTool && !isPlanTool && activePlanId) {
                  const current = planProgressStore.get(activePlanId);
                  const idx = stepIndexForStepOutput ?? current?.currentStepIndex;
                  if (idx !== undefined) {
                    const output =
                      (chunk as any).output ?? (chunk as any).error ?? undefined;
                    dataStream.write({
                      type: "data-plan-step-output",
                      id: activePlanId,
                      data: {
                        planId: activePlanId,
                        stepIndex: idx,
                        toolName,
                        output,
                      },
                    });
                  }
                }
                if (
                  !isPlanTool &&
                  !isProgressTool &&
                  !isExplicitPlanProgress &&
                  activePlanId
                ) {
                  const current = planProgressStore.get(activePlanId);
                  if (current?.currentStepIndex !== undefined) {
                    const idx = current.currentStepIndex;
                    const status =
                      chunk.type === "tool-output-error"
                        ? ("failed" as const)
                        : ("completed" as const);
                    current.steps[idx] = { status };
                    const nextIndex =
                      idx + 1 < current.steps.length ? idx + 1 : undefined;
                    current.currentStepIndex = nextIndex;
                    if (nextIndex !== undefined) {
                      const nextStatus = current.steps[nextIndex]?.status;
                      if (nextStatus === "pending") {
                        current.steps[nextIndex] = { status: "in_progress" };
                      }
                    }
                    dataStream.write({
                      type: "data-plan-progress",
                      id: activePlanId,
                      data: current,
                    });
                  }
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
