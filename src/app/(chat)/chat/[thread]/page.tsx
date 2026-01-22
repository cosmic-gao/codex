import { selectThreadWithMessagesAction } from "@/app/api/chat/actions";
import ChatBot from "@/components/chat-bot";

import { ChatMessage, ChatThread, ChatUIMessage } from "app-types/chat";
import { redirect, RedirectType } from "next/navigation";

const fetchThread = async (
  threadId: string,
): Promise<(ChatThread & { messages: ChatMessage[] }) | null> => {
  return await selectThreadWithMessagesAction(threadId);
};

export default async function Page({
  params,
}: { params: Promise<{ thread: string }> }) {
  const { thread: threadId } = await params;

  const thread = await fetchThread(threadId);

  if (!thread) redirect("/", RedirectType.replace);

  const initialMessages: ChatUIMessage[] = thread.messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
    metadata: m.metadata,
  }));

  return <ChatBot threadId={threadId} initialMessages={initialMessages} />;
}
