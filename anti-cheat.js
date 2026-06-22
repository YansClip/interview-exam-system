(function () {
  const INTEGRITY_CACHE_KEY = "exam_system_integrity_cache";
  const REPORT_INTERVAL_MS = 15000;
  const LEAVE_DEDUPE_MS = 1500;
  const DEFAULT_LEAVE_GRACE_MS = 10000;
  const LEAVE_EVENT_TYPES = new Set(["visibility_hidden", "window_blur"]);

  let started = false;
  let violationCount = 0;
  let counts = {};
  let events = [];
  let config = {
    warnThreshold: 1,
    lockThreshold: 3,
    forceSubmitThreshold: 5,
    leaveGraceMs: DEFAULT_LEAVE_GRACE_MS,
    relaxed: false,
  };
  let onForceSubmit = null;
  let onLockInput = null;
  let onUnlockInput = null;
  let onWarn = null;
  let reportTimer = null;
  let lastLeaveViolationAt = 0;
  let lastPasteViolationAt = 0;
  const PASTE_DEDUPE_MS = 400;
  let lockTimeout = null;
  let forced = false;
  let cacheKey = INTEGRITY_CACHE_KEY;
  const internalClipboardHistory = [];
  const examContentClipboardHistory = [];
  const INTERNAL_CLIPBOARD_MAX = 20;
  const INTERNAL_CLIPBOARD_TTL_MS = 120000;
  let leaveGraceTimer = null;
  let leaveSessionActive = false;
  let leaveViolationRecordedForSession = false;
  let pendingLeaveType = "";
  let pendingLeaveDetail = "";
  let wakeLockSentinel = null;

  function markInternalCopy(text) {
    const payload = String(text || "").trim();
    if (!payload) return;
    internalClipboardHistory.unshift({ text: payload, at: Date.now() });
    if (internalClipboardHistory.length > INTERNAL_CLIPBOARD_MAX) {
      internalClipboardHistory.pop();
    }
  }

  function markExamContentCopy(text) {
    const payload = String(text || "").trim();
    if (!payload) return;
    examContentClipboardHistory.unshift({ text: payload, at: Date.now() });
    if (examContentClipboardHistory.length > INTERNAL_CLIPBOARD_MAX) {
      examContentClipboardHistory.pop();
    }
  }

  function matchesClipboardHistory(text, history) {
    const payload = String(text || "").trim();
    if (!payload) return false;
    const now = Date.now();
    return history.some((item) => {
      if (now - item.at > INTERNAL_CLIPBOARD_TTL_MS) return false;
      return item.text === payload || item.text.includes(payload) || payload.includes(item.text);
    });
  }

  function isInternalPaste(text) {
    const payload = String(text || "").trim();
    if (!payload) return true;
    return matchesClipboardHistory(payload, internalClipboardHistory);
  }

  function isExamContentPaste(text) {
    const payload = String(text || "").trim();
    if (!payload) return false;
    return matchesClipboardHistory(payload, examContentClipboardHistory);
  }

  function getCopyTextFromEvent(event) {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? 0;
      return target.value.slice(start, end);
    }
    return window.getSelection()?.toString() || "";
  }

  function isExamInputTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.matches("[data-answer-input], #codeTestInput, #candidateName, textarea, input, select")) return true;
    return Boolean(target.closest("#codeEditorHost, .monaco-editor, .code-editor-host"));
  }

  function isExamContentSource(target) {
    if (!(target instanceof Element)) return false;
    if (isExamInputTarget(target)) return false;
    if (target.closest("#codeEditorHost, .monaco-editor, .code-editor-host")) return false;
    return Boolean(target.closest(".exam-shell, #problemContent, #mainContent"));
  }

  function resolveCopySourceElement(event) {
    if (event.target instanceof Element) return event.target;
    const anchorNode = window.getSelection()?.anchorNode;
    if (anchorNode instanceof Element) return anchorNode;
    return anchorNode?.parentElement || null;
  }

  function trackCopyFromEvent(event) {
    const text = getCopyTextFromEvent(event);
    if (!text.trim()) return;
    const source = resolveCopySourceElement(event);
    if (isExamInputTarget(source)) {
      markInternalCopy(text);
      return;
    }
    if (isExamContentSource(source)) {
      markExamContentCopy(text);
    }
  }

  function tryBlockExternalPaste(event, detail = "document") {
    if (forced || !started) return false;
    if (!isExamInputTarget(event.target)) return false;
    const text = event.clipboardData?.getData("text/plain") || "";
    if (isInternalPaste(text)) return false;

    event.preventDefault();
    event.stopPropagation();

    if (isExamContentPaste(text)) return true;

    recordEvent("paste_blocked", detail);
    return true;
  }

  function tryBlockExternalBeforeInput(event, detail = "document") {
    if (forced || !started) return false;
    if (event.inputType !== "insertFromPaste") return false;
    if (!isExamInputTarget(event.target)) return false;
    const text = event.data || event.clipboardData?.getData("text/plain") || "";
    if (isInternalPaste(text)) return false;

    event.preventDefault();

    if (isExamContentPaste(text)) return true;

    recordEvent("paste_blocked", detail);
    return true;
  }

  function ui(key, params) {
    return window.I18n ? window.I18n.t(key, params) : key;
  }

  function getLeaveGraceMs() {
    const value = Number(config.leaveGraceMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_LEAVE_GRACE_MS;
  }

  function isPageAway() {
    return document.visibilityState === "hidden" || !document.hasFocus();
  }

  function clearLeaveGraceTimer() {
    if (leaveGraceTimer) {
      window.clearTimeout(leaveGraceTimer);
      leaveGraceTimer = null;
    }
  }

  function endLeaveSession() {
    clearLeaveGraceTimer();
    leaveSessionActive = false;
    leaveViolationRecordedForSession = false;
    pendingLeaveType = "";
    pendingLeaveDetail = "";
  }

  function scheduleLeaveGraceCheck() {
    clearLeaveGraceTimer();
    leaveGraceTimer = window.setTimeout(() => {
      leaveGraceTimer = null;
      if (!started || forced || !leaveSessionActive || leaveViolationRecordedForSession) return;
      if (!isPageAway()) {
        endLeaveSession();
        return;
      }
      leaveViolationRecordedForSession = true;
      recordEvent(
        pendingLeaveType || "visibility_hidden",
        pendingLeaveDetail || "tab_or_minimize",
      );
    }, getLeaveGraceMs());
  }

  function beginLeaveSession(type, detail) {
    if (forced || !started) return;
    if (!leaveSessionActive) {
      leaveSessionActive = true;
      leaveViolationRecordedForSession = false;
      pendingLeaveType = type;
      pendingLeaveDetail = detail;
    }
    scheduleLeaveGraceCheck();
  }

  function handlePageReturn() {
    if (!leaveSessionActive) return;
    if (isPageAway()) return;
    endLeaveSession();
  }

  async function acquireWakeLock() {
    if (!started || forced) return;
    if (!("wakeLock" in navigator)) return;
    try {
      if (wakeLockSentinel && !wakeLockSentinel.released) return;
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => {
        wakeLockSentinel = null;
        if (started && !forced && document.visibilityState === "visible") {
          void acquireWakeLock();
        }
      });
    } catch (error) {
      // unsupported or permission denied
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLockSentinel?.release?.();
    } catch (error) {
      // ignore
    }
    wakeLockSentinel = null;
  }

  function getBanner() {
    return document.querySelector("#antiCheatBanner");
  }

  function buildViolationMessage(type) {
    const max = config.forceSubmitThreshold;
    const remaining = Math.max(0, max - violationCount);

    if (violationCount >= max) {
      return ui("anticheat.forceSubmitNotice", { max });
    }

    return ui("anticheat.notice", { remaining, max });
  }

  function buildModalViolationMessage() {
    const max = config.forceSubmitThreshold;
    return ui("anticheat.modalNotice", { count: violationCount, max });
  }

  function showBanner(message, level = "warn") {
    const banner = getBanner();
    if (!banner) return;
    banner.textContent = message;
    banner.dataset.level = level;
    banner.hidden = false;
    document.body.classList.add("anti-cheat-active");
    onWarn?.(buildModalViolationMessage(), level);
  }

  function notifyViolation(type) {
    const message = buildViolationMessage(type);
    const level =
      violationCount >= config.forceSubmitThreshold ||
      violationCount >= config.forceSubmitThreshold - 1
        ? "danger"
        : "warn";
    showBanner(message, level);
    return message;
  }

  function hideBanner() {
    const banner = getBanner();
    if (!banner) return;
    banner.hidden = true;
    document.body.classList.remove("anti-cheat-active");
  }

  function shouldDedupeLeaveEvent(type) {
    if (!LEAVE_EVENT_TYPES.has(type)) return false;
    const now = Date.now();
    if (now - lastLeaveViolationAt < LEAVE_DEDUPE_MS) return true;
    lastLeaveViolationAt = now;
    return false;
  }

  function recordEvent(type, detail = "") {
    if (forced || !started) return;
    if (shouldDedupeLeaveEvent(type)) return;
    if (type === "paste_blocked") {
      const nowMs = Date.now();
      if (nowMs - lastPasteViolationAt < PASTE_DEDUPE_MS) return;
      lastPasteViolationAt = nowMs;
    }

    const now = new Date().toISOString();
    counts[type] = (counts[type] || 0) + 1;
    violationCount += 1;
    events.push({ type, detail, at: now, violationCount });
    if (events.length > 200) events = events.slice(-200);

    if (violationCount >= config.forceSubmitThreshold) {
      notifyViolation(type);
      if (!config.relaxed) {
        forced = true;
        flushReport(true);
        onForceSubmit?.();
      } else {
        flushReport(false);
      }
      return;
    }

    if (violationCount >= config.lockThreshold) {
      const lockable = type !== "paste_blocked";
      if (lockable) {
        onLockInput?.(30000);
        if (lockTimeout) window.clearTimeout(lockTimeout);
        lockTimeout = window.setTimeout(() => onUnlockInput?.(), 30000);
      }
    }

    notifyViolation(type);
    flushReport(false);
  }

  function cachePayload(payload) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch (error) {
      // ignore quota errors
    }
  }

  function readCachedPayload(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function clearLegacyIntegrityCache() {
    try {
      sessionStorage.removeItem(INTEGRITY_CACHE_KEY);
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith(`${INTEGRITY_CACHE_KEY}:`)) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (error) {
      // ignore
    }
  }

  async function flushReport(force) {
    const payload = {
      violationCount,
      counts: { ...counts },
      events: events.slice(-20),
      forcedSubmit: forced,
    };
    cachePayload(payload);

    try {
      await fetch("/api/exam/integrity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (force) sessionStorage.removeItem(cacheKey);
    } catch (error) {
      // keep cached payload for submit fallback
    }
  }

  function shouldIgnoreBlur() {
    if (document.visibilityState === "hidden") return true;
    if (leaveSessionActive) return true;
    return false;
  }

  function bindListeners() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        beginLeaveSession("visibility_hidden", "tab_or_minimize");
        return;
      }
      void acquireWakeLock();
      handlePageReturn();
    });

    window.addEventListener("blur", () => {
      if (shouldIgnoreBlur()) return;
      beginLeaveSession("window_blur", "app_switch");
    });

    window.addEventListener("focus", () => {
      handlePageReturn();
    });

    document.addEventListener(
      "copy",
      (event) => {
        trackCopyFromEvent(event);
      },
      true,
    );

    document.addEventListener(
      "cut",
      (event) => {
        trackCopyFromEvent(event);
      },
      true,
    );

    document.addEventListener(
      "paste",
      (event) => {
        tryBlockExternalPaste(event, event.target?.tagName || "document");
      },
      true,
    );

    document.addEventListener(
      "beforeinput",
      (event) => {
        tryBlockExternalBeforeInput(event, event.target?.tagName || "document");
      },
      true,
    );
  }

  function start(options = {}) {
    if (started) return;
    started = true;
    onForceSubmit = options.onForceSubmit;
    onLockInput = options.onLockInput;
    onUnlockInput = options.onUnlockInput;
    onWarn = options.onWarn;
    config = { ...config, ...(options.config || {}) };

    const sessionKey = String(options.sessionKey || "").trim();
    cacheKey = sessionKey ? `${INTEGRITY_CACHE_KEY}:${sessionKey}` : INTEGRITY_CACHE_KEY;

    if (options.resetCache) {
      clearLegacyIntegrityCache();
    } else {
      const cached = readCachedPayload(cacheKey);
      if (cached) {
        violationCount = Number(cached.violationCount) || 0;
        counts = cached.counts || {};
        events = cached.events || [];
        forced = Boolean(cached.forcedSubmit);
      }
    }

    bindListeners();
    void acquireWakeLock();
    reportTimer = window.setInterval(() => flushReport(false), REPORT_INTERVAL_MS);
  }

  function stop() {
    started = false;
    endLeaveSession();
    void releaseWakeLock();
    if (reportTimer) window.clearInterval(reportTimer);
    reportTimer = null;
    hideBanner();
  }

  function getSnapshot() {
    return {
      violationCount,
      counts: { ...counts },
      events: [...events],
      forcedSubmit: forced,
    };
  }

  window.AntiCheat = {
    start,
    stop,
    getSnapshot,
    recordEvent,
    flushReport,
    markInternalCopy,
    markExamContentCopy,
    isInternalPaste,
    isExamContentPaste,
    tryBlockExternalPaste,
    hideBanner,
  };
})();
