import { Command } from "commander";
import { text, isCancel, intro, outro } from "../ui/prompts";
import chalk from "chalk";
import { format } from "date-fns";
import { requireAuth, loadConfig, createThread, listThreads, switchThread, updateThreadTitle, appendMessage } from "../threads";
import { SettingsApi } from "../services/settings.api";
import { Logger } from "../ui/logger";
import type { OperationNode } from "../types/api.types";
import { CAPABILITIES, resolveActiveFlag, resolveFlagValue } from "./chat.types";
import type { ParsedArgs } from "./chat.types";
import {
  handleImageGeneration,
  handleSpeechGeneration,
  handleVisionAnalysis,
  handleAudioAnalysis,
  handleTextStream,
} from "./chat.handlers";

interface ParseAcc {
  readonly flag?: string;
  readonly flagValue?: string;
  readonly savePath?: string;
  readonly model?: string;
  readonly voice?: string;
  readonly promptParts: readonly string[];
  readonly skipNext: boolean;
  readonly skipNextValue: boolean;
  readonly skipModel: boolean;
  readonly skipVoice: boolean;
}

function parseInputArgs(args: readonly string[]): ParsedArgs {
  const result = args.reduce<ParseAcc>(
    (acc, arg, index, arr) => {
      if (acc.skipNext) return { ...acc, skipNext: false };
      if (acc.skipNextValue) return { ...acc, skipNextValue: false };
      if (acc.skipModel) return { ...acc, skipModel: false };
      if (acc.skipVoice) return { ...acc, skipVoice: false };

      if (arg === "--save") {
        const nextValue = arr[index + 1];
        return nextValue ? { ...acc, savePath: nextValue, skipNext: true } : acc;
      }
      if (arg === "--model" || arg === "-m") {
        const nextValue = arr[index + 1];
        return nextValue ? { ...acc, model: nextValue, skipModel: true } : acc;
      }
      if (arg === "--voice" || arg === "-v") {
        const nextValue = arr[index + 1];
        return nextValue ? { ...acc, voice: nextValue, skipVoice: true } : acc;
      }

      const matchingCap = CAPABILITIES.find((c) => c.flag === arg);
      if (matchingCap) {
        const nextValue = arr[index + 1];
        return { ...acc, flag: arg, flagValue: nextValue, skipNextValue: true };
      }
      return { ...acc, promptParts: [...acc.promptParts, arg] };
    },
    { promptParts: [], skipNext: false, skipNextValue: false, skipModel: false, skipVoice: false },
  );

  return {
    flag: result.flag,
    flagValue: result.flagValue,
    prompt: result.promptParts.join(" ").trim(),
    savePath: result.savePath,
    model: result.model,
    voice: result.voice,
  };
}

function resolveCapability(activeFlag: string, nodes: readonly OperationNode[]) {
  const cap = CAPABILITIES.find((c) => c.flag === activeFlag);
  if (!cap) {
    throw new Error(`Unsupported capability flag: ${activeFlag}`);
  }

  const node = nodes.find((n) => n.id === cap.id);
  if (!node) {
    throw new Error(`Capability '${cap.id}' not found in Operation Graph.`);
  }
  if (node.state.type !== "ACTIVE") {
    const reason = node.state.type === "LOCKED" ? node.state.reason : "Invisible";
    throw new Error(`Capability '${node.id}' is currently unavailable. Reason: ${reason}`);
  }

  return { cap, node };
}

async function handleExecution(
  parsed: ParsedArgs,
  conversationId: string,
  token: string,
  nodes: readonly OperationNode[],
): Promise<void> {
  if (parsed.prompt) {
    appendMessage(conversationId, {
      role: "user",
      content: parsed.prompt,
      kind: "text",
      timestamp: Date.now(),
    });
  }

  const activeFlag = parsed.flag || "--text";
  const { cap } = resolveCapability(activeFlag, nodes);

  if (cap.id === "orazaka.core.media.image") {
    return handleImageGeneration(parsed, conversationId);
  }
  if (cap.id === "orazaka.core.media.speech") {
    return handleSpeechGeneration(parsed, conversationId);
  }
  if (cap.id === "orazaka.core.media.vision" && parsed.flagValue) {
    return handleVisionAnalysis(parsed, conversationId);
  }
  if (cap.id === "orazaka.core.media.audio.analysis" && parsed.flagValue) {
    return handleAudioAnalysis(parsed, conversationId);
  }
  if (cap.id === "orazaka.core.chat.completion") {
    return handleTextStream(parsed, conversationId, token);
  }

  throw new Error(`Capability execution for '${cap.id}' is not implemented.`);
}

