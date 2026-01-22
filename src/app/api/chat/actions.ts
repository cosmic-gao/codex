"use server";

import {
  generateText,
  jsonSchema,
  tool as createTool,
  LanguageModel,
  type UIMessage,
} from "ai";

import {
  CREATE_THREAD_TITLE_PROMPT,
  generateExampleToolSchemaPrompt,
} from "lib/ai/prompts";

import type { ChatModel, ChatThread } from "app-types/chat";

import {
  agentRepository,
  chatExportRepository,
  chatRepository,
  mcpMcpToolCustomizationRepository,
  mcpServerCustomizationRepository,
} from "lib/db/repository";
import { customModelProvider } from "lib/ai/models";
import { toAny } from "lib/utils";
import { McpServerCustomizationsPrompt, MCPToolInfo } from "app-types/mcp";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";
import { getSession } from "auth/server";
import logger from "logger";

import { JSONSchema7 } from "json-schema";
import { ObjectJsonSchema7 } from "app-types/util";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { Agent } from "app-types/agent";

export async function getUserId() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("User not found");
  }
  return userId;
}

export async function generateTitleFromUserMessageAction({
  message,
  model,
}: { message: UIMessage; model: LanguageModel }) {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  const prompt = toAny(message.parts?.at(-1))?.text || "unknown";

  const { text: title } = await generateText({
    model,
    system: CREATE_THREAD_TITLE_PROMPT,
    prompt,
  });

  return title.trim();
}

export async function selectThreadWithMessagesAction(threadId: string) {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  const thread = await chatRepository.selectThread(threadId);

  if (!thread) {
    logger.error("Thread not found", threadId);
    return null;
  }
  if (thread.userId !== session?.user.id) {
    return null;
  }
  const messages = await chatRepository.selectMessagesByThreadId(threadId);
  return { ...thread, messages: messages ?? [] };
}

export async function deleteMessageAction(messageId: string) {
  await chatRepository.deleteChatMessage(messageId);
}

export async function deleteThreadAction(threadId: string) {
  await chatRepository.deleteThread(threadId);
}

export async function deleteMessagesByChatIdAfterTimestampAction(
  messageId: string,
) {
  "use server";
  await chatRepository.deleteMessagesByChatIdAfterTimestamp(messageId);
}

export async function updateThreadAction(
  id: string,
  thread: Partial<Omit<ChatThread, "createdAt" | "updatedAt" | "userId">>,
) {
  const userId = await getUserId();
  await chatRepository.updateThread(id, { ...thread, userId });
}

export async function deleteThreadsAction() {
  const userId = await getUserId();
  await chatRepository.deleteAllThreads(userId);
}

export async function deleteUnarchivedThreadsAction() {
  const userId = await getUserId();
  await chatRepository.deleteUnarchivedThreads(userId);
}

/**
 * Generate example tool schema
 *
 * @description
 * Uses LLM to generate example input parameters for a given MCP tool based on its schema.
 * Forces the model to call a tool with the target schema to produce valid example data.
 *
 * @param options.model - The chat model to use for generation
 * @param options.toolInfo - MCP tool information including input schema
 * @param options.prompt - Optional custom prompt to guide example generation
 * @returns {Promise<any>} Generated example object matching the tool's input schema
 *
 * @example
 * const example = await generateExampleToolSchemaAction({
 *   model: { provider: 'openai', model: 'gpt-4' },
 *   toolInfo: { name: 'search', inputSchema: {...} }
 * });
 */
export async function generateExampleToolSchemaAction(options: {
  model?: ChatModel;
  toolInfo: MCPToolInfo;
  prompt?: string;
}) {
  const model = customModelProvider.getModel(options.model);

  const schema = jsonSchema(
    toAny({
      ...options.toolInfo.inputSchema,
      properties: options.toolInfo.inputSchema?.properties ?? {},
      additionalProperties: false,
    }),
  );

  let resultObject: any = null;

  await generateText({
    model,
    tools: {
      generate_example: createTool({
        description: "Generate an example input for the tool",
        inputSchema: schema,
        execute: (args) => {
          resultObject = args;
          return "Example generated successfully";
        },
      }),
    },
    toolChoice: "required",
    messages: [
      {
        role: "user",
        content: generateExampleToolSchemaPrompt({
          toolInfo: options.toolInfo,
          prompt: options.prompt,
        }),
      },
    ],
  });

  return resultObject;
}

