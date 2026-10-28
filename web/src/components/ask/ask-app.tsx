"use client";

import Link from "next/link";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Dialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import { Command } from "cmdk";
import clsx from "clsx";
import { toast } from "sonner";
import { Mark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Tip, TipProvider } from "@/components/ui/tip";
import { Globe } from "@/components/ask/globe";
import { BlurText } from "@/components/vendor/blur-text";
import { AnswerView, plainText, totalUnits, type AssistantMessage } from "@/components/ask/answer-view";
import { MemoryDrawer } from "@/components/ask/memory-drawer";
import { answers, memoryItems, pastChats, specialistSteps, suggestions, type Answer } from "@/content/ask";
import { worstMemoryItems, worstPastChats } from "@/content/worst-case";
import { useFixture } from "@/lib/data-mode";

type UserMessage = { id: string; role: "user"; text: string; file?: string };
type Message = UserMessage | AssistantMessage;
type Chat = { id: string; title: string; messages: Message[] };

const STEP_MS = 620;
const TICK_MS = 45;
const WORDS_PER_TICK = 2;

function answerFor(text: string, key?: string): Answer {
  if (key && answers[key]) return answers[key];
  const t = text.toLowerCase();
  if (/\blist\b|reach|safety/.test(t)) return answers.list;
  if (/extracurricular|club|activit|volunteer/.test(t)) return answers.extracurriculars;
  if (/scholarship|funding|grant/.test(t)) return answers.scholarships;
  if (/competition|olympiad/.test(t)) return answers.competitions;
  return answers.generic;
}

