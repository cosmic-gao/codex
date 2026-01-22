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
import { getLatestPlanProgress, PlanMessagePart } from "./plan-message-part";
import { ChevronDown, ChevronUp, TriangleAlertIcon } from "lucide-react";
import { Button } from "ui/button";
import { useTranslations } from "next-intl";
import { ChatMetadata } from "app-types/chat";
import { DefaultToolName } from "lib/ai/tools";
import { PlanDataPartSchema, PlanToolOutputSchema } from "app-types/plan";

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
  const partsForDisplay = useMemo(
    () =>
      message.parts.filter(
        (part) => !(isIngestionPreviewTextPart(part) && Boolean(part.ingestionPreview)),
      ),
    [message.parts],
  );
  const hasDataPlan = useMemo(
    () => partsForDisplay.some((p) => p.type === "data-plan"),
    [partsForDisplay],
  );

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

            const parsedPlanPart = PlanDataPartSchema.safeParse(part);
            if (parsedPlanPart.success) {
              const planId =
                parsedPlanPart.data.id ??
                (typeof parsedPlanPart.data.data.title === "string"
                  ? `${message.id}:${parsedPlanPart.data.data.title}`
                  : message.id);
              
              const progress = getLatestPlanProgress(partsForDisplay, planId);

              return (
                <PlanMessagePart
                  key={key}
                  plan={parsedPlanPart.data.data}
                  planId={planId}
                  progress={progress}
                  isStreaming={false}
                />
              );
            }

            if (part.type === "data-plan-progress") {
              return null;
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

              if (toolName === DefaultToolName.UpdatePlanProgress) {
                return null;
              }

              if (toolName === DefaultToolName.Plan) {
                if (hasDataPlan) return null;
                const parsed = PlanToolOutputSchema.safeParse(part.input);
                if (parsed.success) {
                  const progress = getLatestPlanProgress(partsForDisplay, part.toolCallId);
                  return (
                    <PlanMessagePart
                      key={key}
                      plan={parsed.data}
                      planId={part.toolCallId}
                      progress={progress}
                      isStreaming={!part.state.startsWith("output")}
                    />
                  );
                }
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