export async function rememberMcpServerCustomizationsAction(userId: string) {
  const key = CacheKeys.mcpServerCustomizations(userId);

  const cachedMcpServerCustomizations =
    await serverCache.get<Record<string, McpServerCustomizationsPrompt>>(key);
  if (cachedMcpServerCustomizations) {
    return cachedMcpServerCustomizations;
  }

  const mcpServerCustomizations =
    await mcpServerCustomizationRepository.selectByUserId(userId);
  const mcpToolCustomizations =
    await mcpMcpToolCustomizationRepository.selectByUserId(userId);

  const serverIds: string[] = [
    ...mcpServerCustomizations.map(
      (mcpServerCustomization) => mcpServerCustomization.mcpServerId,
    ),
    ...mcpToolCustomizations.map(
      (mcpToolCustomization) => mcpToolCustomization.mcpServerId,
    ),
  ];

  const prompts = Array.from(new Set(serverIds)).reduce(
    (acc, serverId) => {
      const sc = mcpServerCustomizations.find((v) => v.mcpServerId == serverId);
      const tc = mcpToolCustomizations.filter(
        (mcpToolCustomization) => mcpToolCustomization.mcpServerId === serverId,
      );
      const data: McpServerCustomizationsPrompt = {
        name: sc?.serverName || tc[0]?.serverName || "",
        id: serverId,
        prompt: sc?.prompt || "",
        tools: tc.reduce(
          (acc, v) => {
            acc[v.toolName] = v.prompt || "";
            return acc;
          },
          {} as Record<string, string>,
        ),
      };
      acc[serverId] = data;
      return acc;
    },
    {} as Record<string, McpServerCustomizationsPrompt>,
  );

  serverCache.set(key, prompts, 1000 * 60 * 30); // 30 minutes
  return prompts;
}

/**
 * Generate structured object
 *
 * @description
 * Uses LLM to generate structured data conforming to a JSON schema.
 * Forces the model to call a tool with the provided schema to ensure type-safe output.
 *
 * @param model - Optional chat model configuration
 * @param prompt.system - System prompt to guide generation behavior
 * @param prompt.user - User prompt describing what to generate
 * @param schema - JSON Schema defining the structure of the output
 * @returns {Promise<any>} Generated object matching the schema
 * @throws {Error} If model fails to generate valid output
 *
 * @example
 * const result = await generateObjectAction({
 *   model: { provider: 'openai', model: 'gpt-4' },
 *   prompt: { user: 'Generate a user profile' },
 *   schema: { type: 'object', properties: { name: { type: 'string' } } }
 * });
 */
export async function generateObjectAction({
  model,
  prompt,
  schema,
}: {
  model?: ChatModel;
  prompt: {
    system?: string;
    user?: string;
  };
  schema: JSONSchema7 | ObjectJsonSchema7;
}) {
  let resultObject: any = null;
  const zodSchema = jsonSchemaToZod(schema);

  await generateText({
    model: customModelProvider.getModel(model),
    tools: {
      generate_content: createTool({
        description: "Generate structured content based on the schema",
        inputSchema: zodSchema,
        execute: (args) => {
          resultObject = args;
          return "Content generated successfully";
        },
      }),
    },
    toolChoice: "required",
    messages: [
      {
        role: "system",
        content:
          prompt.system ||
          "You are a helpful assistant. Please generate structured data based on the user's request using the 'generate_content' tool.",
      },
      {
        role: "user",
        content:
          prompt.user ||
          "Please generate the content based on the schema provided in the tool definition.",
      },
    ],
  });

  return resultObject;
}

export async function rememberAgentAction(
  agent: string | undefined,
  userId: string,
) {
  if (!agent) return undefined;
  const key = CacheKeys.agentInstructions(agent);
  let cachedAgent = await serverCache.get<Agent | null>(key);
  if (!cachedAgent) {
    cachedAgent = await agentRepository.selectAgentById(agent, userId);
    await serverCache.set(key, cachedAgent);
  }
  return cachedAgent as Agent | undefined;
}

export async function exportChatAction({
  threadId,
  expiresAt,
}: {
  threadId: string;
  expiresAt?: Date;
}) {
  const userId = await getUserId();

  const isAccess = await chatRepository.checkAccess(threadId, userId);
  if (!isAccess) {
    return new Response("Unauthorized", { status: 401 });
  }

  return await chatExportRepository.exportChat({
    threadId,
    exporterId: userId,
    expiresAt: expiresAt ?? undefined,
  });
}
