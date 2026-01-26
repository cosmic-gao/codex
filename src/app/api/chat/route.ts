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
import { detectPlanIntent } from "lib/ai/plan/intent-detector";
import { OutlineRunner } from "lib/ai/plan/outline-runner";
import { StepExecutor } from "lib/ai/plan/step-executor";
import { ProgressWriter } from "lib/ai/plan/progress-writer";
import { PlanToolOutputSchema } from "app-types/plan";

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
        // Initialize Progress Store and Writer
        const planProgressStore = new Map();
        const progressWriter = new ProgressWriter(planProgressStore, dataStream);

        // Initialize Executors
        const outlineRunner = new OutlineRunner(model, progressWriter);
        const stepExecutor = new StepExecutor(model, progressWriter);
        
        // Stop signals
        if (request.signal.aborted) {
          // No explicit stop needed for writer, but we can check signal in loops
        }

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
                 // No-op for now as we don't use PlanProgressTracker
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
        
        // Detect Plan Intent
        const isPlanMode = await detectPlanIntent(model, messageText, messages);

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

        // --- PLAN EXECUTION FLOW ---
        if (isPlanMode && vercelAITooles[DefaultToolName.Outline]) {
          const result = await outlineRunner.generateAndSnapshot(
            messages,
            systemPrompt,
            { [DefaultToolName.Outline]: vercelAITooles[DefaultToolName.Outline] },
            request.signal
          );

          if (result) {
            const { outlineId, outlineData } = result;
            const outlineSteps = Array.isArray((outlineData as any).steps)
              ? ((outlineData as any).steps as any[])
              : [];
            
            logger.info(`[Plan] Executing outline ${outlineId} with ${outlineSteps.length} steps`);
            
            const {
              [DefaultToolName.Outline]: _outlineTool,
              [DefaultToolName.Plan]: _planTool,
              [DefaultToolName.Progress]: _progressTool,
              ...executionTools
            } = vercelAITooles;

            // Create a mutable copy of messages for step execution
            const stepMessages = [...messages];
            const outlineJson = JSON.stringify(outlineData);

            for (let i = 0; i < outlineSteps.length; i += 1) {
              if (request.signal.aborted) {
                logger.info(`[Plan] Outline execution aborted at step ${i}`);
                return;
              }
              
              const step = outlineSteps[i] ?? {};
              const title = typeof step.title === "string" && step.title.length > 0 ? step.title : `Step ${i}`;
              const description = typeof step.description === "string" ? step.description : "";
              const isLast = i === outlineSteps.length - 1;
              
              const stepSystemPrompt = [
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

              const result = await stepExecutor.runStep({
                system: stepSystemPrompt,
                tools: executionTools,
                planId: outlineId,
                stepIndex: i,
                emitText: isLast,
                messages: stepMessages,
                abortSignal: request.signal,
              });

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
              }
            }
            logger.info(`[Plan] Outline ${outlineId} execution completed successfully`);
            return;
          }
          // If outline generation failed, fall through to standard chat?
          // Or should we error? Probably fall through or stop.
          // Original logic implied fall through if tool not called.
        }

        // --- STANDARD CHAT FLOW ---
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

        // Pipe through transform to capture Plan tool usage if it happens in standard flow (Legacy/Fallback)
        const tapped = uiStream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (chunk.type === "tool-input-available") {
                if (chunk.toolName === DefaultToolName.Plan) {
                   // Legacy Plan Tool Support - if somehow called here
                   const parsed = PlanToolOutputSchema.safeParse(chunk.input);
                   if (parsed.success) {
                      progressWriter.writeSnapshot(chunk.toolCallId, parsed.data, "data-plan");
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