function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 46).trimEnd()}…` : clean;
}

/** Old chats arrive finished, so they open instantly and whole. */
const chatsFrom = (titles: string[]): Chat[] => titles.map((title, i) => {
  const answer = answerFor(title);
  return {
    id: `past-${i}`,
    title,
    messages: [
      { id: `past-${i}-q`, role: "user", text: title },
      {
        id: `past-${i}-a`,
        role: "assistant",
        answer,
        phase: "done",
        step: specialistSteps.length,
        shown: totalUnits(answer),
        streamed: false,
      },
    ],
  };
});

const noop = () => () => {};

/** The globe is drawn only where there's room for it, so phones never spend battery on it. */
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(min-width: 640px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 640px)").matches,
    () => false,
  );
}

/**
 * A handler whose identity never changes but which always sees the latest state, so memoised children
 * (the sidebar, finished answers) don't re-render on every streamed word.
 */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/* ——— Composer: the band, with its marker as the send button ——— */

function Composer({
  busy,
  onSend,
  onStop,
  inputRef,
}: {
  busy: boolean;
  onSend: (text: string, file?: string) => void;
  onStop: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = text.trim().length > 0 && !busy;

  // Grow with the text, up to about eight lines, then scroll inside
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, [text, inputRef]);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), file);
    setText("");
    setFile(undefined);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="composer rounded-[1.75rem] bg-surface p-1.5 transition-[box-shadow,background-color] duration-200 focus-within:bg-paper focus-within:shadow-[0_0_0_2px_var(--cobalt)]"
    >
      {file ? (
        <div className="fade-in mx-1.5 mb-1 mt-1 inline-flex h-9 max-w-[calc(100%-0.75rem)] items-center gap-2 rounded-full bg-paper pl-3 pr-1 text-small font-medium">
          <Icon name="clip" className="size-4 text-cobalt" />
          <span className="truncate">{file}</span>
          <button
            type="button"
            aria-label={`Remove ${file}`}
            onClick={() => setFile(undefined)}
            className="press grid size-7 shrink-0 place-items-center rounded-full hover:bg-surface"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-1">
        <Tip label="Attach a file">
          <button
            type="button"
            aria-label="Attach a file"
            onClick={() => fileInput.current?.click()}
            className="press grid size-11 shrink-0 place-items-center rounded-full text-soft hover:bg-mid hover:text-ink"
          >
            <Icon name="clip" />
          </button>
        </Tip>
        <input
          ref={fileInput}
          type="file"
          tabIndex={-1}
          aria-hidden
          className="hidden"
          accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
          onChange={(e) => {
            setFile(e.target.files?.[0]?.name);
            e.target.value = "";
          }}
        />
        <label htmlFor="ask-input" className="sr-only">
          Ask Upchance
        </label>
        <textarea
          id="ask-input"
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          enterKeyHint="send"
          placeholder="Ask anything about admissions, essays, scholarships, interviews or universities…"
          className="composer-input min-h-11 flex-1 resize-none bg-transparent px-1 py-[0.6875rem] text-body leading-[1.375rem] text-ink outline-none placeholder:text-soft focus-visible:outline-none"
        />
        <button
          type={busy ? "button" : "submit"}
          onClick={busy ? onStop : undefined}
          disabled={!busy && !canSend}
          aria-label={busy ? "Stop answering" : "Send"}
          data-busy={busy ? "" : undefined}
          className="send-marker press relative grid size-11 shrink-0 place-items-center rounded-full bg-cobalt text-on-cobalt hover:bg-cobalt-press disabled:bg-mid disabled:text-paper data-busy:bg-ink"
        >
          <span className="swap-a absolute inset-0 grid place-items-center">
            <Icon name="up" className="size-[1.125rem]" />
          </span>
          <span className="swap-b absolute inset-0 grid place-items-center">
            <span className="size-3 rounded-[3px] bg-current" />
          </span>
        </button>
      </div>
    </form>
  );
}

/* ——— Sidebar ——— */

type ChatItem = { id: string; title: string };

const Sidebar = memo(function Sidebar({
  chats,
  activeId,
  onNew,
  onOpen,
  onDelete,
  onSearch,
  onMemory,
  shortcut,
}: {
  chats: ChatItem[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onSearch: () => void;
  onMemory: () => void;
  shortcut: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Button size="md" className="w-full" onClick={onNew}>
        New chat
      </Button>
      <nav aria-label="Ask" className="mt-4 flex flex-col gap-0.5">
        <Link href="/" className="side-item press">
          <Icon name="home" />
          Home
        </Link>
        <button type="button" className="side-item press" onClick={onSearch}>
          <Icon name="search" />
          Search chats
          {shortcut ? (
            <kbd className="ml-auto rounded-full bg-surface px-2 py-0.5 font-sans text-small text-soft max-lg:hidden">{shortcut}</kbd>
          ) : null}
        </button>
        <button type="button" className="side-item press" onClick={onMemory}>
          <Icon name="memory" />
          What Upchance remembers
        </button>
      </nav>

      <h2 className="mt-8 px-3 text-small font-medium text-soft">Chats</h2>
      <div className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1" data-lenis-prevent>
        {chats.length === 0 ? (
          <p className="fade-in px-3 py-2 text-body text-soft">Your chats will appear here.</p>
        ) : (
          <LayoutGroup id="chats">
            <ul className="flex flex-col gap-0.5 pb-2">
              <AnimatePresence initial={false}>
                {chats.map((c) => {
                  const active = c.id === activeId;
                  return (
                    <motion.li
                      key={c.id}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                      className="group/chat relative"
                    >
                      {active ? (
                        <motion.span
                          layoutId="chat-band"
                          aria-hidden
                          className="absolute inset-0 rounded-full bg-paper"
                          transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onOpen(c.id)}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "press relative flex h-11 w-full items-center rounded-full pl-3 pr-12 text-left text-body",
                          active ? "font-medium text-ink" : "text-soft hover:bg-surface hover:text-ink",
                        )}
                      >
                        <span className="truncate">{c.title}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete chat “${c.title}”`}
                        onClick={() => onDelete(c.id)}
                        className="chat-delete press absolute right-1 top-1 grid size-9 place-items-center rounded-full text-soft hover:bg-mid hover:text-ink"
                      >
                        <Icon name="trash" className="size-4" />
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </LayoutGroup>
        )}
      </div>

      <Link
        href="/plans"
        className="press mt-3 flex items-center gap-3 rounded-[1.25rem] bg-paper p-3 hover:bg-white"
      >
        <span className="grid size-10 place-items-center rounded-full bg-ink font-bold text-paper">Y</span>
        <span className="flex flex-col">
          <span className="font-medium leading-tight">You</span>
          <span className="text-small text-soft">Pro plan</span>
        </span>
      </Link>
    </div>
  );
});

