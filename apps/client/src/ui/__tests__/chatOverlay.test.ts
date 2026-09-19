import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatOverlay } from '../ChatOverlay';
import { socketService } from '../../services/socket';

describe('ChatOverlay Component', () => {
  let container: HTMLElement;
  let overlay: ChatOverlay;
  let emitSpy: any;
  let socketCallbacks: Record<string, ((data: any) => void)[]>;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    socketCallbacks = {};
    emitSpy = vi.spyOn(socketService, 'emit').mockImplementation(() => {});
    vi.spyOn(socketService, 'on').mockImplementation((event: any, handler: any) => {
      if (!socketCallbacks[event]) socketCallbacks[event] = [];
      socketCallbacks[event].push(handler);
      return () => {
        socketCallbacks[event] = socketCallbacks[event].filter((h) => h !== handler);
      };
    });

    overlay = new ChatOverlay(container);
  });

  afterEach(() => {
    overlay.dispose();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('(a) Renders input, send button, and message log', () => {
    const input = container.querySelector('#chat-input');
    const sendBtn = container.querySelector('#chat-send');
    const log = container.querySelector('#chat-log');

    expect(input).not.toBeNull();
    expect(sendBtn).not.toBeNull();
    expect(log).not.toBeNull();
  });

  it('(b) Typing in input + click send → emits chat event, clears input', () => {
    const input = container.querySelector('#chat-input') as HTMLInputElement;
    const sendBtn = container.querySelector('#chat-send') as HTMLButtonElement;

    input.value = 'Hello world!';
    sendBtn.click();

    expect(emitSpy).toHaveBeenCalledWith(
      expect.stringMatching(/chat:send|CHAT_MESSAGE/),
      expect.objectContaining({ text: 'Hello world!' })
    );
    expect(input.value).toBe('');
  });

  it('(c) Pressing Enter key in input → emits chat event, clears input', () => {
    const input = container.querySelector('#chat-input') as HTMLInputElement;

    input.value = 'Pressing Enter message';
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    input.dispatchEvent(enterEvent);

    expect(emitSpy).toHaveBeenCalledWith(
      expect.stringMatching(/chat:send|CHAT_MESSAGE/),
      expect.objectContaining({ text: 'Pressing Enter message' })
    );
    expect(input.value).toBe('');
  });

  it('(d) Empty message / whitespace-only → not emitted, input not cleared', () => {
    const input = container.querySelector('#chat-input') as HTMLInputElement;
    const sendBtn = container.querySelector('#chat-send') as HTMLButtonElement;

    input.value = '   ';
    sendBtn.click();

    expect(emitSpy).not.toHaveBeenCalled();
    expect(input.value).toBe('   ');
  });

  it('(e) Incoming CHAT_MESSAGE socket event → renders new message element in log with username + text', () => {
    const log = container.querySelector('#chat-log') as HTMLElement;
    expect(log.children.length).toBe(0);

    const messageHandlers = socketCallbacks['chat:message'] || socketCallbacks['CHAT_MESSAGE'] || [];
    expect(messageHandlers.length).toBeGreaterThan(0);

    messageHandlers.forEach((handler) =>
      handler({
        id: 'msg-1',
        senderName: 'Alice',
        text: 'Welcome to HavenWorld!',
        timestamp: Date.now(),
      })
    );

    expect(log.children.length).toBe(1);
    const entry = log.firstElementChild as HTMLElement;
    expect(entry.textContent).toContain('Alice');
    expect(entry.textContent).toContain('Welcome to HavenWorld!');
  });

  it('(f) Rate limit error: rapid sends trigger cooldown state, shows cooldown timer/message', () => {
    const errHandlers = socketCallbacks['chat:error'] || socketCallbacks['CHAT_ERROR'] || [];
    expect(errHandlers.length).toBeGreaterThan(0);

    // Trigger server rate limit error
    errHandlers.forEach((handler) =>
      handler({
        code: 'RATE_LIMITED',
        message: 'Please slow down! Rate limit exceeded.',
      })
    );

    const errorEl = container.querySelector('#chat-error') as HTMLElement;
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toContain('Please slow down!');

    // Further send attempts during cooldown should be blocked
    emitSpy.mockClear();
    const input = container.querySelector('#chat-input') as HTMLInputElement;
    const sendBtn = container.querySelector('#chat-send') as HTMLButtonElement;
    input.value = 'Should be blocked';
    sendBtn.click();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('(g) Message history capped at 50 messages (FIFO)', () => {
    const log = container.querySelector('#chat-log') as HTMLElement;
    for (let i = 1; i <= 60; i++) {
      overlay.appendMessage({
        id: `msg-${i}`,
        username: `User${i}`,
        text: `Message number ${i}`,
        timestamp: Date.now(),
      });
    }

    expect(log.children.length).toBe(50);
    // The first 10 messages should have been pushed out (FIFO)
    expect(log.firstElementChild?.textContent).toContain('Message number 11');
    expect(log.lastElementChild?.textContent).toContain('Message number 60');
  });

  it('(h) XSS attempt in chat text → escaped, no script execution or innerHTML vulnerability', () => {
    const log = container.querySelector('#chat-log') as HTMLElement;
    const maliciousScript = '<script>window.__xss_executed = true;</script><img src="x" onerror="alert(1)" />';

    overlay.appendMessage({
      id: 'xss-1',
      username: 'Hacker<script>evil()</script>',
      text: maliciousScript,
      timestamp: Date.now(),
    });

    expect(log.children.length).toBe(1);
    // No actual script tag or executable img tag should be created in the DOM
    expect(log.querySelector('script')).toBeNull();
    const entry = log.firstElementChild as HTMLElement;
    expect(entry.innerHTML).not.toContain('<script>');
    expect(entry.innerHTML).toContain('&lt;script&gt;');
  });
});
