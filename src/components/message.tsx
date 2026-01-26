"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { memo, useMemo, useState } from "react";
import equal from "lib/equal";

import { cn, truncateString } from "lib/utils";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  UserMessagePart,
  AssistMessagePart,
  ToolMessagePart,
  ReasoningPart,
  FileMessagePart,
  SourceUrlMessagePart,
} from "./message-parts";
import { PlanCard } from "./plan/plan-card";
import { getLatestPlanProgress, getPlanStepOutputs } from "./plan/plan-utils";
import { ChevronDown, ChevronUp, TriangleAlertIcon } from "lucide-react";
import { Button } from "ui/button";
import { useTranslations } from "next-intl";
import { ChatMetadata } from "app-types/chat";
import { DefaultToolName } from "lib/ai/tools";
import {
  OutlineDataPartSchema,
  PlanDataPartSchema,
  PlanToolOutputSchema,
  PlanActionSchema,
  type PlanToolOutput,
  type DeepPartial,
} from "app-types/plan";
import { z } from "zod";

const LenientPlanStepSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  actions: z.array(PlanActionSchema).optional(),
});

const LenientPlanToolOutputSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  steps: z.array(LenientPlanStepSchema).optional().default([]),
});

type MessagePart = UIMessage["parts"][number];

function isIngestionPreviewTextPart(
  part: MessagePart,
): part is Extract<MessagePart, { type: "text" }> & { ingestionPreview: unknown } {
  return part.type === "text" && "ingestionPreview" in part;
}

interface Props {
  message: UIMessage;
  prevMessage?: UIMessage;
  threadId?: string;
  isLoading?: boolean;
  isLastMessage?: boolean;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
  className?: string;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  messageIndex?: number;
  status?: UseChatHelpers<UIMessage>["status"];
  readonly?: boolean;
}