/* ——— Search chats (cmdk). Opened often by keyboard, so it appears without animation ——— */

function SearchChats({
  open,
  onOpenChange,
  chats,
  onPick,
  onNew,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chats: ChatItem[];
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/35" />
        <Dialog.Popup className="fixed left-1/2 top-[max(1rem,12vh)] z-50 w-[min(36rem,calc(100vw-1rem))] -translate-x-1/2 rounded-[1.5rem] bg-paper p-2 text-ink shadow-[0_32px_80px_-24px_rgba(12,16,48,0.45)] outline-none">
          <Dialog.Title className="sr-only">Search chats</Dialog.Title>
          <Command
            label="Search chats"
            loop
            filter={(value, search, keywords) =>
              (keywords?.join(" ") ?? value).toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
            }
          >
            <div className="flex items-center gap-3 rounded-full bg-surface px-4 focus-within:shadow-[0_0_0_2px_var(--cobalt)]">
              <Icon name="search" className="text-soft" />
              <Command.Input
                autoFocus
                placeholder="Search chats"
                className="h-12 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-soft focus-visible:outline-none"
              />
            </div>
            <Command.List className="mt-2 max-h-[min(22rem,55dvh)] overflow-y-auto overscroll-contain" data-lenis-prevent>
              <Command.Empty className="px-4 py-6 text-body text-soft">No chats match that.</Command.Empty>
              <Command.Item value="new-chat" keywords={["New chat"]} onSelect={onNew} className="cmd-item">
                <Icon name="plus" className="text-cobalt" />
                New chat
              </Command.Item>
              {chats.length ? (
                <Command.Group heading="Chats">
                  {chats.map((c) => (
                    <Command.Item key={c.id} value={c.id} keywords={[c.title]} onSelect={() => onPick(c.id)} className="cmd-item">
                      <span className="size-1.5 shrink-0 rounded-full bg-mid" aria-hidden />
                      <span className="truncate">{c.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ——— The app ——— */

export function AskApp() {
  const reduce = useReducedMotion();
  const wide = useWide();
  const pastTitles = useFixture(pastChats, worstPastChats, []);
  const seedMemory = useFixture(memoryItems, worstMemoryItems, []);
  const [chats, setChats] = useState<Chat[]>(() => chatsFrom(pastTitles));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [memory, setMemory] = useState<string[]>(seedMemory);
  const [paused, setPaused] = useState(false);
  // The account menu deep-links here with ?panel=memory; after that, the panel is the visitor's to open and close
  const deepMemory = useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get("panel") === "memory",
    () => false,
  );
  const [memoryChoice, setMemoryOpen] = useState<boolean | null>(null);
  const memoryOpen = memoryChoice ?? deepMemory;
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shortcut = useSyncExternalStore(
    noop,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"),
    () => "",
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seq = useRef(0);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const empty = messages.length === 0;
  const working = messages.find(
    (m): m is AssistantMessage => m.role === "assistant" && (m.phase === "thinking" || m.phase === "streaming"),
  );

  const patch = useCallback((chatId: string, msgId: string, fn: (m: AssistantMessage) => AssistantMessage) => {
    setChats((all) =>
      all.map((c) =>
        c.id !== chatId
          ? c
          : { ...c, messages: c.messages.map((m) => (m.id === msgId && m.role === "assistant" ? fn(m) : m)) },
      ),
    );
  }, []);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The specialist runs: steps tick through, then the answer streams in word by word
  useEffect(() => {
    if (!active || !working) return;
    const chatId = active.id;
    if (working.phase === "thinking") {
      const t = window.setTimeout(() => {
        patch(chatId, working.id, (m) =>
          m.step + 1 >= specialistSteps.length
            ? { ...m, step: specialistSteps.length, phase: "streaming" }
            : { ...m, step: m.step + 1 },
        );
      }, STEP_MS);
      return () => window.clearTimeout(t);
    }
    const total = totalUnits(working.answer);
    const t = window.setTimeout(
      () => {
        patch(chatId, working.id, (m) => {
          const shown = reduce ? total : Math.min(total, m.shown + WORDS_PER_TICK);
          return shown >= total ? { ...m, shown: total, phase: "done" } : { ...m, shown };
        });
      },
      reduce ? 0 : TICK_MS,
    );
    return () => window.clearTimeout(t);
  }, [active, working, patch, reduce]);

  // Announce once per answer, not per word: the live region changes only when the phase does
  const lastDone = [...messages].reverse().find((m): m is AssistantMessage => m.role === "assistant");
  const announce =
    lastDone?.phase === "thinking" || lastDone?.phase === "streaming"
      ? "Upchance is checking your details."
      : lastDone?.phase === "done" && lastDone.streamed
        ? plainText(lastDone.answer)
        : "";

  // Follow the answer while you're at the bottom; stop following if you scroll up to read
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chats, activeId]);

  const finishWorking = () => {
    if (!active || !working) return;
    patch(active.id, working.id, (m) => ({ ...m, step: specialistSteps.length, shown: totalUnits(m.answer), phase: "done" }));
  };

  const send = (text: string, file?: string, key?: string) => {
    if (working) return;
    const n = ++seq.current;
    const answer = answerFor(text, key);
    const user: UserMessage = { id: `u${n}`, role: "user", text, file };
    const bot: AssistantMessage = {
      id: `a${n}`,
      role: "assistant",
      answer,
      phase: "thinking",
      step: 0,
      shown: 0,
      streamed: true,
    };
    stick.current = true;
    if (active) {
      setChats((all) => all.map((c) => (c.id === active.id ? { ...c, messages: [...c.messages, user, bot] } : c)));
    } else {
      const id = `chat-${n}`;
      setChats((all) => [{ id, title: titleFrom(text), messages: [user, bot] }, ...all]);
      setActiveId(id);
    }
  };

  const stop = () => {
    if (!active || !working) return;
    patch(active.id, working.id, (m) => ({ ...m, phase: "stopped" }));
    inputRef.current?.focus();
  };

  const newChat = () => {
    finishWorking();
    setActiveId(null);
    setDrawerOpen(false);
    setSearchOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openChat = (id: string) => {
    finishWorking();
    stick.current = true;
    setActiveId(id);
    setDrawerOpen(false);
    setSearchOpen(false);
  };

  const deleteChat = (id: string) => {
    const index = chats.findIndex((c) => c.id === id);
    const chat = chats[index];
    if (!chat) return;
    if (id === activeId) setActiveId(null);
    setChats((all) => all.filter((c) => c.id !== id));
    toast("Chat deleted", {
      action: {
        label: "Undo",
        onClick: () =>
          setChats((all) => (all.some((c) => c.id === id) ? all : [...all.slice(0, index), chat, ...all.slice(index)])),
      },
    });
  };

  // Titles change rarely; messages change on every streamed word. The sidebar only hears about titles.
  const titlesKey = chats.map((c) => `${c.id}\u0000${c.title}`).join("\u0001");
  const chatItems = useMemo(
    () => titlesKey.split("\u0001").filter(Boolean).map((row) => {
      const [id, title] = row.split("\u0000");
      return { id, title };
    }),
    [titlesKey],
  );
  const onNew = useStableCallback(newChat);
  const onOpen = useStableCallback(openChat);
  const onDelete = useStableCallback(deleteChat);
  const onSearch = useStableCallback(() => {
    setDrawerOpen(false);
    setSearchOpen(true);
  });
  const onMemory = useStableCallback(() => {
    setDrawerOpen(false);
    setMemoryOpen(true);
  });
  const onFeedback = useStableCallback((msgId: string, v: "up" | "down") => {
    if (!active) return;
    const current = active.messages.find((m): m is AssistantMessage => m.id === msgId && m.role === "assistant");
    patch(active.id, msgId, (x) => ({ ...x, feedback: x.feedback === v ? undefined : v }));
    if (current && current.feedback !== v) toast("Thanks. Upchance will use this to improve.");
  });
  const onFollowUp = useStableCallback((f: string) => send(f));

  const sidebarProps = { chats: chatItems, activeId, onNew, onOpen, onDelete, onSearch, onMemory, shortcut };

  const lastAssistantId = lastDone?.id;
  const ease = [0.77, 0, 0.175, 1] as const;

  return (
    <TipProvider delay={500}>
      <div className="grid h-[calc(100dvh-4.5rem)] grid-cols-1 gap-3 px-2 pb-2 sm:px-[var(--margin)] sm:pb-[var(--margin)] lg:grid-cols-[18.5rem_minmax(0,1fr)]">
        <aside aria-label="Chats" className="hidden min-h-0 lg:block">
          <Sidebar {...sidebarProps} />
        </aside>

        <section
          aria-label="Ask Upchance"
          className="relative flex min-h-0 flex-col overflow-hidden rounded-[var(--radius)] bg-paper"
        >
          {/* Top bar */}
          <div className="relative z-10 flex h-16 shrink-0 items-center justify-between gap-3 px-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen} swipeDirection="left">
                <Drawer.Trigger className="press flex h-10 items-center gap-2 rounded-full bg-surface pl-3 pr-4 text-small font-medium hover:bg-mid lg:hidden">
                  <Icon name="sidebar" className="size-[1.125rem]" />
                  Chats
                </Drawer.Trigger>
                <Drawer.Portal>
                  <Drawer.Backdrop className="drawer-backdrop fixed inset-0 z-50 bg-ink" />
                  <Drawer.Viewport className="fixed inset-0 z-50 flex justify-start p-2">
                    <Drawer.Popup className="side-drawer flex h-full w-[min(20rem,calc(100vw-3rem))] flex-col rounded-[var(--radius)] bg-ground p-4 pt-5 text-ink outline-none">
                      <Drawer.Title className="sr-only">Chats</Drawer.Title>
                      <Drawer.Content className="flex min-h-0 flex-1 flex-col">
                        <Sidebar {...sidebarProps} />
                      </Drawer.Content>
                    </Drawer.Popup>
                  </Drawer.Viewport>
                </Drawer.Portal>
              </Drawer.Root>
              <Mark className="hidden size-7 sm:block" />
              <p className="truncate font-medium">Ask Upchance</p>
              <span className="hidden h-8 shrink-0 items-center gap-2 rounded-full bg-cobalt-tint px-3 text-small font-medium sm:inline-flex">
                <span className="bullet text-[0.8rem]" aria-hidden />
                Unlimited messages
              </span>
            </div>
            <Tip label="New chat" side="bottom">
              <button
                type="button"
                aria-label="New chat"
                onClick={newChat}
                className="press grid size-11 shrink-0 place-items-center rounded-full text-soft hover:bg-surface hover:text-ink"
              >
                <Icon name="compose" />
              </button>
            </Tip>
          </div>

          {/* Conversation, or the empty state */}
          <div
            ref={scroller}
            data-lenis-prevent
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className={clsx(
              "relative z-10 min-h-0",
              empty ? "flex flex-1 flex-col justify-end px-5 pb-8 sm:pb-10" : "flex-1 overflow-y-auto overscroll-contain",
            )}
          >
            {empty ? (
              <div className="ask-hero mx-auto w-full max-w-3xl">
                <h1 className="text-[clamp(2rem,1.2rem+3vw,3.75rem)] font-medium leading-[1.04] tracking-[-0.035em]">
                  <BlurText text="Your global university journey" />
                </h1>
                <p className="mt-4 max-w-[46ch] text-lead text-soft">
                  With AI by your side. Personal guidance on admissions, essays, scholarships, interviews and more, for any
                  country in the world.
                </p>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-8 pt-4 sm:px-6">
                <h1 className="sr-only">{active?.title ?? "Ask Upchance"}</h1>
                {messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="msg-in flex flex-col items-end gap-2">
                      {m.file ? (
                        <span className="inline-flex h-8 items-center gap-2 rounded-full bg-surface px-3 text-small font-medium">
                          <Icon name="clip" className="size-4 text-cobalt" />
                          {m.file}
                        </span>
                      ) : null}
                      <p className="max-w-[min(85%,36rem)] whitespace-pre-wrap rounded-[1.5rem] rounded-br-md bg-cobalt px-5 py-3 text-body text-on-cobalt">
                        <span className="sr-only">You said: </span>
                        {m.text}
                      </p>
                    </div>
                  ) : (
                    <AnswerView
                      key={m.id}
                      msg={m}
                      last={m.id === lastAssistantId}
                      onFeedback={onFeedback}
                      onFollowUp={onFollowUp}
                    />
                  ),
                )}
              </div>
            )}
          </div>

          {/* The composer stays one element, so focus survives as it glides from the middle to the bottom */}
          <motion.div
            layout="position"
            layoutDependency={empty}
            transition={{ duration: reduce ? 0 : 0.5, ease }}
            className="relative z-10 shrink-0 px-2 pb-2 sm:px-6 sm:pb-5"
          >
            <div className="mx-auto max-w-3xl">
              <Composer busy={Boolean(working)} onSend={(t, f) => send(t, f)} onStop={stop} inputRef={inputRef} />
              <p className="mt-2.5 px-3 text-center text-small text-soft">
                Upchance is an AI and can make mistakes. Check important information with the university.{" "}
                <span className="whitespace-nowrap">
                  <Link href="/ai-notice" prefetch={false} className="font-medium text-ink underline decoration-mid decoration-2 underline-offset-4 hover:decoration-ink">
                    AI Notice
                  </Link>
                  {" and "}
                  <Link href="/contact" prefetch={false} className="font-medium text-ink underline decoration-mid decoration-2 underline-offset-4 hover:decoration-ink">
                    Contact
                  </Link>
                </span>
              </p>
            </div>
          </motion.div>

          {empty ? (
            <div className="relative z-10 flex-[1.3] px-3 pt-3 sm:px-6">
              <ul className="mx-auto grid max-w-3xl grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Try asking">
                {suggestions.map((s, i) => (
                  <li key={s.id} className="block-in" style={{ "--i": i } as CSSProperties}>
                    <button
                      type="button"
                      onClick={() => send(s.prompt, undefined, s.id)}
                      className="suggestion press flex h-full w-full flex-col items-start gap-1 rounded-[1.25rem] bg-surface p-4 text-left hover:bg-mid"
                    >
                      <span className="font-medium leading-snug">{s.title}</span>
                      <span className="text-small text-soft">{s.sub}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* The journey, drawn: a planet that sets when the conversation begins */}
          <AnimatePresence>
            {empty && wide ? (
              <motion.div
                key="globe"
                initial={{ opacity: 0, transform: "translateY(12%)" }}
                animate={{ opacity: 1, transform: "translateY(0%)" }}
                exit={{ opacity: 0, transform: "translateY(18%)" }}
                transition={{ duration: reduce ? 0.2 : 0.7, ease: [0.23, 1, 0.32, 1] }}
                className="absolute inset-x-0 bottom-0 z-0 h-[34%]"
              >
                <Globe className="size-full" />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>
      </div>

      <SearchChats open={searchOpen} onOpenChange={setSearchOpen} chats={chatItems} onPick={onOpen} onNew={onNew} />
      <MemoryDrawer
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        items={memory}
        setItems={setMemory}
        paused={paused}
        setPaused={setPaused}
      />
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </TipProvider>
  );
}
