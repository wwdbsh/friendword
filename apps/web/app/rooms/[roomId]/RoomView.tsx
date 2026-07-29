'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  IntroRoomRepo,
  type BrowserSupabaseClient,
  type IntroRoomSummary,
  type MessageRow,
} from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import flowStyles from '@/styles/flowCard.module.css';
import styles from './room.module.css';

const POLL_INTERVAL_MS = 4000;

type RoomViewProps = {
  readonly roomId: string;
};

export function RoomView({ roomId }: RoomViewProps) {
  const router = useRouter();
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading } = useSession(client);

  const [room, setRoom] = useState<IntroRoomSummary | null | undefined>(undefined);
  const [messages, setMessages] = useState<readonly MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [actionNote, setActionNote] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const refreshMessages = useCallback(async () => {
    if (client === null) {
      return;
    }
    const repo = new IntroRoomRepo(client);
    const rows = await repo.listMessages(roomId).catch(() => null);
    if (rows !== null) {
      setMessages(rows);
    }
  }, [client, roomId]);

  useEffect(() => {
    if (client === null || session === null) {
      return;
    }
    let cancelled = false;
    const repo = new IntroRoomRepo(client);

    // Membership is re-read on every tick, not just on mount: when the other
    // side blocks or leaves, RLS drops this room server-side and an open screen
    // would otherwise keep showing the conversation and composer until a manual
    // reload. A failed read is treated as transient after the first load — a
    // dropped request must not look like a revoked room.
    async function sync(initial: boolean): Promise<void> {
      const rooms = await repo.listMyRooms().catch(() => null);
      if (cancelled) {
        return;
      }
      if (rooms === null) {
        if (initial) {
          setRoom(null);
        }
        return;
      }
      const match = rooms.find((candidate) => candidate.roomId === roomId) ?? null;
      setRoom(match);
      if (match === null) {
        setMessages([]);
        return;
      }
      await refreshMessages();
    }

    void sync(true);
    const intervalId = window.setInterval(() => {
      void sync(false);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [client, session, roomId, refreshMessages]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (client === null || draft.trim() === '') {
      return;
    }
    setSending(true);
    try {
      const repo = new IntroRoomRepo(client);
      await repo.sendMessage(roomId, draft);
      setDraft('');
      await refreshMessages();
    } catch {
      setActionNote('That message did not send — the room may be closed.');
    } finally {
      setSending(false);
    }
  }

  async function handleLeave() {
    if (client === null) {
      return;
    }
    if (
      !window.confirm(
        'Leave this room for good? The conversation closes for both of you and cannot be reopened.',
      )
    ) {
      return;
    }
    try {
      await new IntroRoomRepo(client).leaveRoom(roomId);
      router.push('/rooms');
    } catch {
      setActionNote('Leaving did not go through. Refresh and try again.');
    }
  }

  async function handleBlock() {
    if (client === null || room === null || room === undefined) {
      return;
    }
    if (
      !window.confirm(
        'Block this person? You will be hidden from each other everywhere, immediately.',
      )
    ) {
      return;
    }
    try {
      await new IntroRoomRepo(client).blockUser(room.otherUserId);
      router.push('/rooms');
    } catch {
      setActionNote('Blocking did not go through. Refresh and try again.');
    }
  }

  async function handleReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (client === null || room === null || room === undefined) {
      return;
    }
    try {
      await new IntroRoomRepo(client).reportUser({
        reportedUserId: room.otherUserId,
        campaignId: room.campaignId,
        reason: reportReason,
      });
      setReportReason('');
      setShowSafety(false);
      setActionNote('Report received. Our team reviews every report.');
    } catch {
      setActionNote('The report did not send. Try again in a moment.');
    }
  }

  return (
    <main className={flowStyles.page}>
      <div className={flowStyles.shell}>
        <p className={flowStyles.wordmark}>Friendword</p>

        {client === null && (
          <section className={flowStyles.card}>
            <h1 className={flowStyles.title}>Almost ready</h1>
            <p className={flowStyles.muted}>
              This environment is missing its Supabase configuration.
            </p>
          </section>
        )}

        {client !== null && loading && (
          <section className={flowStyles.card} aria-live="polite">
            <h1 className={flowStyles.title}>Opening the room…</h1>
          </section>
        )}

        {client !== null && !loading && session === null && (
          <section className={flowStyles.card}>
            <span className={flowStyles.badge}>Intro room</span>
            <h1 className={flowStyles.title}>This room is private.</h1>
            <EmailSignIn client={client} reason="Sign in to open your intro room." />
          </section>
        )}

        {client !== null && session !== null && room === null && (
          <section className={flowStyles.card}>
            <span className={flowStyles.badgeDanger}>Not available</span>
            <h1 className={flowStyles.title}>This room isn’t open for you.</h1>
            <p className={flowStyles.muted}>
              It may have been left, blocked, or the link is wrong.
            </p>
            <Link className={flowStyles.secondary} href="/rooms">
              Back to my rooms
            </Link>
          </section>
        )}

        {client !== null && session !== null && room !== null && room !== undefined && (
          <section className={`${flowStyles.card} ${styles.roomCard}`}>
            <div className={styles.roomHeader}>
              <div>
                <span className={flowStyles.badge}>Intro room</span>
                <h1 className={flowStyles.subTitle}>You &amp; {room.otherDisplayName}</h1>
              </div>
              <button
                className={styles.safetyToggle}
                type="button"
                aria-expanded={showSafety}
                onClick={() => setShowSafety((current) => !current)}
              >
                Safety
              </button>
            </div>

            {showSafety && (
              <div className={styles.safetyPanel}>
                <form className={flowStyles.form} onSubmit={handleReport}>
                  <label className={flowStyles.label} htmlFor="report-reason">
                    Report {room.otherDisplayName}
                  </label>
                  <textarea
                    id="report-reason"
                    className={flowStyles.textarea}
                    required
                    placeholder="Tell us what happened."
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                  />
                  <div className={flowStyles.actionRow}>
                    <button className={flowStyles.secondary} type="submit">
                      Send report
                    </button>
                    <button
                      className={flowStyles.danger}
                      type="button"
                      onClick={() => {
                        void handleBlock();
                      }}
                    >
                      Block
                    </button>
                    <button
                      className={flowStyles.danger}
                      type="button"
                      onClick={() => {
                        void handleLeave();
                      }}
                    >
                      Leave room
                    </button>
                  </div>
                  <p className={flowStyles.finePrint}>
                    Blocking hides you from each other everywhere. Access is cut the moment you
                    confirm, and an already-open room closes within seconds.
                  </p>
                </form>
              </div>
            )}

            <div className={styles.messages} role="log" aria-label="Messages">
              {messages.length === 0 && (
                <p className={flowStyles.muted}>
                  Say hi — you were introduced by someone who knows you both deserve a good
                  conversation.
                </p>
              )}
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.sender_user_id === session.user.id
                      ? styles.bubbleMine
                      : styles.bubbleTheirs
                  }
                >
                  {message.body}
                </div>
              ))}
              <div ref={listEndRef} />
            </div>

            {actionNote !== null && <p className={flowStyles.error}>{actionNote}</p>}

            <form className={styles.composer} onSubmit={handleSend}>
              <input
                aria-label={`Message ${room.otherDisplayName}`}
                className={flowStyles.input}
                type="text"
                maxLength={2000}
                placeholder={`Message ${room.otherDisplayName}…`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                className={flowStyles.primary}
                type="submit"
                disabled={sending || draft.trim() === ''}
              >
                Send
              </button>
            </form>
            <p className={flowStyles.finePrint}>
              Text only for now. Your email and phone number stay private unless you choose to share
              them.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