const PurePreviewMessage = ({
  message,
  prevMessage,
  readonly,
  threadId,
  isLoading,
  isLastMessage,
  status,
  className,
  setMessages,
  addToolResult,
  messageIndex,
  sendMessage,
}: Props) => {
  const isUserMessage = useMemo(() => message.role === "user", [message.role]);
  
  // Calculate parts to display with aggressive plan/outline deduplication
  const partsForDisplay = useMemo(() => {
    const parts = message.parts.filter(
      (part) =>
        !(isIngestionPreviewTextPart(part) && Boolean(part.ingestionPreview)),
    );

    const planToolIdsToHide = new Set<string>();

    // First pass: Identify authoritative Plan/Outline parts and collect their IDs
    parts.forEach((part) => {
      const parsedOutlinePart = OutlineDataPartSchema.safeParse(part);
      if (parsedOutlinePart.success) {
        const outlineId = parsedOutlinePart.data.id;
        if (outlineId) {
          planToolIdsToHide.add(outlineId);
        }
        return;
      }

      const parsedPlanPart = PlanDataPartSchema.safeParse(part);
      if (parsedPlanPart.success) {
        const planId = parsedPlanPart.data.id;
        if (planId) {
          planToolIdsToHide.add(planId);
        }
        return;
      }
    });

    // Second pass: Filter
    return parts.filter((part) => {
      // Hide progress parts
      if (part.type === "data-plan-progress" || part.type === "data-plan-step-output") {
        return false;
      }
      
      // Check Plan/Outline Data Parts for duplication
      if (part.type === "data-outline" || part.type === "data-plan") {
        const parsed = part.type === "data-outline" 
           ? OutlineDataPartSchema.safeParse(part)
           : PlanDataPartSchema.safeParse(part);
           
        if (parsed.success) {
          return true;
        }
      }

      // Hide Tool Invocations if they match an existing Plan/Outline Data Part
      if (isToolUIPart(part)) {
        const toolName = getToolName(part);
        if (toolName === DefaultToolName.Progress) return false;
        
        if (toolName === DefaultToolName.Plan || toolName === DefaultToolName.Outline) {
          const toolCallId = part.toolCallId;
          if (planToolIdsToHide.has(toolCallId)) {
            return false;
          }
        }
      }

      return true;
    });
  }, [message.parts, message.id]);

  if (message.role == "system") {
    return null; // system message is not shown
  }
  if (!partsForDisplay.length) return null;

  return (
    <div className="w-full mx-auto max-w-3xl px-6 group/message">
      <div
        className={cn(
          "flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
          className,
        )}
      >
        <div className="flex flex-col gap-4 w-full">
          {partsForDisplay.map((part, index) => {
            const key = `message-${messageIndex}-part-${part.type}-${index}`;
            const isLastPart = index === partsForDisplay.length - 1;

            const parsedOutlinePart = OutlineDataPartSchema.safeParse(part);
            if (parsedOutlinePart.success) {
              const outlineId =
                parsedOutlinePart.data.id ??
                (typeof parsedOutlinePart.data.data.title === "string"
                  ? `${message.id}:${parsedOutlinePart.data.data.title}`
                  : message.id);
              const outlineKey = `message-${messageIndex}-outline-${outlineId}`;
              const progress = getLatestPlanProgress(message.parts, outlineId); // Use original parts for progress search
              const stepOutputs = getPlanStepOutputs(message.parts, outlineId);
              return (
                <PlanCard
                  key={outlineKey}
                  plan={parsedOutlinePart.data.data}
                  planId={outlineId}
                  progress={progress}
                  stepOutputs={stepOutputs}
                  isStreaming={false}
                  isActive={Boolean(isLastMessage && isLoading)}
                />
              );
            }

            const parsedPlanPart = PlanDataPartSchema.safeParse(part);
            if (parsedPlanPart.success) {
              const planId =
                parsedPlanPart.data.id ??
                (typeof parsedPlanPart.data.data.title === "string"
                  ? `${message.id}:${parsedPlanPart.data.data.title}`
                  : message.id);
              const planKey = `message-${messageIndex}-plan-${planId}`;
              
              const progress = getLatestPlanProgress(message.parts, planId);
              const stepOutputs = getPlanStepOutputs(message.parts, planId);

              return (
                <PlanCard
                  key={planKey}
                  plan={parsedPlanPart.data.data}
                  planId={planId}
                  progress={progress}
                  stepOutputs={stepOutputs}
                  isStreaming={false}
                  isActive={Boolean(isLastMessage && isLoading)}
                />
              );
            }

            if (part.type === "reasoning") {
              return (
                <ReasoningPart
                  key={key}
                  readonly={readonly}
                  reasoningText={part.text}
                  isThinking={isLastPart && isLastMessage && isLoading}
                />
              );
            }

            if (isUserMessage && part.type === "text" && part.text) {
              return (
                <UserMessagePart
                  key={key}
                  status={status}
                  part={part}
                  readonly={readonly}
                  isLast={isLastPart}
                  message={message}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                />
              );
            }

            if (part.type === "text" && !isUserMessage) {
              return (
                <AssistMessagePart
                  threadId={threadId}
                  isLast={isLastMessage && isLastPart}
                  isLoading={isLoading}
                  key={key}
                  readonly={readonly}
                  part={part}
                  prevMessage={prevMessage}
                  showActions={
                    isLastMessage ? isLastPart && !isLoading : isLastPart
                  }
                  message={message}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                />
              );
            }

            if (isToolUIPart(part)) {
              const toolName = getToolName(part);

              if (toolName === DefaultToolName.Plan || toolName === DefaultToolName.Outline) {
                // Since we filtered out the ones that have corresponding data parts,
                // if we are here, it means we only have the tool part (e.g. streaming initial plan).
                
                let planData: DeepPartial<PlanToolOutput> = {};
                let isStreaming = true;

                const parsed = PlanToolOutputSchema.safeParse(part.input);
                
                if (parsed.success) {
                  planData = parsed.data;
                  isStreaming = !part.state.startsWith("output");
                } else {
                  const lenientParsed = LenientPlanToolOutputSchema.safeParse(part.input);
                  if (lenientParsed.success) {
                    planData = lenientParsed.data as DeepPartial<PlanToolOutput>;
                  }
                }

                // Try to find progress even if we don't have data part yet (unlikely but possible)
                const progress = getLatestPlanProgress(
                  message.parts,
                  part.toolCallId,
                );
                const stepOutputs = getPlanStepOutputs(
                  message.parts,
                  part.toolCallId,
                );

                return (
                  <PlanCard
                    key={`message-${messageIndex}-plan-tool-${part.toolCallId}`}
                    plan={planData}
                    planId={part.toolCallId}
                    progress={progress}
                    stepOutputs={stepOutputs}
                    isStreaming={isStreaming}
                    isActive={Boolean(isLastMessage && isLoading)}
                  />
                );
              }

              const isLast = isLastMessage && isLastPart;
              const isManualToolInvocation =
                (message.metadata as ChatMetadata)?.toolChoice == "manual" &&
                isLastMessage &&
                isLastPart &&
                part.state == "input-available" &&
                isLoading &&
                !readonly;
              return (
                <ToolMessagePart
                  isLast={isLast}
                  readonly={readonly}
                  messageId={message.id}
                  isManualToolInvocation={isManualToolInvocation}
                  showActions={
                    !readonly &&
                    (isLastMessage ? isLastPart && !isLoading : isLastPart)
                  }
                  addToolResult={addToolResult}
                  key={key}
                  part={part}
                  setMessages={setMessages}
                />
              );
            } else if (part.type === "step-start") {
              return null;
            } else if (part.type === "file") {
              return (
                <FileMessagePart
                  key={key}
                  part={part}
                  isUserMessage={isUserMessage}
                />
              );
            } else if (part.type === "source-url") {
              return (
                <SourceUrlMessagePart
                  key={key}
                  part={part}
                  isUserMessage={isUserMessage}
                />
              );
            } else {
              return <div key={key}> unknown part {part.type}</div>;
            }
          })}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  function equalMessage(prevProps: Props, nextProps: Props) {
    if (prevProps.message.id !== nextProps.message.id) return false;

    if (prevProps.isLoading !== nextProps.isLoading) return false;

    if (prevProps.isLastMessage !== nextProps.isLastMessage) return false;

    if (prevProps.className !== nextProps.className) return false;

    if (nextProps.isLoading && nextProps.isLastMessage) return false;

    if (!equal(prevProps.message.metadata, nextProps.message.metadata))
      return false;

    if (prevProps.message.parts.length !== nextProps.message.parts.length) {
      return false;
    }
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }

    return true;
  },
);

export const ErrorMessage = ({
  error,
}: {
  error: Error;
  message?: UIMessage;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const maxLength = 200;
  const t = useTranslations();
  return (
    <div className="w-full mx-auto max-w-3xl px-6 animate-in fade-in mt-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-4 px-2 opacity-70">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-muted rounded-sm">
              <TriangleAlertIcon className="h-3.5 w-3.5 text-destructive" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm mb-2">{t("Chat.Error")}</p>
              <div className="text-sm text-muted-foreground">
                <div className="whitespace-pre-wrap">
                  {isExpanded
                    ? error.message
                    : truncateString(error.message, maxLength)}
                </div>
                {error.message.length > maxLength && (
                  <Button
                    onClick={() => setIsExpanded(!isExpanded)}
                    variant={"ghost"}
                    className="h-auto p-1 text-xs mt-2"
                    size={"sm"}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3 mr-1" />
                        {t("Common.showLess")}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3 mr-1" />
                        {t("Common.showMore")}
                      </>
                    )}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground mt-3 italic">
                  {t("Chat.thisMessageWasNotSavedPleaseTryTheChatAgain")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