function handleThreadMeta(input: string, config = loadConfig()!): string {
  const parts = input.trim().split(/\s+/);
  const sub = parts[1];

  if (sub === "new") {
    const thread = createThread();
    Logger.success(`Created new thread: ${thread.conversationId}`);
    return thread.conversationId;
  }

  if (sub === "list") {
    const threads = listThreads();
    if (threads.length === 0) {
      Logger.info("No threads found.");
    } else {
      console.log(chalk.cyan.bold("\n--- Conversation Threads ---"));
      threads.forEach((t) => {
        const active = t.conversationId === config.activeThreadId ? chalk.green(" ← active") : "";
        const date = format(new Date(t.updatedAt), "yyyy-MM-dd HH:mm:ss");
        console.log(`  ${chalk.yellow(t.conversationId.substring(0, 8))}  ${t.title.padEnd(30)}  ${chalk.gray(date)}${active}`);
      });
      console.log();
    }
    return config.activeThreadId;
  }

  if (sub === "switch" && parts[2]) {
    const threadId = parts[2];
    const match = listThreads().find((t) => t.conversationId.startsWith(threadId));
    if (!match) {
      Logger.error(`Thread not found: ${threadId}`);
      return config.activeThreadId;
    }
    switchThread(match.conversationId);
    Logger.success(`Switched to thread: ${match.conversationId}`);
    return match.conversationId;
  }

  Logger.warn('Use: /thread new | /thread list | /thread switch <id>');
  return config.activeThreadId;
}

async function executeSingleShot(
  parsed: ParsedArgs,
  activeThreadId: string,
  token: string,
  nodes: readonly OperationNode[],
): Promise<void> {
  try {
    await handleExecution(parsed, activeThreadId, token, nodes);
    console.log();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    Logger.error(`Execution failed: ${msg}`);
    process.exit(1);
  }
}

async function replLoop(
  currentConversationId: string,
  token: string,
  nodes: readonly OperationNode[],
): Promise<void> {
  const input = await text({
    message: chalk.green("Orazaka >"),
    placeholder: "Type a prompt or command...",
  });

  if (isCancel(input)) {
    await outro(chalk.cyan("Exited chat session."));
    return;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return replLoop(currentConversationId, token, nodes);
  }

  if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
    await outro(chalk.cyan("Exited chat session."));
    return;
  }

  if (trimmed.startsWith("/thread")) {
    const currentConfig = loadConfig()!;
    const nextConversationId = handleThreadMeta(trimmed, currentConfig);
    return replLoop(nextConversationId, token, nodes);
  }

  const parsedRepl = parseInputArgs(trimmed.split(/\s+/));
  try {
    await handleExecution(parsedRepl, currentConversationId, token, nodes);
    const title = parsedRepl.prompt.length > 40
      ? `${parsedRepl.prompt.substring(0, 40)}...`
      : parsedRepl.prompt;
    updateThreadTitle(currentConversationId, title);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    Logger.error(`Execution failed: ${msg}`);
  }
  console.log();
  return replLoop(currentConversationId, token, nodes);
}

export const chatCommand = new Command("chat")
  .description("Execute interactive REPL or single-shot chat")
  .argument("[prompt...]", "Optional prompt words for single-shot chat")
  .option("-t, --text", "Force text chat mode")
  .option("-i, --image <path>", "Analyze a poster image")
  .option("-a, --audio <path>", "Analyze an audio clip")
  .option("-g, --gen-image", "Generate an image")
  .option("-s, --speech", "Convert text to speech")
  .option("-m, --model <model>", "Specify AI model name")
  .option("-v, --voice <voice>", "Specify voice name")
  .option("-o, --save <path>", "Specific file path to save output media")
  .action(async (promptWords: string[], options) => {
    const config = requireAuth();
    const nodes = await SettingsApi.getOperationGraph();
    const inputPrompt = promptWords.join(" ").trim();

    const flag = resolveActiveFlag(options);
    const flagValue = resolveFlagValue(options);

    const parsed: ParsedArgs = {
      flag,
      flagValue,
      prompt: inputPrompt,
      savePath: options.save,
      model: options.model,
      voice: options.voice,
    };

    if (parsed.prompt || parsed.flag) {
      await executeSingleShot(parsed, config.activeThreadId, config.token, nodes);
      return;
    }

    await intro(chalk.cyan("Interactive Chat Session Started"));
    Logger.hint(`Connected to thread: ${config.activeThreadId.substring(0, 8)}...`);
    Logger.hint('Type "exit" to leave. Use /thread new|list|switch <id> to manage threads.\n');

    await replLoop(config.activeThreadId, config.token, nodes);
  });
